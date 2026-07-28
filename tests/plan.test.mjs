import assert from "node:assert/strict";
import test from "node:test";
import { buildPlan, nextDueDate, attackOrder } from "../dist-test/plan.js";

const debt = (over = {}) => ({
  id: 1,
  name: "Card",
  balance: 1000,
  original: 1000,
  apr: 12,
  minimum: 100,
  dueDay: 15,
  accent: "#3d6b5f",
  mark: "◆",
  ...over,
});

test("single debt matches the closed-form amortization length", () => {
  // P=1000, r=1%/mo, A=100 -> n = -ln(1 - rP/A)/ln(1+r) = 10.59 -> 11 payments
  const plan = buildPlan([debt()], 0);
  assert.equal(plan.complete, true);
  assert.equal(plan.monthCount, 11);
  assert.equal(plan.months[0].interest, 10);
  assert.equal(plan.months[0].principal, 90);
  assert.equal(plan.months[0].end, 910);
});

test("every dollar is accounted for: paid == starting balance + interest", () => {
  const plan = buildPlan([
    debt({ id: 1, balance: 2400, original: 2400, apr: 22.99, minimum: 60 }),
    debt({ id: 2, balance: 800, original: 800, apr: 17.49, minimum: 25 }),
    debt({ id: 3, balance: 6100, original: 6100, apr: 26.99, minimum: 150 }),
  ], 200);

  assert.equal(plan.complete, true);
  const drift = Math.abs(plan.totalPaid - (plan.startBalance + plan.totalInterest));
  assert.ok(drift < 0.02, `expected balanced books, drifted by ${drift}`);
});

test("per-month rows reconcile with the running balance", () => {
  const plan = buildPlan([
    debt({ id: 1, balance: 2400, original: 2400, apr: 22.99, minimum: 60 }),
    debt({ id: 2, balance: 800, original: 800, apr: 17.49, minimum: 25 }),
  ], 75);

  let running = plan.startBalance;
  for (const month of plan.months) {
    assert.ok(Math.abs(month.start - running) < 0.005, `month ${month.index} start mismatch`);
    const expectedEnd = month.start + month.interest - month.payment;
    assert.ok(Math.abs(month.end - expectedEnd) < 0.005, `month ${month.index} end mismatch`);
    assert.ok(Math.abs(month.principal - (month.payment - month.interest)) < 0.005);
    running = month.end;
  }
  assert.equal(running, 0);
});

test("snowball attacks the smallest balance, avalanche the highest rate", () => {
  const debts = [
    debt({ id: 1, name: "Big low rate", balance: 9000, original: 9000, apr: 11, minimum: 180 }),
    debt({ id: 2, name: "Small high rate", balance: 1200, original: 1200, apr: 27, minimum: 40 }),
  ];
  assert.deepEqual(attackOrder(debts, "snowball"), [2, 1]);
  assert.deepEqual(attackOrder(debts, "avalanche"), [2, 1]);

  const mixed = [
    debt({ id: 1, name: "Small low rate", balance: 900, original: 900, apr: 9, minimum: 30 }),
    debt({ id: 2, name: "Big high rate", balance: 7000, original: 7000, apr: 26, minimum: 160 }),
  ];
  assert.deepEqual(attackOrder(mixed, "snowball"), [1, 2]);
  assert.deepEqual(attackOrder(mixed, "avalanche"), [2, 1]);

  // Avalanche never costs more interest than snowball on the same budget.
  const snowball = buildPlan(mixed, 150, "snowball");
  const avalanche = buildPlan(mixed, 150, "avalanche");
  assert.ok(avalanche.totalInterest <= snowball.totalInterest + 0.01);
});

test("rolling freed minimums beats leaving them behind", () => {
  const debts = [
    debt({ id: 1, balance: 1500, original: 1500, apr: 19.99, minimum: 45 }),
    debt({ id: 2, balance: 4200, original: 4200, apr: 24.99, minimum: 105 }),
  ];
  const rolled = buildPlan(debts, 0, "snowball");
  const flat = buildPlan(debts, 0, "snowball", { roll: false });

  assert.ok(rolled.monthCount < flat.monthCount);
  assert.ok(rolled.totalInterest < flat.totalInterest);
});

test("a budget below the interest charge is reported, not silently capped", () => {
  // $10,000 at 30% accrues $250/mo; a $200 minimum can never clear it.
  const plan = buildPlan([debt({ balance: 10000, original: 10000, apr: 30, minimum: 200 })], 0);
  assert.equal(plan.complete, false);
  assert.equal(plan.stalled.length, 1);
  assert.ok(Math.abs(plan.stalled[0].shortfall - 50) < 0.01);
  assert.ok(plan.monthCount < 5, "should bail out early instead of running to the cap");
});

test("extra payment shortens the plan and cuts interest", () => {
  const debts = [debt({ balance: 5000, original: 5000, apr: 21, minimum: 125 })];
  const base = buildPlan(debts, 0);
  const faster = buildPlan(debts, 200);
  assert.ok(faster.monthCount < base.monthCount);
  assert.ok(faster.totalInterest < base.totalInterest);
  assert.equal(faster.budget, 325);
});

test("an interest-free debt pays down at exactly the payment rate", () => {
  const plan = buildPlan([debt({ balance: 1000, original: 1000, apr: 0, minimum: 250 })], 0);
  assert.equal(plan.monthCount, 4);
  assert.equal(plan.totalInterest, 0);
  assert.equal(plan.totalPaid, 1000);
});

test("zero balances and empty lists produce an empty, complete plan", () => {
  assert.equal(buildPlan([], 0).monthCount, 0);
  assert.equal(buildPlan([], 0).complete, true);
  assert.equal(buildPlan([debt({ balance: 0 })], 0).monthCount, 0);
});

test("due dates clamp to short months instead of rolling into the next one", () => {
  assert.equal(nextDueDate(31, new Date(2026, 1, 5)).getDate(), 28);
  assert.equal(nextDueDate(31, new Date(2026, 1, 5)).getMonth(), 1);
  assert.equal(nextDueDate(29, new Date(2024, 1, 1)).getDate(), 29);

  // Already past this month -> next month, still clamped.
  const rolled = nextDueDate(31, new Date(2026, 0, 31, 12));
  assert.equal(rolled.getMonth(), 0);
  const nextMonth = nextDueDate(31, new Date(2026, 1, 1));
  assert.equal(nextMonth.getMonth(), 1);
  assert.equal(nextMonth.getDate(), 28);
});

test("a paid-off debt's payment lands on the next target that same month", () => {
  const debts = [
    debt({ id: 1, name: "Tiny", balance: 100, original: 100, apr: 0, minimum: 25 }),
    debt({ id: 2, name: "Rest", balance: 3000, original: 3000, apr: 18, minimum: 75 }),
  ];
  const plan = buildPlan(debts, 400, "snowball");
  const first = plan.months[0];
  const tiny = first.debts.find((row) => row.id === 1);
  const rest = first.debts.find((row) => row.id === 2);

  assert.equal(tiny.payment, 100);
  assert.equal(tiny.cleared, true);
  // Budget is 25 + 75 + 400 = 500; Tiny only absorbed 100, so Rest gets 400.
  assert.equal(rest.payment, 400);
  assert.equal(first.payment, 500);
});

test("milestones follow attack order and report the real targeted payment", async () => {
  const { milestones, milestonesByDate } = await import("../dist-test/plan.js");
  // Avalanche targets the big 27.99% card while the small cheap card crawls
  // along on its minimum — so attack order and payoff order disagree.
  const debts = [
    debt({ id: 1, name: "Small cheap", balance: 900, original: 900, apr: 8.9, minimum: 30, dueDay: 5 }),
    debt({ id: 2, name: "Big expensive", balance: 7400, original: 7400, apr: 27.99, minimum: 180, dueDay: 20 }),
  ];
  const plan = buildPlan(debts, 120, "avalanche");
  const steps = milestones(plan, debts);

  assert.equal(steps[0].debt.id, 2, "the targeted debt comes first");
  // Budget is 30 + 180 + 120 = 330; the small card keeps its own 30 for now,
  // and the big card picks that up once the small one clears.
  assert.equal(steps[0].currentPayment, 300);
  assert.equal(steps[0].peakPayment, 330);
  assert.equal(steps[1].currentPayment, 30);
  assert.equal(steps[1].peakPayment, 30);

  // …while the calendar order really is the other way round.
  const byDate = milestonesByDate(plan, debts);
  assert.equal(byDate[0].debt.id, 1);
  assert.ok(byDate[0].month < byDate[1].month);
});

test("under snowball, attack order and payoff order agree", async () => {
  const { milestones, milestonesByDate } = await import("../dist-test/plan.js");
  const debts = [
    debt({ id: 1, name: "A", balance: 4000, original: 4000, apr: 19, minimum: 90 }),
    debt({ id: 2, name: "B", balance: 700, original: 700, apr: 24, minimum: 25 }),
    debt({ id: 3, name: "C", balance: 1900, original: 1900, apr: 15, minimum: 45 }),
  ];
  const plan = buildPlan(debts, 100, "snowball");
  const order = milestones(plan, debts).map((step) => step.debt.id);
  const dates = milestonesByDate(plan, debts).map((step) => step.debt.id);
  assert.deepEqual(order, [2, 3, 1]);
  assert.deepEqual(order, dates);
});

test("owner breakdown splits the household without inventing separate plans", async () => {
  const { ownerBreakdown } = await import("../dist-test/plan.js");
  // Round synthetic figures: 8,000 + 12,000 = 20,000, so the shares are an
  // exact 40/60 and a wrong denominator would be obvious.
  const debts = [
    debt({ id: 1, name: "Card A", balance: 2000, original: 3000, apr: 20, minimum: 50, owner: "Alex" }),
    debt({ id: 2, name: "Card B", balance: 6000, original: 8000, apr: 22, minimum: 150, owner: "Alex" }),
    debt({ id: 3, name: "Card C", balance: 3000, original: 4000, apr: 24, minimum: 75, owner: "Jordan" }),
    debt({ id: 4, name: "Card D", balance: 9000, original: 12000, apr: 18, minimum: 200, owner: "Jordan" }),
  ];
  const plan = buildPlan(debts, 150, "snowball");
  const [alex, jordan] = ownerBreakdown(plan, debts);

  assert.equal(alex.owner, "Alex");
  assert.equal(alex.accounts, 2);
  assert.equal(alex.balance, 8000);
  assert.equal(alex.original, 11000);
  assert.equal(alex.paid, 3000);
  assert.equal(alex.minimums, 200);
  assert.equal(alex.share, 40);
  assert.equal(jordan.balance, 12000);
  assert.equal(jordan.minimums, 275);
  assert.equal(jordan.share, 60);

  // Interest reconciles with the household plan rather than being re-derived.
  const combined = alex.interestAhead + jordan.interestAhead;
  assert.ok(Math.abs(combined - plan.totalInterest) < 0.02, `owner interest ${combined} vs plan ${plan.totalInterest}`);

  // Each owner clears when the last of their own cards does.
  assert.equal(alex.clearedMonth, Math.max(plan.payoffMonth[1], plan.payoffMonth[2]));
  assert.equal(jordan.clearedMonth, Math.max(plan.payoffMonth[3], plan.payoffMonth[4]));
});

test("accounts with no owner fall back to a single Unassigned group", async () => {
  const { ownerBreakdown, ownerNames, ownerOf, UNASSIGNED_OWNER } = await import("../dist-test/plan.js");
  const debts = [
    debt({ id: 1, balance: 1200, original: 2000, minimum: 45 }),
    debt({ id: 2, balance: 3400, original: 4000, minimum: 90 }),
  ];
  assert.equal(ownerOf(debts[0]), UNASSIGNED_OWNER);
  assert.deepEqual(ownerNames(debts), [UNASSIGNED_OWNER]);

  const summaries = ownerBreakdown(buildPlan(debts, 100), debts);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].owner, UNASSIGNED_OWNER);
  assert.equal(summaries[0].accounts, 2);
  assert.equal(summaries[0].share, 100);
});

test("blank and whitespace owners are treated as unassigned, and sort last", async () => {
  const { ownerNames, ownerOf, UNASSIGNED_OWNER } = await import("../dist-test/plan.js");
  assert.equal(ownerOf(debt({ owner: "   " })), UNASSIGNED_OWNER);
  assert.equal(ownerOf(debt({ owner: "" })), UNASSIGNED_OWNER);
  assert.equal(ownerOf(debt({ owner: " Alex " })), "Alex");

  const mixed = [
    debt({ id: 1, owner: "Jordan" }),
    debt({ id: 2 }),
    debt({ id: 3, owner: "Alex" }),
  ];
  assert.deepEqual(ownerNames(mixed), ["Alex", "Jordan", UNASSIGNED_OWNER]);
});
