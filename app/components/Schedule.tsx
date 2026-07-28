"use client";

import { useMemo, useState } from "react";
import { type Debt, type Plan, formatMonth, planCsv } from "../lib/plan";

const cents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function downloadCsv(plan: Plan, debts: Debt[]) {
  const blob = new Blob([planCsv(plan, debts)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "payoff-schedule.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export default function Schedule({ plan, debts }: { plan: Plan; debts: Debt[] }) {
  const [expanded, setExpanded] = useState<number | null>(plan.months[0]?.index ?? null);
  const [openYears, setOpenYears] = useState<Record<number, boolean>>({ 0: true });

  const byId = useMemo(() => new Map(debts.map((debt) => [debt.id, debt])), [debts]);

  const years = useMemo(() => {
    const groups: { year: number; label: string; months: typeof plan.months }[] = [];
    plan.months.forEach((month) => {
      const year = month.date.getFullYear();
      const last = groups[groups.length - 1];
      if (last && last.year === year) last.months.push(month);
      else groups.push({ year, label: String(year), months: [month] });
    });
    return groups;
  }, [plan]);

  if (plan.monthCount === 0) {
    return (
      <div className="schedule-empty">
        <strong>No schedule yet</strong>
        <p>Add at least one account with a balance and a minimum payment, and the full month-by-month amortization appears here.</p>
      </div>
    );
  }

  return (
    <div className="schedule">
      <div className="schedule-actions">
        <p className="schedule-hint">
          Every row is one calendar month. <b>Interest</b> is what the balance costs you that month;
          <b> principal</b> is the part of the payment that actually shrinks the debt. Click a row to see each account.
        </p>
        <button className="btn-quiet" onClick={() => downloadCsv(plan, debts)}>Download CSV</button>
      </div>

      <div className="schedule-table" role="table">
        <div className="schedule-head" role="row">
          <span role="columnheader">Month</span>
          <span role="columnheader">Payment</span>
          <span role="columnheader">Interest</span>
          <span role="columnheader">Principal</span>
          <span role="columnheader">Balance left</span>
        </div>

        {years.map((group, groupIndex) => {
          const open = openYears[groupIndex] ?? groupIndex === 0;
          const interest = group.months.reduce((sum, month) => sum + month.interest, 0);
          const paid = group.months.reduce((sum, month) => sum + month.payment, 0);
          const cleared = group.months.flatMap((month) => month.cleared);
          return (
            <section key={group.year} className={`schedule-year ${open ? "open" : ""}`}>
              <button
                className="schedule-year-head"
                onClick={() => setOpenYears((current) => ({ ...current, [groupIndex]: !open }))}
                aria-expanded={open}
              >
                <span className="chevron" aria-hidden="true">›</span>
                <strong>{group.label}</strong>
                <span className="schedule-year-meta">
                  {group.months.length} {group.months.length === 1 ? "month" : "months"}
                  {cleared.length > 0 && (
                    <em>
                      {" · "}
                      {cleared.map((id) => byId.get(id)?.name ?? "an account").join(", ")} paid off
                    </em>
                  )}
                </span>
                <span className="schedule-year-figures">
                  <b>{cents.format(paid)}</b> paid <i>·</i> <b>{cents.format(interest)}</b> interest
                </span>
              </button>

              {open && group.months.map((month) => {
                const isOpen = expanded === month.index;
                return (
                  <div key={month.index} className={`schedule-row-group ${month.cleared.length ? "milestone" : ""}`}>
                    <button
                      className={`schedule-row ${isOpen ? "open" : ""}`}
                      onClick={() => setExpanded(isOpen ? null : month.index)}
                      aria-expanded={isOpen}
                      role="row"
                    >
                      <span className="schedule-month">
                        <b>{formatMonth(month.date)}</b>
                        <small>Month {month.index}</small>
                      </span>
                      <span>{cents.format(month.payment)}</span>
                      <span className="schedule-interest">{cents.format(month.interest)}</span>
                      <span className="schedule-principal">{cents.format(month.principal)}</span>
                      <span className="schedule-balance">{cents.format(month.end)}</span>
                    </button>

                    {month.cleared.length > 0 && (
                      <p className="schedule-milestone">
                        ★ {month.cleared.map((id) => byId.get(id)?.name ?? "An account").join(" and ")}{" "}
                        {month.cleared.length > 1 ? "are" : "is"} paid off — that payment rolls into the next account.
                      </p>
                    )}

                    {isOpen && (
                      <div className="schedule-detail">
                        {month.debts.filter((row) => row.start > 0).map((row) => {
                          const debt = byId.get(row.id);
                          return (
                            <div key={row.id} style={{ "--accent": debt?.accent ?? "var(--primary)" } as React.CSSProperties}>
                              <span className="detail-name">
                                <i />
                                {debt?.name ?? `Account ${row.id}`}
                                {row.focus && <b className="focus-tag">Target</b>}
                              </span>
                              <span><small>Payment</small>{cents.format(row.payment)}</span>
                              <span><small>Interest</small>{cents.format(row.interest)}</span>
                              <span><small>Principal</small>{cents.format(row.principal)}</span>
                              <span><small>Balance left</small><b>{cents.format(row.end)}</b></span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
