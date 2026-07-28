"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

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

export type DebtState = {
  debts: Debt[];
  extra: number;
};

type Projection = {
  months: number;
  interest: number;
  points: number[];
};

const DEFAULT_DEBTS: Debt[] = [];

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function simulate(debts: Debt[], extra: number): Projection {
  const items = debts
    .filter((debt) => debt.balance > 0)
    .map((debt) => ({ ...debt }));
  const monthlyBudget = items.reduce((sum, debt) => sum + debt.minimum, 0) + extra;
  const points = [items.reduce((sum, debt) => sum + debt.balance, 0)];
  let interest = 0;
  let months = 0;

  while (items.some((debt) => debt.balance > 0.01) && months < 600) {
    months += 1;
    let available = monthlyBudget;

    items.forEach((debt) => {
      if (debt.balance <= 0) return;
      const charge = debt.balance * (debt.apr / 100 / 12);
      debt.balance += charge;
      interest += charge;
    });

    items.forEach((debt) => {
      if (debt.balance <= 0) return;
      const payment = Math.min(debt.minimum, debt.balance, available);
      debt.balance -= payment;
      available -= payment;
    });

    for (const debt of [...items].sort((a, b) => a.balance - b.balance)) {
      if (available <= 0 || debt.balance <= 0) continue;
      const payment = Math.min(available, debt.balance);
      debt.balance -= payment;
      available -= payment;
    }

    if (months === 1 || months % 3 === 0 || items.every((debt) => debt.balance <= 0.01)) {
      points.push(Math.max(0, items.reduce((sum, debt) => sum + debt.balance, 0)));
    }
  }

  return { months, interest, points };
}

function payoffDate(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function dueLabel(day: number) {
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), day);
  if (due < now) due.setMonth(due.getMonth() + 1);
  const days = Math.max(0, Math.ceil((due.getTime() - now.getTime()) / 86400000));
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
}

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function TrajectoryChart({
  base,
  faster,
}: {
  base: Projection;
  faster: Projection;
}) {
  const width = 660;
  const height = 260;
  const padX = 38;
  const padY = 24;
  const maxDebt = Math.max(base.points[0] || 1, faster.points[0] || 1);
  const maxLen = Math.max(base.points.length, faster.points.length, 2);

  const pathFor = (points: number[]) =>
    points
      .map((value, index) => {
        const x = padX + (index / (maxLen - 1)) * (width - padX * 1.5);
        const y = padY + (1 - value / maxDebt) * (height - padY * 2);
        return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");

  const basePath = pathFor(base.points);
  const fastPath = pathFor(faster.points);
  const baseEnd = padX + ((base.points.length - 1) / (maxLen - 1)) * (width - padX * 1.5);

  return (
    <div className="chart-wrap">
      <svg className="trajectory" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Debt balance projection over time">
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#315BE8" stopOpacity=".24" />
            <stop offset="100%" stopColor="#315BE8" stopOpacity=".02" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((line) => {
          const y = padY + (line / 3) * (height - padY * 2);
          return <line key={line} x1={padX} x2={width - 10} y1={y} y2={y} className="grid-line" />;
        })}
        <path d={`${basePath} L ${baseEnd} ${height - padY} L ${padX} ${height - padY} Z`} fill="url(#areaFill)" />
        <path d={basePath} className="line base-line" pathLength="1" />
        <path d={fastPath} className="line fast-line" pathLength="1" />
        <circle cx={padX} cy={padY} r="5" className="start-dot" />
        <text x="0" y={padY + 5} className="axis-label">{money.format(maxDebt)}</text>
        <text x="15" y={height - padY + 5} className="axis-label">$0</text>
        <text x={padX} y={height - 2} className="axis-label">Today</text>
        <text x={width - 105} y={height - 2} className="axis-label">{payoffDate(base.months)}</text>
      </svg>
    </div>
  );
}

function DebtCard({ debt, focused, onEdit }: { debt: Debt; focused: boolean; onEdit: (debt: Debt) => void }) {
  const progress = debt.original > 0
    ? Math.max(0, Math.min(100, Math.round((1 - debt.balance / debt.original) * 100)))
    : 0;
  return (
    <article className={`debt-card ${focused ? "focused" : ""}`} style={{ "--accent": debt.accent } as React.CSSProperties}>
      <div className="debt-card-top">
        <span className="card-mark">{debt.mark}</span>
        <span className="debt-name">{debt.name}</span>
        <button className="more-button" onClick={() => onEdit(debt)} aria-label={`Edit ${debt.name}`}>•••</button>
      </div>
      <strong className="debt-balance">{money.format(debt.balance)}</strong>
      <div className="apr-row"><span>APR {debt.apr.toFixed(2)}%</span>{focused && <span className="focus-pill">Snowball focus</span>}</div>
      <div className="mini-track" aria-label={`${progress}% paid off`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className="progress-label">{progress}% paid off</p>
      <div className="debt-meta">
        <span>Minimum <strong>{money.format(debt.minimum)}</strong></span>
        <span>Due <strong style={{ color: debt.accent }}>Aug {String(debt.dueDay).padStart(2, "0")}</strong></span>
      </div>
    </article>
  );
}

function SecondaryView({
  active,
  debts,
  extra,
  total,
  original,
  paid,
  progress,
  projection,
  fasterProjection,
  onUpdate,
  onSimulate,
  onAddDebt,
  onEditDebt,
  sharedMode,
}: {
  active: string;
  debts: Debt[];
  extra: number;
  total: number;
  original: number;
  paid: number;
  progress: number;
  projection: Projection;
  fasterProjection: Projection;
  onUpdate: () => void;
  onSimulate: () => void;
  onAddDebt: () => void;
  onEditDebt: (debt: Debt) => void;
  sharedMode: boolean;
}) {
  const [reminders, setReminders] = useState<Record<number, boolean>>(
    Object.fromEntries(debts.map((debt) => [debt.id, true])),
  );
  const ordered = [...debts].sort((a, b) => a.balance - b.balance);
  const monthsSaved = Math.max(0, projection.months - fasterProjection.months);
  const interestSaved = Math.max(0, projection.interest - fasterProjection.interest);
  const highestAprDebt = [...debts].sort((a, b) => b.apr - a.apr)[0];

  if (active === "My Debts") {
    return (
      <section className="workspace-view">
        <div className="view-toolbar">
          <div><p className="eyebrow">{debts.length} ACTIVE {debts.length === 1 ? "ACCOUNT" : "ACCOUNTS"}</p><h2>Balances at a glance</h2><p>Update once a month. The plan recalculates instantly.</p></div>
          <div className="view-toolbar-actions">
            <button className="view-secondary" onClick={onAddDebt}>+ Add account</button>
            <button className="view-primary" onClick={onUpdate} disabled={debts.length === 0}>↻ Update balances</button>
          </div>
        </div>
        <div className="account-list">
          {debts.map((debt) => {
            const debtProgress = Math.round((1 - debt.balance / debt.original) * 100);
            return (
              <article key={debt.id} style={{ "--accent": debt.accent } as React.CSSProperties}>
                <span className="account-mark">{debt.mark}</span>
                <div className="account-main">
                  <div><strong>{debt.name}</strong><span>{debt.apr.toFixed(2)}% APR · due Aug {debt.dueDay}</span></div>
                  <div className="account-progress"><span style={{ width: `${debtProgress}%` }} /></div>
                </div>
                <div className="account-stat"><span>Balance</span><strong>{money.format(debt.balance)}</strong></div>
                <div className="account-stat"><span>Minimum</span><strong>{money.format(debt.minimum)}</strong></div>
                <div className="account-stat paid-stat"><span>Paid off</span><strong>{debtProgress}%</strong></div>
                <button onClick={() => onEditDebt(debt)} aria-label={`Edit ${debt.name}`}>•••</button>
              </article>
            );
          })}
          {debts.length === 0 && (
            <button className="empty-account-state" onClick={onAddDebt}>
              <strong>Add your first account</strong>
              <span>No balances are built into this copy of Debt Squasher.</span>
            </button>
          )}
        </div>
        {highestAprDebt && (
          <div className="debt-insight">
            <span>💡</span>
            <div><strong>Your highest APR is {highestAprDebt.name} at {highestAprDebt.apr.toFixed(2)}%.</strong><p>The snowball plan prioritizes the smallest balance for momentum.</p></div>
          </div>
        )}
      </section>
    );
  }

  if (active === "Snowball Plan") {
    return (
      <section className="workspace-view">
        <div className="view-toolbar">
          <div><p className="eyebrow">YOUR PERSONAL ROADMAP</p><h2>The snowball ladder</h2><p>When one card is gone, its payment rolls directly into the next.</p></div>
          <button className="view-primary coral" onClick={onSimulate}>Tune monthly payment</button>
        </div>
        <div className="plan-layout">
          <div className="snowball-ladder">
            {ordered.map((debt, index) => {
              const targetMonths = ordered.slice(0, index + 1).reduce((sum, item, itemIndex) => (
                sum + Math.max(1, Math.ceil(item.balance / (item.minimum + (itemIndex === 0 ? extra : 100))))
              ), 0);
              return (
                <article key={debt.id} className={index === 0 ? "current-step" : ""}>
                  <div className="step-number">{index + 1}</div>
                  <div className="step-card">
                    <div><span>{index === 0 ? "CURRENT FOCUS" : `STEP ${index + 1}`}</span><strong>{debt.name}</strong></div>
                    <div><span>Balance</span><strong>{money.format(debt.balance)}</strong></div>
                    <div><span>Target</span><strong>{payoffDate(targetMonths)}</strong></div>
                    <div><span>Payment grows to</span><strong>{money.format(extra + ordered.slice(0, index + 1).reduce((sum, item) => sum + item.minimum, 0))}</strong></div>
                  </div>
                </article>
              );
            })}
          </div>
          <aside className="plan-summary">
            <span className="plan-orbit">◎</span>
            <p>YOUR FINISH LINE</p>
            <h3>{payoffDate(projection.months)}</h3>
            <span>About {projection.months} months from now</span>
            <div><span>Monthly plan</span><strong>{money.format(debts.reduce((sum, debt) => sum + debt.minimum, 0) + extra)}</strong></div>
            <div><span>Extra snowball</span><strong>{money.format(extra)}</strong></div>
            <button onClick={onSimulate}>See a faster plan →</button>
          </aside>
        </div>
      </section>
    );
  }

  if (active === "Goals") {
    const goals = [
      { name: "First update", detail: "You showed up for your plan.", icon: "✓", state: "earned" },
      { name: "$5K crushed", detail: "First major balance milestone.", icon: "★", state: "earned" },
      { name: "8-week streak", detail: "Eight consistent weekly wins.", icon: "♨", state: "earned" },
      { name: "Under $25K", detail: `${money.format(Math.max(0, total - 25000))} to go`, icon: "↘", state: total <= 25000 ? "earned" : "next" },
      { name: "Halfway free", detail: `${Math.max(0, 50 - progress)}% more to unlock`, icon: "◐", state: progress >= 50 ? "earned" : "locked" },
      { name: "Final card", detail: "One balance standing.", icon: "1", state: debts.filter((debt) => debt.balance > 0).length <= 1 ? "earned" : "locked" },
    ];
    const nextGoalProgress = original > 25000
      ? Math.min(100, Math.max(0, ((original - total) / (original - 25000)) * 100))
      : total <= 25000 ? 100 : 0;
    return (
      <section className="workspace-view">
        <div className="goal-hero">
          <div><p className="eyebrow">MOMENTUM BOARD</p><h2>Small wins become financial freedom.</h2><p>You’ve paid down {money.format(paid)}. That’s real progress—not just a percentage.</p></div>
          <div className="goal-progress-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}><span><strong>{progress}%</strong> complete</span></div>
        </div>
        <div className="goals-grid">
          {goals.map((goal) => (
            <article key={goal.name} className={goal.state}>
              <span className="goal-badge">{goal.icon}</span>
              <div><span>{goal.state === "earned" ? "UNLOCKED" : goal.state === "next" ? "NEXT GOAL" : "LOCKED"}</span><strong>{goal.name}</strong><p>{goal.detail}</p></div>
            </article>
          ))}
        </div>
        <article className="next-goal">
          <div><span>Next finish flag</span><strong>Bring total debt under $25,000</strong></div>
          <div className="goal-bar"><span style={{ width: `${nextGoalProgress}%` }} /></div>
          <strong>{money.format(Math.max(0, total - 25000))} to go</strong>
        </article>
      </section>
    );
  }

  if (active === "Reports") {
    const totalMinimum = debts.reduce((sum, debt) => sum + debt.minimum, 0);
    return (
      <section className="workspace-view">
        <div className="view-toolbar">
          <div><p className="eyebrow">PROGRESS REPORT</p><h2>Your work is changing the curve.</h2><p>Estimates use your balances, APRs, minimums, and current monthly snowball.</p></div>
          <button className="view-secondary">Last 12 months⌄</button>
        </div>
        <div className="report-kpis">
          <article><span>Debt paid down</span><strong>{money.format(paid)}</strong><small>Since your starting balances</small></article>
          <article><span>Interest avoided</span><strong>{money.format(interestSaved)}</strong><small>With +$150/mo scenario</small></article>
          <article><span>Time reclaimed</span><strong>{monthsSaved} months</strong><small>With +$150/mo scenario</small></article>
          <article><span>Monthly commitment</span><strong>{money.format(totalMinimum + extra)}</strong><small>{money.format(extra)} above minimums</small></article>
        </div>
        <div className="reports-grid">
          <article className="report-chart panel">
            <div className="panel-heading"><div><span className="card-label">PAYOFF FORECAST</span><strong>Balance trajectory</strong></div><div className="legend"><span className="legend-base">Current</span><span className="legend-fast">Faster</span></div></div>
            <TrajectoryChart base={projection} faster={fasterProjection} />
          </article>
          <article className="distribution panel">
            <span className="card-label">BALANCE DISTRIBUTION</span>
            <h3>Where your debt lives</h3>
            {debts.map((debt) => (
              <div key={debt.id}>
                <p><span><i style={{ background: debt.accent }} />{debt.name}</span><strong>{total > 0 ? Math.round((debt.balance / total) * 100) : 0}%</strong></p>
                <div><span style={{ width: `${total > 0 ? (debt.balance / total) * 100 : 0}%`, background: debt.accent }} /></div>
              </div>
            ))}
          </article>
        </div>
        <p className="estimate-note">These projections are motivational planning estimates, not lender statements. Actual interest and payoff timing can vary by issuer and payment date.</p>
      </section>
    );
  }

  if (active === "Reminders") {
    return (
      <section className="workspace-view">
        <div className="view-toolbar">
          <div><p className="eyebrow">PAYMENT SAFETY NET</p><h2>Never let a due date surprise you.</h2><p>Choose which reminders matter. They stay attached to this device.</p></div>
          <span className="reminder-status"><i /> {Object.values(reminders).filter(Boolean).length} reminders active</span>
        </div>
        <div className="reminders-layout">
          <div className="reminder-list">
            {debts.map((debt) => (
              <article key={debt.id}>
                <span className="account-mark" style={{ background: debt.accent }}>{debt.mark}</span>
                <div><strong>{debt.name}</strong><span>Due Aug {debt.dueDay} · {money.format(debt.minimum)} minimum</span></div>
                <div className="reminder-chips"><span>7 days before</span><span>2 days before</span></div>
                <button className={`toggle ${reminders[debt.id] ? "on" : ""}`} onClick={() => setReminders({ ...reminders, [debt.id]: !reminders[debt.id] })} aria-pressed={reminders[debt.id]} aria-label={`${reminders[debt.id] ? "Disable" : "Enable"} ${debt.name} reminder`}><span /></button>
              </article>
            ))}
          </div>
          <aside className="reminder-tip">
            <span>♧</span>
            <h3>One calm check-in</h3>
            <p>We recommend a monthly balance update two days after your last statement closes. That keeps reports useful without becoming another daily chore.</p>
            <button onClick={onUpdate}>Schedule monthly check-in</button>
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-view">
        <div className="view-toolbar">
          <div><p className="eyebrow">SETTINGS & PRIVACY</p><h2>Simple, private, and under your control.</h2><p>{sharedMode ? "Shared only with signed-in users on this private-network server." : "No bank login. No card number. No financial data leaves this browser."}</p></div>
        </div>
        <div className="settings-grid">
        <article><span className="setting-icon blue-bg">⌂</span><div><strong>{sharedMode ? "Private-network data" : "Local-only data"}</strong><p>{sharedMode ? "Authorized users share one plan stored by the local executable." : "Your balances and plan are stored in this browser’s local storage."}</p></div><span className="setting-value">On</span></article>
        <article><span className="setting-icon mint-bg">◎</span><div><strong>Strategy</strong><p>Smallest balance first for frequent motivational wins.</p></div><button>Snowball⌄</button></article>
        <article><span className="setting-icon coral-bg">$</span><div><strong>Monthly snowball</strong><p>The extra amount paid above all required minimums.</p></div><strong className="setting-value">{money.format(extra)}</strong></article>
        <article><span className="setting-icon yellow-bg">♧</span><div><strong>Reminder timing</strong><p>Two gentle alerts before each payment is due.</p></div><button>Manage</button></article>
      </div>
      <article className="privacy-panel">
        <div><span>🔒</span><div><strong>Why we’re starting without bank syncing</strong><p>Manual updates reduce complexity and avoid storing banking credentials. A guided 30-second monthly check-in gives this app enough information to keep your plan useful and motivating.</p></div></div>
        <button onClick={onUpdate}>Update my numbers</button>
      </article>
    </section>
  );
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

const EMPTY_DEBT_DRAFT: DebtDraft = {
  name: "",
  balance: "",
  original: "",
  apr: "",
  minimum: "",
  dueDay: "1",
  accent: "#315BE8",
  mark: "◆",
};

export default function Home({
  sharedState,
  onSharedStateChange,
  headerControls,
  userDisplayName = "Maya",
}: HomeProps = {}) {
  const [debts, setDebts] = useState<Debt[]>(sharedState?.debts ?? DEFAULT_DEBTS);
  const [extra, setExtra] = useState(sharedState?.extra ?? 0);
  const [simExtra, setSimExtra] = useState(150);
  const [active, setActive] = useState("Overview");
  const [modal, setModal] = useState<"update" | "simulator" | "debt" | null>(null);
  const [draftBalances, setDraftBalances] = useState<Record<number, string>>({});
  const [editingDebtId, setEditingDebtId] = useState<number | null>(null);
  const [debtDraft, setDebtDraft] = useState<DebtDraft>(EMPTY_DEBT_DRAFT);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (sharedState) {
      const sharedTimer = window.setTimeout(() => {
        setDebts(sharedState.debts);
        setExtra(sharedState.extra);
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
        }
      } catch {
        // A clean default state is safer than blocking the dashboard.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sharedState]);

  const total = debts.reduce((sum, debt) => sum + debt.balance, 0);
  const original = debts.reduce((sum, debt) => sum + debt.original, 0);
  const paid = original - total;
  const progress = original > 0
    ? Math.max(0, Math.min(100, Math.round((paid / original) * 100)))
    : 0;
  const minimums = debts.reduce((sum, debt) => sum + debt.minimum, 0);
  const baseProjection = useMemo(() => simulate(debts, extra), [debts, extra]);
  const fasterProjection = useMemo(() => simulate(debts, extra + simExtra), [debts, extra, simExtra]);
  const monthsSaved = Math.max(0, baseProjection.months - fasterProjection.months);
  const interestSaved = Math.max(0, baseProjection.interest - fasterProjection.interest);
  const focusDebt = [...debts].filter((debt) => debt.balance > 0).sort((a, b) => a.balance - b.balance)[0];

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
    } : EMPTY_DEBT_DRAFT);
    setModal("debt");
  }

  function saveDebt() {
    const name = debtDraft.name.trim();
    const balance = Math.max(0, Number(debtDraft.balance) || 0);
    const original = Math.max(0.01, Number(debtDraft.original) || balance || 0.01);
    const apr = Math.max(0, Number(debtDraft.apr) || 0);
    const minimum = Math.max(0, Number(debtDraft.minimum) || 0);
    const dueDay = Math.max(1, Math.min(31, Math.trunc(Number(debtDraft.dueDay) || 1)));
    if (!name) return;

    const nextDebt: Debt = {
      id: editingDebtId ?? Math.max(0, ...debts.map((debt) => debt.id)) + 1,
      name,
      balance,
      original,
      apr,
      minimum,
      dueDay,
      accent: debtDraft.accent,
      mark: debtDraft.mark || "◆",
    };
    const updated = editingDebtId === null
      ? [...debts, nextDebt]
      : debts.map((debt) => debt.id === editingDebtId ? nextDebt : debt);
    setDebts(updated);
    persistState(updated, extra);
    setModal(null);
    setToast(editingDebtId === null ? "Account added to your plan." : `${name} updated.`);
    window.setTimeout(() => setToast(""), 3200);
  }

  function deleteDebt() {
    if (editingDebtId === null) return;
    const debt = debts.find((item) => item.id === editingDebtId);
    if (!debt || !window.confirm(`Remove ${debt.name} from the plan?`)) return;
    const updated = debts.filter((item) => item.id !== editingDebtId);
    setDebts(updated);
    persistState(updated, extra);
    setModal(null);
    setToast(`${debt.name} removed.`);
    window.setTimeout(() => setToast(""), 3200);
  }

  function saveBalances() {
    const updated = debts.map((debt) => ({
      ...debt,
      balance: Math.max(0, Number(draftBalances[debt.id]) || 0),
    }));
    setDebts(updated);
    persistState(updated, extra);
    setModal(null);
    setToast("Balances updated — your new forecast is ready.");
    window.setTimeout(() => setToast(""), 3200);
  }

  function saveExtra(value: number) {
    setExtra(value);
    persistState(debts, value);
  }

  function persistState(nextDebts: Debt[], nextExtra: number) {
    const nextState = { debts: nextDebts, extra: nextExtra };
    if (onSharedStateChange) {
      onSharedStateChange(nextState);
      return;
    }
    localStorage.setItem("debt-snowball-state", JSON.stringify(nextState));
  }

  const nav = [
    ["Overview", "⌂"],
    ["My Debts", "▣"],
    ["Snowball Plan", "↗"],
    ["Goals", "◎"],
    ["Reports", "▥"],
    ["Reminders", "♧"],
    ["Settings", "⚙"],
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setActive("Overview")} aria-label="Debt Snowball home">
          <span className="brand-orbit"><i /></span>
          <span>Debt<br />Snowball</span>
        </button>
        <nav aria-label="Main navigation">
          {nav.map(([label, glyph]) => (
            <button key={label} className={active === label ? "active" : ""} onClick={() => setActive(label)}>
              <Icon>{glyph}</Icon><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="streak-card">
          <span className="streak-flame">♨</span>
          <div><strong>8 week streak</strong><small>On-time and on track</small></div>
        </div>
        <p className="privacy-note"><span>✓</span> Stored privately on this device</p>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">MONDAY, JULY 28</p>
            <h1>{active === "Overview" ? `Good morning, ${userDisplayName}!` : active}</h1>
            <p className="subtitle">{active === "Overview" ? "Every payment brings freedom closer." : "Your plan, clearly organized and easy to update."}</p>
          </div>
          <div className="header-actions">
            {headerControls}
            <button className="update-button" onClick={openUpdate}><span>↻</span> Update balances</button>
            <button className="notification-button" aria-label="Notifications"><span>♧</span><b>3</b></button>
            <button className="avatar" aria-label="Profile menu">M</button>
          </div>
        </header>

        {active === "Overview" ? (
          <>
            <section className="hero-grid">
              <article className="panel total-card">
                <p className="card-label">TOTAL DEBT</p>
                <div className="total-content">
                  <div>
                    <strong className="total-number">{money.format(total)}</strong>
                    <span className="down-pill">↓ {money.format(1840)} this year</span>
                  </div>
                  <div className="progress-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}>
                    <div><strong>{progress}%</strong><span>paid off</span></div>
                  </div>
                </div>
                <div className="next-payment">
                  <div><span>Next payment</span><strong>{focusDebt?.name ?? "Add your first account"}</strong></div>
                  <div><span>{focusDebt ? dueLabel(focusDebt.dueDay) : "No plan yet"}</span><strong>{focusDebt ? money.format(focusDebt.minimum + extra) : money.format(0)}</strong></div>
                </div>
              </article>

              <article className="panel trajectory-card">
                <div className="panel-heading">
                  <div><span className="card-label">YOUR DEBT TRAJECTORY</span><strong>See the finish line</strong></div>
                  <div className="legend"><span className="legend-base">Current plan</span><span className="legend-fast">+{money.format(simExtra)}/mo</span></div>
                </div>
                <TrajectoryChart base={baseProjection} faster={fasterProjection} />
              </article>

              <article className="simulator-card">
                <span className="sparkle one">✦</span><span className="sparkle two">✦</span>
                <p>What if you paid</p>
                <h2>{money.format(simExtra)} more?</h2>
                <div className="sim-result"><span>Debt-free</span><strong>{monthsSaved} months sooner</strong></div>
                <div className="sim-result"><span>Interest saved</span><strong>{money.format(interestSaved)}</strong></div>
                <button onClick={() => setModal("simulator")}>Try simulator <span>→</span></button>
              </article>
            </section>

            <section className="debt-section">
              <div className="section-heading">
                <div><p className="eyebrow">YOUR ACCOUNTS</p><h2>Every balance has a finish line.</h2></div>
                <button onClick={() => setActive("My Debts")}>See all details →</button>
              </div>
              <div className="debts-grid">
                {debts.map((debt) => <DebtCard key={debt.id} debt={debt} focused={debt.id === focusDebt?.id} onEdit={openDebtEditor} />)}
                {debts.length === 0 ? (
                  <button className="empty-debts-card" onClick={() => openDebtEditor()}>
                    <span>+</span>
                    <strong>Add your first debt</strong>
                    <small>Enter a balance, APR, minimum, and due date.</small>
                  </button>
                ) : (
                  <article className="milestone-card">
                    <div className="medal"><span>★</span></div>
                    <div><p>Milestone unlocked</p><strong>{money.format(Math.max(0, Math.floor(paid / 5000) * 5000))} crushed</strong><span>You’ve already done the hard part: starting.</span></div>
                  </article>
                )}
              </div>
            </section>

            <section className="bottom-strip">
              <div><span>Total monthly plan</span><strong>{money.format(minimums + extra)}</strong></div>
              <div><span>Extra snowball</span><strong className="green">{money.format(extra)}</strong></div>
              <div><span>Est. interest saved</span><strong className="green">{money.format(interestSaved)}</strong></div>
              <div><span>Est. debt-free</span><strong className="blue">{payoffDate(baseProjection.months)}</strong></div>
              <button onClick={() => setActive("Goals")}><span>☆</span><div><strong>You’re on track!</strong><small>Keep that momentum going.</small></div><b>→</b></button>
            </section>
          </>
        ) : (
          <SecondaryView
            active={active}
            debts={debts}
            extra={extra}
            total={total}
            original={original}
            paid={paid}
            progress={progress}
            projection={baseProjection}
            fasterProjection={fasterProjection}
            onUpdate={openUpdate}
            onSimulate={() => setModal("simulator")}
            onAddDebt={() => openDebtEditor()}
            onEditDebt={openDebtEditor}
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
                <p className="modal-intro">About 30 seconds. Enter the latest statement balance for each card and we’ll refresh every forecast.</p>
                <div className="balance-inputs">
                  {debts.map((debt) => (
                    <label key={debt.id}>
                      <span><i style={{ background: debt.accent }}>{debt.mark}</i>{debt.name}</span>
                      <span className="currency-input"><b>$</b><input inputMode="decimal" value={draftBalances[debt.id] ?? ""} onChange={(event) => setDraftBalances({ ...draftBalances, [debt.id]: event.target.value })} aria-label={`${debt.name} balance`} /></span>
                    </label>
                  ))}
                </div>
                <button className="modal-primary" onClick={saveBalances}>Save & refresh my plan</button>
                <p className="local-note">🔒 {onSharedStateChange ? "Saved to your private-network server." : "Your numbers stay in this browser."} No bank connection needed.</p>
              </>
            ) : modal === "debt" ? (
              <>
                <p className="eyebrow">{editingDebtId === null ? "NEW ACCOUNT" : "ACCOUNT DETAILS"}</p>
                <h2 id="modal-title">{editingDebtId === null ? "Add a debt" : "Edit this debt"}</h2>
                <p className="modal-intro">These values drive the payoff forecast. Card numbers and bank credentials are never requested.</p>
                <div className="debt-editor-grid">
                  <label className="wide-field">Account name<input autoFocus value={debtDraft.name} maxLength={80} onChange={(event) => setDebtDraft({ ...debtDraft, name: event.target.value })} placeholder="Card or lender name" /></label>
                  <label>Current balance<input type="number" inputMode="decimal" min="0" step="0.01" value={debtDraft.balance} onChange={(event) => setDebtDraft({ ...debtDraft, balance: event.target.value })} /></label>
                  <label>Starting balance<input type="number" inputMode="decimal" min="0.01" step="0.01" value={debtDraft.original} onChange={(event) => setDebtDraft({ ...debtDraft, original: event.target.value })} /></label>
                  <label>APR %<input type="number" inputMode="decimal" min="0" max="1000" step="0.01" value={debtDraft.apr} onChange={(event) => setDebtDraft({ ...debtDraft, apr: event.target.value })} /></label>
                  <label>Minimum payment<input type="number" inputMode="decimal" min="0" step="0.01" value={debtDraft.minimum} onChange={(event) => setDebtDraft({ ...debtDraft, minimum: event.target.value })} /></label>
                  <label>Due day<input type="number" inputMode="numeric" min="1" max="31" step="1" value={debtDraft.dueDay} onChange={(event) => setDebtDraft({ ...debtDraft, dueDay: event.target.value })} /></label>
                  <label>Card color<input type="color" value={debtDraft.accent} onChange={(event) => setDebtDraft({ ...debtDraft, accent: event.target.value })} /></label>
                </div>
                <button className="modal-primary" onClick={saveDebt} disabled={!debtDraft.name.trim()}>Save account</button>
                {editingDebtId !== null && <button className="modal-danger" onClick={deleteDebt}>Remove this account</button>}
              </>
            ) : (
              <>
                <p className="eyebrow">PAYOFF SIMULATOR</p>
                <h2 id="modal-title">Turn “what if” into a date.</h2>
                <p className="modal-intro">Move the slider to see how a little more each month can change your finish line.</p>
                <div className="slider-value">{money.format(simExtra)}<span> extra / month</span></div>
                <input className="range" type="range" min="0" max="1000" step="25" value={simExtra} onChange={(event) => setSimExtra(Number(event.target.value))} aria-label="Extra monthly payment" />
                <div className="sim-grid">
                  <div><span>Debt-free</span><strong>{payoffDate(fasterProjection.months)}</strong><small>{monthsSaved} months sooner</small></div>
                  <div><span>Interest saved</span><strong>{money.format(interestSaved)}</strong><small>Approximate projection</small></div>
                </div>
                <button className="modal-primary" onClick={() => { saveExtra(extra + simExtra); setModal(null); setToast(`${money.format(simExtra)} added to your monthly snowball.`); window.setTimeout(() => setToast(""), 3200); }}>Add this to my plan</button>
                <p className="local-note">Projections are estimates and may differ from card issuer calculations.</p>
              </>
            )}
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
