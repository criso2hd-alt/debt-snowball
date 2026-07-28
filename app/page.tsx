"use client";

import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import TrajectoryChart, { type Series } from "./components/TrajectoryChart";
import Schedule from "./components/Schedule";
import {
  type Debt,
  type Plan,
  type Strategy,
  balanceSeries,
  buildPlan,
  dueLabel,
  formatDuration,
  formatMonth,
  milestones,
  milestonesByDate,
  monthActions,
  nextDueDate,
  payoffDate,
} from "./lib/plan";

export type { Debt } from "./lib/plan";

export type DebtState = {
  debts: Debt[];
  extra: number;
  strategy?: Strategy;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const money2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dayMonth = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const STRATEGY_COPY: Record<Strategy, { name: string; rule: string; why: string }> = {
  snowball: {
    name: "Snowball",
    rule: "Smallest balance first",
    why: "You clear accounts sooner, so the plan feels like it is working early on.",
  },
  avalanche: {
    name: "Avalanche",
    rule: "Highest APR first",
    why: "You pay the least interest overall, but the first win takes longer to arrive.",
  },
};

function Icon({ children }: { children: ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

/**
 * The browser's clock, read only after hydration. The server renders in its own
 * timezone, so baking a date into the HTML would mismatch on the client.
 */
let clientNow: Date | null = null;
const subscribeToNothing = () => () => {};
function useClientNow() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => (clientNow ??= new Date()),
    () => null,
  );
}

function greeting(now: Date) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** The one number people actually want: when this ends. */
function finishLabel(plan: Plan) {
  const date = payoffDate(plan);
  if (!date) return "Not reachable yet";
  return formatMonth(date);
}

/**
 * Lifetime totals only mean something for a plan that finishes. A stalled plan
 * has walked a couple of months before bailing out, and printing that partial
 * sum as "interest ahead" would badly understate the situation.
 */
function lifetimeLabel(plan: Plan, value: number, format: Intl.NumberFormat = money) {
  if (plan.monthCount === 0) return format.format(0);
  return plan.complete ? format.format(value) : "Unbounded";
}

function ProgressRing({ percent, size = "large" }: { percent: number; size?: "large" | "small" }) {
  return (
    <div
      className={`progress-ring ${size}`}
      style={{ "--progress": `${Math.max(0, Math.min(100, percent)) * 3.6}deg` } as React.CSSProperties}
      role="img"
      aria-label={`${percent}% of your starting balance is paid off`}
    >
      <div><strong>{percent}%</strong><span>paid off</span></div>
    </div>
  );
}

/**
 * Surfaces the two situations that silently produce nonsense forecasts:
 * a budget too small to ever finish, and an account whose minimum does not
 * even cover its own interest.
 */
function PlanWarnings({ plan, onFix }: { plan: Plan; onFix: () => void }) {
  if (plan.monthCount === 0) return null;
  const notes: { tone: "stop" | "warn"; title: string; body: string }[] = [];

  if (!plan.complete) {
    notes.push({
      tone: "stop",
      title: "These payments never clear the debt",
      body: "The interest charged each month is at least as large as the total you are paying. The balance grows instead of shrinking. Raising the monthly amount — or lowering an APR — is what changes this.",
    });
  }

  for (const debt of plan.stalled) {
    notes.push({
      tone: "warn",
      title: `${debt.name}'s minimum does not cover its interest`,
      body: `It falls short by about ${money2.format(debt.shortfall)} a month, so that balance grows while you focus elsewhere. The plan below accounts for it, but paying a little more on this account is worth considering.`,
    });
  }

  if (notes.length === 0) return null;

  return (
    <div className="plan-warnings">
      {notes.map((note) => (
        <div key={note.title} className={`plan-warning ${note.tone}`}>
          <span aria-hidden="true">{note.tone === "stop" ? "!" : "▲"}</span>
          <div><strong>{note.title}</strong><p>{note.body}</p></div>
          <button onClick={onFix}>Adjust payment</button>
        </div>
      ))}
    </div>
  );
}

/** "What do I do this month" — the question the old dashboard never answered. */
function ThisMonthPanel({
  plan,
  debts,
  onOpenSchedule,
}: {
  plan: Plan;
  debts: Debt[];
  onOpenSchedule: () => void;
}) {
  const actions = useMemo(() => monthActions(plan, debts), [plan, debts]);
  const total = actions.reduce((sum, action) => sum + action.amount, 0);

  if (actions.length === 0) {
    return (
      <article className="panel month-panel">
        <p className="card-label">THIS MONTH</p>
        <h3 className="panel-title">Nothing scheduled yet</h3>
        <p className="panel-note">Add an account and this becomes a checklist of exactly what to pay, and when.</p>
      </article>
    );
  }

  return (
    <article className="panel month-panel">
      <div className="panel-heading">
        <div>
          <p className="card-label">THIS MONTH · {formatMonth(plan.months[0].date).toUpperCase()}</p>
          <h3 className="panel-title">Pay these amounts</h3>
        </div>
        <div className="month-total">
          <span>Total</span>
          <strong>{money2.format(total)}</strong>
        </div>
      </div>

      <ol className="month-actions">
        {actions.map((action) => (
          <li key={action.debt.id} style={{ "--accent": action.debt.accent } as React.CSSProperties}>
            <span className="action-mark">{action.debt.mark}</span>
            <div className="action-main">
              <strong>{action.debt.name}</strong>
              <span className="action-due">
                {dayMonth.format(action.due)} · {dueLabel(action.due)}
              </span>
            </div>
            <div className="action-amount">
              <strong>{money2.format(action.amount)}</strong>
              <span>
                {action.extra > 0.004
                  ? `${money.format(action.minimum)} minimum + ${money.format(action.extra)} snowball`
                  : "minimum payment"}
              </span>
            </div>
            {action.clears && <b className="action-clear">Clears it 🎉</b>}
          </li>
        ))}
      </ol>

      <div className="month-footer">
        <p>
          Of that {money2.format(total)}, <b>{money2.format(plan.months[0].interest)}</b> goes to interest and{" "}
          <b>{money2.format(plan.months[0].principal)}</b> actually reduces what you owe.
        </p>
        <button className="btn-quiet" onClick={onOpenSchedule}>See every month →</button>
      </div>
    </article>
  );
}

function DebtCard({ debt, plan, focused, onEdit }: { debt: Debt; plan: Plan; focused: boolean; onEdit: (debt: Debt) => void }) {
  const progress = debt.original > 0
    ? Math.max(0, Math.min(100, Math.round((1 - debt.balance / debt.original) * 100)))
    : 0;
  const month = plan.payoffMonth[debt.id];
  const clearDate = month ? formatMonth(plan.months[month - 1].date) : null;
  const due = nextDueDate(debt.dueDay);

  return (
    <article className={`debt-card ${focused ? "focused" : ""}`} style={{ "--accent": debt.accent } as React.CSSProperties}>
      <div className="debt-card-top">
        <span className="card-mark">{debt.mark}</span>
        <span className="debt-name">{debt.name}</span>
        <button className="more-button" onClick={() => onEdit(debt)} aria-label={`Edit ${debt.name}`}>•••</button>
      </div>
      <strong className="debt-balance">{money.format(debt.balance)}</strong>
      <p className="debt-apr">{debt.apr.toFixed(2)}% APR</p>
      <div className="mini-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      <p className="progress-label">{progress}% paid off</p>
      <dl className="debt-meta">
        <div><dt>Minimum</dt><dd>{money.format(debt.minimum)}</dd></div>
        <div><dt>Next due</dt><dd>{dayMonth.format(due)}</dd></div>
        <div className="wide"><dt>Paid off by</dt><dd className="accent-value">{clearDate ?? "—"}</dd></div>
      </dl>
    </article>
  );
}

/** The order accounts get attacked, when each disappears, and what rolls next. */
function MilestoneTimeline({ plan, debts }: { plan: Plan; debts: Debt[] }) {
  const steps = useMemo(() => milestones(plan, debts), [plan, debts]);
  if (steps.length === 0) return null;

  return (
    <ol className="timeline">
      {steps.map((step, index) => {
        const next = steps[index + 1];
        // Only narrate a hand-off when the next target really does outlast this
        // one — under avalanche a low-rate account can clear out of turn.
        const rolls = next && next.month > step.month;
        const clearsEarly = index > 0 && step.month < steps[index - 1].month;
        return (
          <li key={step.debt.id} className={index === 0 ? "current" : ""} style={{ "--accent": step.debt.accent } as React.CSSProperties}>
            <div className="timeline-node">{index + 1}</div>
            <div className="timeline-card">
              <div className="timeline-lead">
                <span className="timeline-stage">{index === 0 ? "PAYING NOW" : `NEXT UP ${index + 1}`}</span>
                <strong>{step.debt.name}</strong>
                <small>{money.format(step.debt.balance)} at {step.debt.apr.toFixed(2)}%</small>
              </div>
              <div>
                <span>{index === 0 ? "You send this month" : "Payment once targeted"}</span>
                <strong>{money2.format(index === 0 ? step.currentPayment : step.peakPayment)}</strong>
              </div>
              <div><span>Gone by</span><strong className="accent-value">{formatMonth(step.date)}</strong></div>
              <div><span>Interest it costs</span><strong>{money.format(step.interestPaid)}</strong></div>
            </div>
            {clearsEarly && (
              <p className="timeline-roll aside">
                Small enough to finish on its own minimum before the account above it — no extra needed here.
              </p>
            )}
            {rolls && (
              <p className="timeline-roll">
                ↓ Its {money2.format(step.debt.minimum)} minimum then rolls into <b>{next.debt.name}</b>, taking that payment to {money2.format(next.peakPayment)}.
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

type ViewProps = {
  active: string;
  debts: Debt[];
  extra: number;
  strategy: Strategy;
  total: number;
  original: number;
  paid: number;
  progress: number;
  plan: Plan;
  baseline: Plan;
  faster: Plan;
  alternative: Plan;
  simExtra: number;
  onUpdate: () => void;
  onSimulate: () => void;
  onAddDebt: () => void;
  onEditDebt: (debt: Debt) => void;
  onStrategyChange: (strategy: Strategy) => void;
  onNavigate: (view: string) => void;
  sharedMode: boolean;
};

function SecondaryView(props: ViewProps) {
  const {
    active, debts, extra, strategy, total, original, paid, progress,
    plan, baseline, faster, alternative, simExtra,
    onUpdate, onSimulate, onAddDebt, onEditDebt, onStrategyChange, onNavigate, sharedMode,
  } = props;

  const [reminders, setReminders] = useState<Record<number, boolean>>(
    Object.fromEntries(debts.map((debt) => [debt.id, true])),
  );

  const vsBaselineMonths = baseline.complete && plan.complete ? Math.max(0, baseline.monthCount - plan.monthCount) : 0;
  const vsBaselineInterest = baseline.complete && plan.complete ? Math.max(0, baseline.totalInterest - plan.totalInterest) : 0;

  if (active === "Accounts") {
    const highestApr = [...debts].sort((a, b) => b.apr - a.apr)[0];
    return (
      <section className="workspace-view">
        <div className="view-toolbar">
          <div>
            <p className="eyebrow">{debts.length} ACTIVE {debts.length === 1 ? "ACCOUNT" : "ACCOUNTS"}</p>
            <h2>Your balances</h2>
            <p>Update these once a month, after each statement closes. Every forecast recalculates immediately.</p>
          </div>
          <div className="view-toolbar-actions">
            <button className="btn-secondary" onClick={onAddDebt}>+ Add account</button>
            <button className="btn-primary" onClick={onUpdate} disabled={debts.length === 0}>Update balances</button>
          </div>
        </div>

        <div className="account-list">
          {debts.map((debt) => {
            const debtProgress = debt.original > 0
              ? Math.max(0, Math.min(100, Math.round((1 - debt.balance / debt.original) * 100)))
              : 0;
            const month = plan.payoffMonth[debt.id];
            const monthlyInterest = (debt.balance * debt.apr) / 1200;
            return (
              <article key={debt.id} style={{ "--accent": debt.accent } as React.CSSProperties}>
                <span className="account-mark">{debt.mark}</span>
                <div className="account-main">
                  <div>
                    <strong>{debt.name}</strong>
                    <span>{debt.apr.toFixed(2)}% APR · due the {debt.dueDay}{ordinal(debt.dueDay)} · costs {money2.format(monthlyInterest)} in interest this month</span>
                  </div>
                  <div className="account-progress" aria-hidden="true"><span style={{ width: `${debtProgress}%` }} /></div>
                </div>
                <div className="account-stats">
                  <div className="account-stat"><span>Balance</span><strong>{money.format(debt.balance)}</strong></div>
                  <div className="account-stat"><span>Minimum</span><strong>{money.format(debt.minimum)}</strong></div>
                  <div className="account-stat"><span>Paid off by</span><strong className="accent-value">{month ? formatMonth(plan.months[month - 1].date) : "—"}</strong></div>
                </div>
                <button onClick={() => onEditDebt(debt)} aria-label={`Edit ${debt.name}`}>•••</button>
              </article>
            );
          })}
          {debts.length === 0 && (
            <button className="empty-account-state" onClick={onAddDebt}>
              <strong>Add your first account</strong>
              <span>Balance, APR, minimum payment, and due day. Nothing else.</span>
            </button>
          )}
        </div>

        {highestApr && (
          <div className="insight">
            <span aria-hidden="true">◆</span>
            <div>
              <strong>{highestApr.name} carries your highest rate at {highestApr.apr.toFixed(2)}%.</strong>
              <p>
                {strategy === "snowball"
                  ? `You are on the snowball, which targets the smallest balance first. Switching to avalanche would target ${highestApr.name} instead.`
                  : `You are on the avalanche, so ${highestApr.name} is the current target.`}
              </p>
            </div>
            <button onClick={() => onNavigate("Payoff Plan")}>Compare strategies →</button>
          </div>
        )}
      </section>
    );
  }

  if (active === "Payoff Plan") {
    const other = strategy === "snowball" ? "avalanche" : "snowball";
    const interestDelta = alternative.totalInterest - plan.totalInterest;
    const monthDelta = alternative.monthCount - plan.monthCount;
    return (
      <section className="workspace-view">
        <div className="view-toolbar">
          <div>
            <p className="eyebrow">THE ORDER YOU PAY THINGS OFF</p>
            <h2>One account at a time</h2>
            <p>Every account gets its minimum. Everything left over goes to a single target until it is gone — then that payment rolls forward.</p>
          </div>
          <button className="btn-primary" onClick={onSimulate}>Change monthly amount</button>
        </div>

        <div className="strategy-switch" role="radiogroup" aria-label="Payoff strategy">
          {(["snowball", "avalanche"] as Strategy[]).map((option) => (
            <button
              key={option}
              role="radio"
              aria-checked={strategy === option}
              className={strategy === option ? "on" : ""}
              onClick={() => onStrategyChange(option)}
            >
              <strong>{STRATEGY_COPY[option].name}</strong>
              <span>{STRATEGY_COPY[option].rule}</span>
            </button>
          ))}
          {plan.monthCount > 0 && alternative.monthCount > 0 && (
            <p className="strategy-note">
              {Math.abs(interestDelta) < 1 && monthDelta === 0
                ? "With your accounts, both strategies finish at the same time and cost the same interest."
                : interestDelta > 0
                  ? `Sticking with ${STRATEGY_COPY[strategy].name.toLowerCase()} costs ${money.format(Math.abs(interestDelta))} less interest than ${other}${monthDelta !== 0 ? ` and finishes ${formatDuration(Math.abs(monthDelta))} ${monthDelta > 0 ? "sooner" : "later"}` : ""}.`
                  : `Switching to ${other} would save about ${money.format(Math.abs(interestDelta))} in interest${monthDelta !== 0 ? ` and finish ${formatDuration(Math.abs(monthDelta))} ${monthDelta < 0 ? "sooner" : "later"}` : ""}. ${STRATEGY_COPY[strategy].why}`}
            </p>
          )}
        </div>

        <div className="plan-layout">
          <div>
            <MilestoneTimeline plan={plan} debts={debts} />
            {debts.length === 0 && (
              <button className="empty-account-state" onClick={onAddDebt}>
                <strong>Add an account to build your plan</strong>
                <span>The payoff order appears here automatically.</span>
              </button>
            )}
          </div>
          <aside className="plan-summary">
            <p>YOUR FINISH LINE</p>
            <h3>{finishLabel(plan)}</h3>
            <span>{plan.complete ? formatDuration(plan.monthCount) : "Raise the monthly amount to reach a finish"}</span>
            <div><span>You send each month</span><strong>{money2.format(plan.budget)}</strong></div>
            <div><span>Required minimums</span><strong>{money2.format(Math.max(0, plan.budget - extra))}</strong></div>
            <div><span>Extra on top</span><strong>{money2.format(extra)}</strong></div>
            <div><span>Interest from here</span><strong>{lifetimeLabel(plan, plan.totalInterest)}</strong></div>
            <div><span>Total you will pay</span><strong>{lifetimeLabel(plan, plan.totalPaid)}</strong></div>
            <button onClick={onSimulate}>Try paying more →</button>
          </aside>
        </div>
      </section>
    );
  }

  if (active === "Schedule") {
    return (
      <section className="workspace-view">
        <div className="view-toolbar">
          <div>
            <p className="eyebrow">FULL AMORTIZATION</p>
            <h2>Every payment, month by month</h2>
            <p>Interest is charged on each balance, then your payments are applied — minimums everywhere, the rest on the current target.</p>
          </div>
          <button className="btn-secondary" onClick={onSimulate}>Change monthly amount</button>
        </div>

        <div className="schedule-summary">
          <article><span>Payments remaining</span><strong>{plan.complete ? plan.monthCount : "—"}</strong><small>{plan.complete ? formatDuration(plan.monthCount) : "cap reached — plan never finishes"}</small></article>
          <article><span>Debt-free</span><strong className="accent-value">{finishLabel(plan)}</strong><small>at {money2.format(plan.budget)} per month</small></article>
          <article><span>Interest from here</span><strong>{lifetimeLabel(plan, plan.totalInterest)}</strong><small>{plan.startBalance > 0 ? `${Math.round((plan.totalInterest / plan.startBalance) * 100)}% of what you owe today` : "—"}</small></article>
          <article><span>Total you will pay</span><strong>{lifetimeLabel(plan, plan.totalPaid)}</strong><small>{money.format(plan.startBalance)} balance + interest</small></article>
        </div>

        <Schedule plan={plan} debts={debts} />
      </section>
    );
  }

  if (active === "Progress") {
    const nextStep = milestonesByDate(plan, debts)[0];
    return (
      <section className="workspace-view">
        <div className="view-toolbar">
          <div>
            <p className="eyebrow">PROGRESS</p>
            <h2>What you have moved so far</h2>
            <p>Everything here comes from your own balances, rates, and payments — no estimates layered on top.</p>
          </div>
        </div>

        <div className="progress-hero">
          <ProgressRing percent={progress} />
          <div className="progress-hero-copy">
            <strong>{money.format(paid)} paid down</strong>
            <p>
              You started at {money.format(original)} and owe {money.format(total)} today.
              {nextStep && ` Next up: ${nextStep.debt.name} disappears in ${formatMonth(nextStep.date)}.`}
            </p>
          </div>
          <div className="progress-hero-stats">
            <div><span>Accounts closed</span><strong>{debts.filter((debt) => debt.balance <= 0).length} of {debts.length}</strong></div>
            <div><span>Still owing</span><strong>{money.format(total)}</strong></div>
          </div>
        </div>

        <div className="report-kpis">
          <article>
            <span>Interest your snowball avoids</span>
            <strong className="positive">{money.format(vsBaselineInterest)}</strong>
            <small>Versus paying only minimums and never rolling them forward</small>
          </article>
          <article>
            <span>Time your snowball saves</span>
            <strong className="positive">{vsBaselineMonths > 0 ? formatDuration(vsBaselineMonths) : "—"}</strong>
            <small>{baseline.complete ? `Minimums alone would take ${formatDuration(baseline.monthCount)}` : "Minimums alone would never clear the debt"}</small>
          </article>
          <article>
            <span>Interest still ahead of you</span>
            <strong>{lifetimeLabel(plan, plan.totalInterest)}</strong>
            <small>On the current plan of {money2.format(plan.budget)} per month</small>
          </article>
          <article>
            <span>Monthly commitment</span>
            <strong>{money2.format(plan.budget)}</strong>
            <small>{money.format(extra)} above the required minimums</small>
          </article>
        </div>

        <div className="reports-grid">
          <article className="panel">
            <div className="panel-heading">
              <div><span className="card-label">PAYOFF FORECAST</span><strong className="panel-title">Three ways this could go</strong></div>
            </div>
            {debts.length > 0 ? (
              <TrajectoryChart
                plan={plan}
                debts={debts}
                height={340}
                series={forecastSeries(plan, baseline, faster, simExtra)}
              />
            ) : (
              <p className="panel-note empty-chart">Add an account and the forecast draws itself here.</p>
            )}
          </article>
          <article className="panel">
            <span className="card-label">WHERE THE DEBT SITS</span>
            <h3 className="panel-title">Balance by account</h3>
            <div className="distribution">
              {debts.map((debt) => (
                <div key={debt.id}>
                  <p>
                    <span><i style={{ background: debt.accent }} />{debt.name}</span>
                    <strong>{money.format(debt.balance)} · {total > 0 ? Math.round((debt.balance / total) * 100) : 0}%</strong>
                  </p>
                  <div><span style={{ width: `${total > 0 ? (debt.balance / total) * 100 : 0}%`, background: debt.accent }} /></div>
                </div>
              ))}
              {debts.length === 0 && <p className="panel-note">No accounts yet.</p>}
            </div>
          </article>
        </div>

        <p className="estimate-note">
          Projections assume today&apos;s balances, fixed APRs, fixed minimum payments, and on-time payments with no new charges.
          Card issuers usually recalculate minimums as balances fall and may compound daily, so real statements can differ by a small amount each month.
        </p>
      </section>
    );
  }

  if (active === "Reminders") {
    const upcoming = [...debts]
      .map((debt) => ({ debt, due: nextDueDate(debt.dueDay) }))
      .sort((a, b) => a.due.getTime() - b.due.getTime());
    return (
      <section className="workspace-view">
        <div className="view-toolbar">
          <div>
            <p className="eyebrow">DUE DATES</p>
            <h2>What is coming up</h2>
            <p>Reminder switches are a local preference on this device. Nothing is emailed or texted.</p>
          </div>
          <span className="status-pill"><i /> {Object.values(reminders).filter(Boolean).length} on</span>
        </div>
        <div className="reminders-layout">
          <div className="reminder-list">
            {upcoming.map(({ debt, due }) => (
              <article key={debt.id} style={{ "--accent": debt.accent } as React.CSSProperties}>
                <span className="account-mark">{debt.mark}</span>
                <div>
                  <strong>{debt.name}</strong>
                  <span>{dayMonth.format(due)} · {dueLabel(due)} · {money2.format(debt.minimum)} minimum</span>
                </div>
                <div className="reminder-chips"><span>7 days before</span><span>2 days before</span></div>
                <button
                  className={`toggle ${reminders[debt.id] ? "on" : ""}`}
                  onClick={() => setReminders({ ...reminders, [debt.id]: !reminders[debt.id] })}
                  aria-pressed={Boolean(reminders[debt.id])}
                  aria-label={`${reminders[debt.id] ? "Disable" : "Enable"} ${debt.name} reminder`}
                ><span /></button>
              </article>
            ))}
            {debts.length === 0 && <p className="panel-note">Add an account to see its due date here.</p>}
          </div>
          <aside className="side-note">
            <h3>One check-in a month</h3>
            <p>
              Update balances two days after your last statement closes. That is late enough for the numbers to be final
              and early enough to plan the month — and it keeps this from becoming a daily chore.
            </p>
            <button onClick={onUpdate}>Update balances now</button>
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-view">
      <div className="view-toolbar">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h2>How this app behaves</h2>
          <p>{sharedMode
            ? "Shared with signed-in users on this private-network server."
            : "No bank login, no card numbers. Nothing leaves this browser."}</p>
        </div>
      </div>
      <div className="settings-grid">
        <article>
          <div><strong>{sharedMode ? "Private-network storage" : "Local-only storage"}</strong><p>{sharedMode ? "Authorized users share one plan held by the local executable." : "Balances live in this browser's local storage under debt-snowball-state."}</p></div>
          <span className="setting-value">On</span>
        </article>
        <article>
          <div><strong>Payoff strategy</strong><p>{STRATEGY_COPY[strategy].rule}. {STRATEGY_COPY[strategy].why}</p></div>
          <div className="strategy-switch inline">
            {(["snowball", "avalanche"] as Strategy[]).map((option) => (
              <button key={option} className={strategy === option ? "on" : ""} onClick={() => onStrategyChange(option)}>
                <strong>{STRATEGY_COPY[option].name}</strong>
              </button>
            ))}
          </div>
        </article>
        <article>
          <div><strong>Extra each month</strong><p>Paid on top of every required minimum. This is the number that moves your finish date.</p></div>
          <button onClick={onSimulate}>{money2.format(extra)}</button>
        </article>
        <article>
          <div><strong>Rounding</strong><p>Interest is calculated monthly as APR ÷ 12 on the balance carried into the month, rounded to the cent.</p></div>
          <span className="setting-value">Monthly</span>
        </article>
      </div>
      <article className="privacy-panel">
        <div>
          <strong>Why there is no bank sync</strong>
          <p>
            Manual updates avoid storing bank credentials entirely. A 30-second monthly check-in gives the forecast
            everything it needs, and the trade is that balances are only as current as your last update.
          </p>
        </div>
        <button onClick={onUpdate}>Update balances</button>
      </article>
    </section>
  );
}

function ordinal(day: number) {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][day % 10] ?? "th";
}

/** The three lines every forecast chart shows, with their finish dates. */
function forecastSeries(plan: Plan, baseline: Plan, faster: Plan, simExtra: number): Series[] {
  const note = (item: Plan) => {
    const date = payoffDate(item);
    if (!date) return item.complete ? "Nothing left to pay" : "Never finishes at this amount";
    return `Debt-free ${formatMonth(date)} · ${formatDuration(item.monthCount)}`;
  };
  const series: Series[] = [];

  if (baseline.monthCount > 0) {
    series.push({
      key: "baseline",
      label: "Minimums only",
      variant: "minimums",
      points: balanceSeries(baseline),
      note: baseline.complete ? note(baseline) : "Never finishes on minimums alone",
    });
  }
  series.push({
    key: "plan",
    label: "Your plan",
    variant: "plan",
    points: balanceSeries(plan),
    note: note(plan),
  });
  if (simExtra > 0) {
    series.push({
      key: "faster",
      label: `Plus ${money.format(simExtra)}/mo`,
      variant: "faster",
      points: balanceSeries(faster),
      note: note(faster),
    });
  }
  return series;
}

type HomeProps = {
  sharedState?: DebtState;
  onSharedStateChange?: (state: DebtState) => void;
  headerControls?: ReactNode;
  userDisplayName?: string;
};

type DebtDraft = {
  name: string;
  balance: string;
  original: string;
  apr: string;
  minimum: string;
  dueDay: string;
  accent: string;
  mark: string;
};

const ACCENTS = ["#3f6d63", "#5b7fa6", "#a2704f", "#7a6b95", "#b0834a", "#6d8f5c"];

const EMPTY_DEBT_DRAFT: DebtDraft = {
  name: "",
  balance: "",
  original: "",
  apr: "",
  minimum: "",
  dueDay: "1",
  accent: ACCENTS[0],
  mark: "◆",
};

const NAV: [string, string][] = [
  ["Overview", "⌂"],
  ["Accounts", "▤"],
  ["Payoff Plan", "↗"],
  ["Schedule", "▦"],
  ["Progress", "◔"],
  ["Reminders", "◷"],
  ["Settings", "⚙"],
];

export default function Home({
  sharedState,
  onSharedStateChange,
  headerControls,
  userDisplayName = "there",
}: HomeProps = {}) {
  const [debts, setDebts] = useState<Debt[]>(sharedState?.debts ?? []);
  const [extra, setExtra] = useState(sharedState?.extra ?? 0);
  const [strategy, setStrategy] = useState<Strategy>(sharedState?.strategy ?? "snowball");
  const [simExtra, setSimExtra] = useState(100);
  const [active, setActive] = useState("Overview");
  const [modal, setModal] = useState<"update" | "simulator" | "debt" | null>(null);
  const [draftBalances, setDraftBalances] = useState<Record<number, string>>({});
  const [editingDebtId, setEditingDebtId] = useState<number | null>(null);
  const [debtDraft, setDebtDraft] = useState<DebtDraft>(EMPTY_DEBT_DRAFT);
  const [toast, setToast] = useState("");
  const now = useClientNow();

  useEffect(() => {
    if (sharedState) {
      const sharedTimer = window.setTimeout(() => {
        setDebts(sharedState.debts);
        setExtra(sharedState.extra);
        setStrategy(sharedState.strategy ?? "snowball");
      }, 0);
      return () => window.clearTimeout(sharedTimer);
    }

    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem("debt-snowball-state");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.debts)) setDebts(parsed.debts);
          if (typeof parsed.extra === "number") setExtra(parsed.extra);
          if (parsed.strategy === "avalanche" || parsed.strategy === "snowball") setStrategy(parsed.strategy);
        }
      } catch {
        // A clean default state is safer than blocking the dashboard.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sharedState]);

  const total = debts.reduce((sum, debt) => sum + debt.balance, 0);
  const original = debts.reduce((sum, debt) => sum + debt.original, 0);
  const paid = Math.max(0, original - total);
  const progress = original > 0 ? Math.max(0, Math.min(100, Math.round((paid / original) * 100))) : 0;

  const plan = useMemo(() => buildPlan(debts, extra, strategy), [debts, extra, strategy]);
  const baseline = useMemo(() => buildPlan(debts, 0, strategy, { roll: false }), [debts, strategy]);
  const faster = useMemo(() => buildPlan(debts, extra + simExtra, strategy), [debts, extra, simExtra, strategy]);
  const alternative = useMemo(
    () => buildPlan(debts, extra, strategy === "snowball" ? "avalanche" : "snowball"),
    [debts, extra, strategy],
  );

  const monthsSaved = Math.max(0, plan.monthCount - faster.monthCount);
  const interestSaved = Math.max(0, plan.totalInterest - faster.totalInterest);
  const dueSoon = debts.filter((debt) => {
    const due = nextDueDate(debt.dueDay);
    return (due.getTime() - Date.now()) / 86400000 <= 7;
  }).length;

  function openUpdate() {
    if (debts.length === 0) {
      openDebtEditor();
      return;
    }
    setDraftBalances(Object.fromEntries(debts.map((debt) => [debt.id, debt.balance.toString()])));
    setModal("update");
  }

  function openDebtEditor(debt?: Debt) {
    setEditingDebtId(debt?.id ?? null);
    setDebtDraft(debt ? {
      name: debt.name,
      balance: debt.balance.toString(),
      original: debt.original.toString(),
      apr: debt.apr.toString(),
      minimum: debt.minimum.toString(),
      dueDay: debt.dueDay.toString(),
      accent: debt.accent,
      mark: debt.mark,
    } : { ...EMPTY_DEBT_DRAFT, accent: ACCENTS[debts.length % ACCENTS.length] });
    setModal("debt");
  }

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  function saveDebt() {
    const name = debtDraft.name.trim();
    const balance = Math.max(0, Number(debtDraft.balance) || 0);
    const originalBalance = Math.max(0.01, Number(debtDraft.original) || balance || 0.01);
    const apr = Math.max(0, Number(debtDraft.apr) || 0);
    const minimum = Math.max(0, Number(debtDraft.minimum) || 0);
    const dueDay = Math.max(1, Math.min(31, Math.trunc(Number(debtDraft.dueDay) || 1)));
    if (!name) return;

    const nextDebt: Debt = {
      id: editingDebtId ?? Math.max(0, ...debts.map((debt) => debt.id)) + 1,
      name,
      balance,
      original: originalBalance,
      apr,
      minimum,
      dueDay,
      accent: debtDraft.accent,
      mark: debtDraft.mark || "◆",
    };
    const updated = editingDebtId === null
      ? [...debts, nextDebt]
      : debts.map((debt) => (debt.id === editingDebtId ? nextDebt : debt));
    setDebts(updated);
    persistState(updated, extra, strategy);
    setModal(null);
    flash(editingDebtId === null ? `${name} added to your plan.` : `${name} updated.`);
  }

  function deleteDebt() {
    if (editingDebtId === null) return;
    const debt = debts.find((item) => item.id === editingDebtId);
    if (!debt || !window.confirm(`Remove ${debt.name} from the plan?`)) return;
    const updated = debts.filter((item) => item.id !== editingDebtId);
    setDebts(updated);
    persistState(updated, extra, strategy);
    setModal(null);
    flash(`${debt.name} removed.`);
  }

  function saveBalances() {
    const updated = debts.map((debt) => ({
      ...debt,
      balance: Math.max(0, Number(draftBalances[debt.id]) || 0),
    }));
    setDebts(updated);
    persistState(updated, extra, strategy);
    setModal(null);
    flash("Balances updated — the forecast has been recalculated.");
  }

  function saveExtra(value: number) {
    const next = Math.max(0, value);
    setExtra(next);
    persistState(debts, next, strategy);
  }

  function changeStrategy(next: Strategy) {
    setStrategy(next);
    persistState(debts, extra, next);
    flash(`Now paying ${STRATEGY_COPY[next].rule.toLowerCase()}.`);
  }

  function persistState(nextDebts: Debt[], nextExtra: number, nextStrategy: Strategy) {
    const nextState: DebtState = { debts: nextDebts, extra: nextExtra, strategy: nextStrategy };
    if (onSharedStateChange) {
      onSharedStateChange(nextState);
      return;
    }
    localStorage.setItem("debt-snowball-state", JSON.stringify(nextState));
  }

  const headline = active === "Overview"
    ? `${now ? greeting(now) : "Hello"}, ${userDisplayName}`
    : active;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setActive("Overview")} aria-label="Debt Snowball home">
          <span className="brand-orbit"><i /></span>
          <span>Debt<br />Snowball</span>
        </button>
        <nav aria-label="Main navigation">
          {NAV.map(([label, glyph]) => (
            <button key={label} className={active === label ? "active" : ""} onClick={() => setActive(label)} aria-current={active === label ? "page" : undefined}>
              <Icon>{glyph}</Icon><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <span>Debt-free</span>
          <strong>{debts.length > 0 ? finishLabel(plan) : "—"}</strong>
          <small>{plan.complete && plan.monthCount > 0 ? `${formatDuration(plan.monthCount)} to go` : "Add your accounts to see this"}</small>
        </div>
        <p className="privacy-note"><span aria-hidden="true">✓</span> Stored privately on this device</p>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">{now ? now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase() : ""}</p>
            <h1>{headline}</h1>
            <p className="subtitle">
              {active === "Overview"
                ? debts.length > 0
                  ? `${money.format(total)} left across ${debts.length} ${debts.length === 1 ? "account" : "accounts"}.`
                  : "Add your first account to build a payoff plan."
                : "Your plan, in detail."}
            </p>
          </div>
          <div className="header-actions">
            {headerControls}
            <button className="btn-primary" onClick={openUpdate}>Update balances</button>
            {dueSoon > 0 && (
              <button className="due-chip" onClick={() => setActive("Reminders")}>
                <b>{dueSoon}</b> due within 7 days
              </button>
            )}
          </div>
        </header>

        {active === "Overview" ? (
          <>
            <PlanWarnings plan={plan} onFix={() => setModal("simulator")} />

            <section className="hero-grid">
              <article className="panel standing-card">
                <p className="card-label">WHAT YOU OWE TODAY</p>
                <div className="standing-top">
                  <div>
                    <strong className="total-number">{money.format(total)}</strong>
                    {paid > 0 && <span className="paid-pill">{money.format(paid)} paid down so far</span>}
                  </div>
                  <ProgressRing percent={progress} />
                </div>
                <dl className="standing-facts">
                  <div>
                    <dt>Debt-free</dt>
                    <dd className="accent-value">{debts.length > 0 ? finishLabel(plan) : "—"}</dd>
                  </div>
                  <div>
                    <dt>Interest still ahead</dt>
                    <dd>{lifetimeLabel(plan, plan.totalInterest)}</dd>
                  </div>
                  <div>
                    <dt>You pay each month</dt>
                    <dd>{money2.format(plan.budget)}</dd>
                  </div>
                </dl>
              </article>

              <ThisMonthPanel plan={plan} debts={debts} onOpenSchedule={() => setActive("Schedule")} />

              <article className="panel whatif-card">
                <p className="card-label">WHAT IF</p>
                <h3 className="panel-title">You added {money.format(simExtra)} a month?</h3>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="1000"
                  step="25"
                  value={simExtra}
                  onChange={(event) => setSimExtra(Number(event.target.value))}
                  aria-label="Extra monthly payment to test"
                />
                <dl className="whatif-results">
                  <div><dt>Finish</dt><dd>{monthsSaved > 0 ? `${formatDuration(monthsSaved)} sooner` : "No change yet"}</dd></div>
                  <div><dt>Interest saved</dt><dd className="positive">{money.format(interestSaved)}</dd></div>
                  <div><dt>New debt-free date</dt><dd>{finishLabel(faster)}</dd></div>
                </dl>
                <button className="btn-primary wide" onClick={() => setModal("simulator")} disabled={debts.length === 0}>
                  Add it to my plan
                </button>
              </article>
            </section>

            <section className="panel chart-panel">
              <div className="panel-heading">
                <div>
                  <span className="card-label">BALANCE OVER TIME</span>
                  <strong className="panel-title">How the debt actually shrinks</strong>
                  <p className="panel-note">Each numbered marker is the month an account disappears and its payment rolls into the next one.</p>
                </div>
              </div>
              {debts.length > 0 ? (
                <TrajectoryChart
                  plan={plan}
                  debts={debts}
                  series={forecastSeries(plan, baseline, faster, simExtra)}
                />
              ) : (
                <p className="panel-note empty-chart">Add an account and the forecast draws itself here.</p>
              )}
            </section>

            <section className="debt-section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">YOUR ACCOUNTS</p>
                  <h2>Every balance has a finish date</h2>
                </div>
                <button className="btn-quiet" onClick={() => setActive("Accounts")}>See all details →</button>
              </div>
              <div className="debts-grid">
                {debts.map((debt) => (
                  <DebtCard
                    key={debt.id}
                    debt={debt}
                    plan={plan}
                    focused={debt.id === plan.order[0]}
                    onEdit={openDebtEditor}
                  />
                ))}
                <button className="empty-debts-card" onClick={() => openDebtEditor()}>
                  <span aria-hidden="true">+</span>
                  <strong>{debts.length === 0 ? "Add your first account" : "Add another account"}</strong>
                  <small>Balance, APR, minimum, due day.</small>
                </button>
              </div>
            </section>

            <section className="bottom-strip">
              <div><span>Required minimums</span><strong>{money2.format(Math.max(0, plan.budget - extra))}</strong></div>
              <div><span>Extra you add</span><strong className="positive">{money2.format(extra)}</strong></div>
              <div><span>Total monthly</span><strong>{money2.format(plan.budget)}</strong></div>
              <div><span>Total interest ahead</span><strong>{lifetimeLabel(plan, plan.totalInterest)}</strong></div>
              <div><span>Payments left</span><strong className="accent-value">{plan.complete ? plan.monthCount : "—"}</strong></div>
            </section>
          </>
        ) : (
          <SecondaryView
            active={active}
            debts={debts}
            extra={extra}
            strategy={strategy}
            total={total}
            original={original}
            paid={paid}
            progress={progress}
            plan={plan}
            baseline={baseline}
            faster={faster}
            alternative={alternative}
            simExtra={simExtra}
            onUpdate={openUpdate}
            onSimulate={() => setModal("simulator")}
            onAddDebt={() => openDebtEditor()}
            onEditDebt={openDebtEditor}
            onStrategyChange={changeStrategy}
            onNavigate={setActive}
            sharedMode={Boolean(onSharedStateChange)}
          />
        )}
      </section>

      {modal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setModal(null)} aria-label="Close">×</button>
            {modal === "update" ? (
              <>
                <p className="eyebrow">MONTHLY CHECK-IN</p>
                <h2 id="modal-title">Update your balances</h2>
                <p className="modal-intro">Enter the latest statement balance for each account. Everything else recalculates from these numbers.</p>
                <div className="balance-inputs">
                  {debts.map((debt) => (
                    <label key={debt.id}>
                      <span><i style={{ background: debt.accent }}>{debt.mark}</i>{debt.name}</span>
                      <span className="currency-input">
                        <b>$</b>
                        <input
                          inputMode="decimal"
                          value={draftBalances[debt.id] ?? ""}
                          onChange={(event) => setDraftBalances({ ...draftBalances, [debt.id]: event.target.value })}
                          aria-label={`${debt.name} balance`}
                        />
                      </span>
                    </label>
                  ))}
                </div>
                <button className="modal-primary" onClick={saveBalances}>Save and recalculate</button>
                <p className="local-note">{onSharedStateChange ? "Saved to your private-network server." : "Your numbers stay in this browser."} No bank connection is used.</p>
              </>
            ) : modal === "debt" ? (
              <>
                <p className="eyebrow">{editingDebtId === null ? "NEW ACCOUNT" : "ACCOUNT DETAILS"}</p>
                <h2 id="modal-title">{editingDebtId === null ? "Add an account" : "Edit this account"}</h2>
                <p className="modal-intro">These four numbers drive the whole forecast. Card numbers and bank logins are never requested.</p>
                <div className="debt-editor-grid">
                  <label className="wide-field">Account name
                    <input autoFocus value={debtDraft.name} maxLength={80} onChange={(event) => setDebtDraft({ ...debtDraft, name: event.target.value })} placeholder="Card or lender name" />
                  </label>
                  <label>Current balance
                    <input type="number" inputMode="decimal" min="0" step="0.01" value={debtDraft.balance} onChange={(event) => setDebtDraft({ ...debtDraft, balance: event.target.value })} />
                    <small>What you owe right now.</small>
                  </label>
                  <label>Starting balance
                    <input type="number" inputMode="decimal" min="0.01" step="0.01" value={debtDraft.original} onChange={(event) => setDebtDraft({ ...debtDraft, original: event.target.value })} />
                    <small>Used only for the &ldquo;paid off&rdquo; percentage.</small>
                  </label>
                  <label>APR %
                    <input type="number" inputMode="decimal" min="0" max="1000" step="0.01" value={debtDraft.apr} onChange={(event) => setDebtDraft({ ...debtDraft, apr: event.target.value })} />
                    <small>The purchase rate from your statement.</small>
                  </label>
                  <label>Minimum payment
                    <input type="number" inputMode="decimal" min="0" step="0.01" value={debtDraft.minimum} onChange={(event) => setDebtDraft({ ...debtDraft, minimum: event.target.value })} />
                    <small>Held fixed for the whole forecast.</small>
                  </label>
                  <label>Due day
                    <input type="number" inputMode="numeric" min="1" max="31" step="1" value={debtDraft.dueDay} onChange={(event) => setDebtDraft({ ...debtDraft, dueDay: event.target.value })} />
                    <small>Day of the month.</small>
                  </label>
                  <label>Colour
                    <input type="color" value={debtDraft.accent} onChange={(event) => setDebtDraft({ ...debtDraft, accent: event.target.value })} />
                  </label>
                </div>
                <button className="modal-primary" onClick={saveDebt} disabled={!debtDraft.name.trim()}>Save account</button>
                {editingDebtId !== null && <button className="modal-danger" onClick={deleteDebt}>Remove this account</button>}
              </>
            ) : (
              <>
                <p className="eyebrow">PAYOFF SIMULATOR</p>
                <h2 id="modal-title">Turn &ldquo;what if&rdquo; into a date</h2>
                <p className="modal-intro">Your minimums total {money2.format(Math.max(0, plan.budget - extra))} a month. Anything above that goes straight at the target account.</p>
                <div className="slider-value">{money.format(simExtra)}<span> extra per month</span></div>
                <input className="range" type="range" min="0" max="1000" step="25" value={simExtra} onChange={(event) => setSimExtra(Number(event.target.value))} aria-label="Extra monthly payment" />
                <div className="sim-grid">
                  <div><span>Debt-free</span><strong>{finishLabel(faster)}</strong><small>{monthsSaved > 0 ? `${formatDuration(monthsSaved)} sooner than now` : "same as your current plan"}</small></div>
                  <div><span>Interest saved</span><strong>{money.format(interestSaved)}</strong><small>compared with {lifetimeLabel(plan, plan.totalInterest)} today</small></div>
                  <div><span>New monthly total</span><strong>{money2.format(plan.budget + simExtra)}</strong><small>including all minimums</small></div>
                  <div><span>Total you would pay</span><strong>{lifetimeLabel(faster, faster.totalPaid)}</strong><small>instead of {lifetimeLabel(plan, plan.totalPaid)}</small></div>
                </div>
                <button
                  className="modal-primary"
                  onClick={() => {
                    saveExtra(extra + simExtra);
                    setModal(null);
                    flash(`${money.format(simExtra)} added to your monthly total.`);
                  }}
                  disabled={simExtra <= 0 || debts.length === 0}
                >
                  Add {money.format(simExtra)} to my plan
                </button>
                {extra > 0 && (
                  <button className="modal-secondary" onClick={() => { saveExtra(0); setModal(null); flash("Extra payment cleared."); }}>
                    Clear my current {money2.format(extra)} extra
                  </button>
                )}
                <p className="local-note">Estimates use fixed minimums and monthly compounding, so issuer statements can differ slightly.</p>
              </>
            )}
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status"><span aria-hidden="true">✓</span>{toast}</div>}
    </main>
  );
}
