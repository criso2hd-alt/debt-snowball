/**
 * Payoff engine.
 *
 * Everything is computed in whole cents so repeated monthly rounding cannot
 * drift the way floating-point dollars do. One pass produces a complete
 * amortization schedule; every headline number in the UI is read back out of
 * that schedule instead of being estimated separately.
 */

export type Strategy = "snowball" | "avalanche";

export type Debt = {
  id: number;
  name: string;
  balance: number;
  original: number;
  apr: number;
  minimum: number;
  dueDay: number;
  accent: string;
  mark: string;
};

/** One debt's activity inside a single month. */
export type DebtMonth = {
  id: number;
  /** Balance carried into the month, before interest. */
  start: number;
  interest: number;
  payment: number;
  /** Portion of the payment that actually reduced the balance. */
  principal: number;
  end: number;
  /** True when this debt is receiving the rolled-up extra payment. */
  focus: boolean;
  /** True on the month the balance reaches zero. */
  cleared: boolean;
};

export type PlanMonth = {
  /** 1 = the first payment month. */
  index: number;
  date: Date;
  start: number;
  interest: number;
  payment: number;
  principal: number;
  end: number;
  debts: DebtMonth[];
  cleared: number[];
};

export type StalledDebt = {
  id: number;
  name: string;
  /** Dollars per month by which the minimum falls short of the interest. */
  shortfall: number;
};

export type Plan = {
  strategy: Strategy;
  months: PlanMonth[];
  /** Number of payment months. 0 when there is nothing to pay. */
  monthCount: number;
  totalInterest: number;
  totalPaid: number;
  /** Total sent out in month 1 (minimums + extra). */
  budget: number;
  startBalance: number;
  /** Debt ids in the order they will be attacked. */
  order: number[];
  /** debt id -> 1-based month the balance hits zero. */
  payoffMonth: Record<number, number>;
  /** False when the balances never reach zero at this payment level. */
  complete: boolean;
  /** Debts whose minimum payment does not cover their own monthly interest. */
  stalled: StalledDebt[];
};

export type PlanOptions = {
  /**
   * True (default) rolls a cleared debt's payment into the next target — the
   * snowball itself. False keeps each debt on its own minimum, which is the
   * honest "if I changed nothing" baseline.
   */
  roll?: boolean;
  /** Safety cap on the simulation length. */
  maxMonths?: number;
};

const DEFAULT_MAX_MONTHS = 600;

const toCents = (value: number) => Math.round((Number(value) || 0) * 100);
const toDollars = (cents: number) => cents / 100;

/** Monthly interest on a balance, in cents, at a nominal annual rate. */
function monthlyInterest(balanceCents: number, apr: number) {
  if (balanceCents <= 0 || apr <= 0) return 0;
  return Math.round((balanceCents * apr) / 1200);
}

function monthDate(offset: number, from: Date) {
  const date = new Date(from.getFullYear(), from.getMonth(), 1);
  date.setMonth(date.getMonth() + offset);
  return date;
}

/**
 * The order debts are attacked in. Locked once at the start of the plan so the
 * target does not flip mid-payoff the way a per-month re-sort would.
 */
export function attackOrder(debts: Debt[], strategy: Strategy): number[] {
  return [...debts]
    .sort((a, b) => (strategy === "avalanche"
      ? b.apr - a.apr || a.balance - b.balance
      : a.balance - b.balance || b.apr - a.apr))
    .map((debt) => debt.id);
}

export function buildPlan(
  debts: Debt[],
  extra: number,
  strategy: Strategy = "snowball",
  options: PlanOptions = {},
): Plan {
  const roll = options.roll !== false;
  const maxMonths = options.maxMonths ?? DEFAULT_MAX_MONTHS;
  const today = new Date();

  const active = debts.filter((debt) => debt.balance > 0.004);
  const order = attackOrder(active, strategy);
  const state = new Map(active.map((debt) => [debt.id, {
    name: debt.name,
    apr: Math.max(0, debt.apr),
    minimum: Math.max(0, toCents(debt.minimum)),
    balance: toCents(debt.balance),
  }]));

  const startBalance = [...state.values()].reduce((sum, item) => sum + item.balance, 0);
  const extraCents = Math.max(0, toCents(extra));
  const fullMinimums = [...state.values()].reduce((sum, item) => sum + item.minimum, 0);
  const fullBudget = fullMinimums + extraCents;

  const stalled: StalledDebt[] = [];
  for (const [id, item] of state) {
    const interest = monthlyInterest(item.balance, item.apr);
    if (item.minimum > 0 && item.minimum <= interest) {
      stalled.push({ id, name: item.name, shortfall: toDollars(interest - item.minimum) });
    }
  }

  const months: PlanMonth[] = [];
  const payoffMonth: Record<number, number> = {};
  let totalInterest = 0;
  let totalPaid = 0;
  let complete = startBalance === 0;

  for (let index = 1; index <= maxMonths && !complete; index += 1) {
    const budget = roll
      ? fullBudget
      : [...state.values()].reduce((sum, item) => sum + (item.balance > 0 ? item.minimum : 0), 0) + extraCents;

    let available = budget;
    const rows = new Map<number, DebtMonth>();
    const focusId = order.find((id) => (state.get(id)?.balance ?? 0) > 0) ?? null;

    // 1. Interest posts first, on the balance carried into the month.
    for (const id of order) {
      const item = state.get(id)!;
      const row: DebtMonth = {
        id,
        start: item.balance,
        interest: 0,
        payment: 0,
        principal: 0,
        end: item.balance,
        focus: id === focusId,
        cleared: false,
      };
      rows.set(id, row);
      if (item.balance <= 0) continue;
      const interest = monthlyInterest(item.balance, item.apr);
      item.balance += interest;
      row.interest = interest;
    }

    // 2. Required minimums, in attack order so a tight budget protects the target.
    for (const id of order) {
      const item = state.get(id)!;
      if (item.balance <= 0 || available <= 0) continue;
      const payment = Math.min(item.minimum, item.balance, available);
      item.balance -= payment;
      available -= payment;
      rows.get(id)!.payment += payment;
    }

    // 3. Whatever is left lands on the current target, then spills to the next.
    for (const id of order) {
      if (available <= 0) break;
      const item = state.get(id)!;
      if (item.balance <= 0) continue;
      const payment = Math.min(available, item.balance);
      item.balance -= payment;
      available -= payment;
      rows.get(id)!.payment += payment;
    }

    const cleared: number[] = [];
    let monthStart = 0;
    let monthInterest = 0;
    let monthPayment = 0;
    for (const id of order) {
      const item = state.get(id)!;
      const row = rows.get(id)!;
      row.end = item.balance;
      row.principal = row.payment - row.interest;
      row.cleared = row.start > 0 && item.balance <= 0;
      if (row.cleared) {
        cleared.push(id);
        payoffMonth[id] = index;
      }
      monthStart += row.start;
      monthInterest += row.interest;
      monthPayment += row.payment;
    }

    const monthEnd = [...state.values()].reduce((sum, item) => sum + item.balance, 0);
    totalInterest += monthInterest;
    totalPaid += monthPayment;

    months.push({
      index,
      date: monthDate(index - 1, today),
      start: toDollars(monthStart),
      interest: toDollars(monthInterest),
      payment: toDollars(monthPayment),
      principal: toDollars(monthPayment - monthInterest),
      end: toDollars(monthEnd),
      debts: order.map((id) => {
        const row = rows.get(id)!;
        return {
          ...row,
          start: toDollars(row.start),
          interest: toDollars(row.interest),
          payment: toDollars(row.payment),
          principal: toDollars(row.principal),
          end: toDollars(row.end),
        };
      }),
      cleared,
    });

    if (monthEnd <= 0) {
      complete = true;
      break;
    }

    // A balance that grew despite a full payment can only keep growing: the
    // budget is below the interest charge. Stop rather than loop to the cap.
    if (monthEnd >= monthStart) break;
  }

  return {
    strategy,
    months,
    monthCount: months.length,
    totalInterest: toDollars(totalInterest),
    totalPaid: toDollars(totalPaid),
    budget: toDollars(fullBudget),
    startBalance: toDollars(startBalance),
    order,
    payoffMonth,
    complete,
    stalled,
  };
}

/** Balance-remaining series on a shared monthly axis, month 0 = today. */
export function balanceSeries(plan: Plan): number[] {
  return [plan.startBalance, ...plan.months.map((month) => month.end)];
}

/** The calendar month a plan finishes, or null when it never does. */
export function payoffDate(plan: Plan): Date | null {
  if (!plan.complete || plan.monthCount === 0) return null;
  return plan.months[plan.monthCount - 1].date;
}

export function formatMonth(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** "3 yr 2 mo" reads faster than "38 months" for long payoffs. */
export function formatDuration(months: number) {
  if (months <= 0) return "0 months";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} ${rest === 1 ? "month" : "months"}`;
  if (rest === 0) return `${years} ${years === 1 ? "year" : "years"}`;
  return `${years} yr ${rest} mo`;
}

/**
 * The next real calendar occurrence of a due day, clamped to months that are
 * too short to contain it (a 31st due day lands on Feb 28).
 */
export function nextDueDate(dueDay: number, from: Date = new Date()) {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const clampedFor = (year: number, month: number) =>
    Math.min(Math.max(1, Math.trunc(dueDay) || 1), new Date(year, month + 1, 0).getDate());

  const thisMonth = new Date(
    today.getFullYear(),
    today.getMonth(),
    clampedFor(today.getFullYear(), today.getMonth()),
  );
  if (thisMonth >= today) return thisMonth;

  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return new Date(
    nextMonth.getFullYear(),
    nextMonth.getMonth(),
    clampedFor(nextMonth.getFullYear(), nextMonth.getMonth()),
  );
}

export function daysUntil(date: Date, from: Date = new Date()) {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

export function dueLabel(date: Date, from: Date = new Date()) {
  const days = daysUntil(date, from);
  if (days <= 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `In ${days} days`;
}

export type MonthAction = {
  debt: Debt;
  due: Date;
  amount: number;
  minimum: number;
  extra: number;
  clears: boolean;
  interest: number;
  principal: number;
  endBalance: number;
};

/**
 * What to actually pay this month, ordered by due date — the answer to
 * "what do I do right now".
 */
export function monthActions(plan: Plan, debts: Debt[], from: Date = new Date()): MonthAction[] {
  const first = plan.months[0];
  if (!first) return [];
  const byId = new Map(debts.map((debt) => [debt.id, debt]));

  return first.debts
    .filter((row) => row.start > 0 && byId.has(row.id))
    .map((row) => {
      const debt = byId.get(row.id)!;
      const minimum = Math.min(debt.minimum, row.payment);
      return {
        debt,
        due: nextDueDate(debt.dueDay, from),
        amount: row.payment,
        minimum,
        extra: Math.max(0, row.payment - minimum),
        clears: row.cleared,
        interest: row.interest,
        principal: row.principal,
        endBalance: row.end,
      };
    })
    .sort((a, b) => a.due.getTime() - b.due.getTime());
}

/**
 * One entry per debt, in the order the strategy attacks them. Figures are read
 * back out of the schedule rather than re-derived, so they stay correct when
 * attack order and payoff order differ — which avalanche routinely produces.
 */
export type Milestone = {
  debt: Debt;
  /** 1-based month the balance reaches zero. */
  month: number;
  date: Date;
  /** What this debt receives in the first month of the plan. */
  currentPayment: number;
  /** Largest monthly payment it ever receives, once everything has rolled in. */
  peakPayment: number;
  interestPaid: number;
};

export function milestones(plan: Plan, debts: Debt[]): Milestone[] {
  const byId = new Map(debts.map((debt) => [debt.id, debt]));
  const interest = new Map<number, number>();
  const peak = new Map<number, number>();
  const current = new Map(
    (plan.months[0]?.debts ?? []).map((row) => [row.id, row.payment]),
  );

  for (const month of plan.months) {
    for (const row of month.debts) {
      interest.set(row.id, (interest.get(row.id) ?? 0) + row.interest);
      peak.set(row.id, Math.max(peak.get(row.id) ?? 0, row.payment));
    }
  }

  return plan.order
    .filter((id) => byId.has(id) && plan.payoffMonth[id])
    .map((id) => {
      const month = plan.payoffMonth[id];
      return {
        debt: byId.get(id)!,
        month,
        date: plan.months[month - 1].date,
        currentPayment: current.get(id) ?? 0,
        peakPayment: peak.get(id) ?? 0,
        interestPaid: interest.get(id) ?? 0,
      };
    });
}

/** The same milestones ordered by when they actually happen on the calendar. */
export function milestonesByDate(plan: Plan, debts: Debt[]): Milestone[] {
  return milestones(plan, debts).sort((a, b) => a.month - b.month);
}

export function planCsv(plan: Plan, debts: Debt[]): string {
  const byId = new Map(debts.map((debt) => [debt.id, debt]));
  const names = plan.order.map((id) => byId.get(id)?.name ?? `Debt ${id}`);
  const header = [
    "Month",
    "Date",
    "Total payment",
    "Interest",
    "Principal",
    "Remaining balance",
    ...plan.order.flatMap((id, index) => [`${names[index]} payment`, `${names[index]} balance`]),
  ];

  const rows = plan.months.map((month) => {
    const byDebt = new Map(month.debts.map((row) => [row.id, row]));
    return [
      month.index,
      month.date.toISOString().slice(0, 7),
      month.payment.toFixed(2),
      month.interest.toFixed(2),
      month.principal.toFixed(2),
      month.end.toFixed(2),
      ...plan.order.flatMap((id) => {
        const row = byDebt.get(id);
        return [(row?.payment ?? 0).toFixed(2), (row?.end ?? 0).toFixed(2)];
      }),
    ].join(",");
  });

  const escape = (value: string) => (/[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return [header.map(escape).join(","), ...rows].join("\n");
}
