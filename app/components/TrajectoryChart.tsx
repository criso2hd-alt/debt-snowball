"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type Debt, type Plan, formatMonth } from "../lib/plan";

const PAD = { top: 18, right: 20, bottom: 54, left: 74 };
const TIP_W = 186;

const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const exact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export type Series = {
  key: string;
  label: string;
  /** Balance remaining at month 0, 1, 2 … */
  points: number[];
  variant: "minimums" | "plan" | "faster";
  /** Short caption under the legend entry, e.g. the debt-free date. */
  note?: string;
};

/** A "nice" round step so gridline labels are readable numbers. */
function niceStep(max: number, targetLines: number) {
  const raw = max / targetLines;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  for (const multiple of [1, 2, 2.5, 5, 10]) {
    const step = magnitude * multiple;
    if (step >= raw) return step;
  }
  return magnitude * 10;
}

export default function TrajectoryChart({
  series,
  plan,
  debts,
  height = 320,
}: {
  series: Series[];
  /** Used to mark the month each individual debt disappears. */
  plan?: Plan;
  debts?: Debt[];
  height?: number;
}) {
  const wrapRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  // The viewBox is sized to the real element width so 1 unit == 1 CSS pixel.
  // Without this the SVG letterboxes inside its panel and every label scales.
  const [width, setWidth] = useState(760);
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;

    // Measure once immediately: ResizeObserver notifications are tied to the
    // rendering lifecycle and never arrive while the tab is hidden.
    const measure = (value: number) => setWidth(Math.max(320, Math.round(value)));
    measure(node.getBoundingClientRect().width);

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const maxMonth = Math.max(1, ...series.map((item) => item.points.length - 1));
  const maxValue = Math.max(1, ...series.flatMap((item) => item.points));

  const step = niceStep(maxValue, 4);
  const top = Math.ceil(maxValue / step) * step;

  const x = (month: number) => PAD.left + (month / maxMonth) * plotW;
  const y = (value: number) => PAD.top + (1 - value / top) * plotH;

  const path = (points: number[]) =>
    points.map((value, month) => `${month === 0 ? "M" : "L"} ${x(month).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let value = 0; value <= top + 0.5; value += step) ticks.push(value);
    return ticks;
  }, [top, step]);

  // One tick per year, thinned out so long plans and narrow panels do not
  // crowd the axis.
  const xTicks = useMemo(() => {
    const yearsShown = Math.floor(maxMonth / 12);
    const fit = Math.max(2, Math.floor(plotW / 78));
    const every = yearsShown > fit ? Math.ceil(yearsShown / fit) : 1;
    const ticks = [0];
    for (let year = every; year * 12 <= maxMonth; year += every) ticks.push(year * 12);
    return ticks;
  }, [maxMonth, plotW]);

  const planSeries = series.find((item) => item.variant === "plan");

  const markers = useMemo(() => {
    if (!plan || !debts || !planSeries) return [];
    const byId = new Map(debts.map((debt) => [debt.id, debt]));
    return plan.order
      .filter((id) => plan.payoffMonth[id] && byId.has(id))
      .map((id, index) => ({
        rank: index + 1,
        name: byId.get(id)!.name,
        accent: byId.get(id)!.accent,
        month: plan.payoffMonth[id],
        date: plan.months[plan.payoffMonth[id] - 1].date,
        value: planSeries.points[plan.payoffMonth[id]] ?? 0,
      }))
      .sort((a, b) => a.month - b.month)
      .map((marker, index) => ({ ...marker, rank: index + 1 }));
  }, [plan, debts, planSeries]);

  function trackPointer(event: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const localX = ((event.clientX - box.left) / box.width) * width;
    const month = Math.round(((localX - PAD.left) / plotW) * maxMonth);
    setHover(Math.max(0, Math.min(maxMonth, month)));
  }

  const hoverMonthDate = useMemo(() => {
    if (hover === null) return "";
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() + hover);
    return formatMonth(date);
  }, [hover]);

  const tooltipRight = hover !== null && x(hover) + TIP_W + 24 > width;

  return (
    <figure className="chart" ref={wrapRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`Remaining balance over ${maxMonth} months. ${series
          .map((item) => `${item.label}: ${item.note ?? ""}`)
          .join(". ")}`}
        onPointerMove={trackPointer}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="planArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity=".18" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((value) => (
          <g key={value}>
            <line className="chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} />
            <text className="chart-tick" x={PAD.left - 12} y={y(value) + 4} textAnchor="end">
              {value === 0 ? "$0" : compact.format(value)}
            </text>
          </g>
        ))}

        {xTicks.map((month) => (
          <g key={month}>
            <line
              className="chart-grid chart-grid-x"
              x1={x(month)}
              x2={x(month)}
              y1={PAD.top}
              y2={PAD.top + plotH}
            />
            <text className="chart-tick" x={x(month)} y={PAD.top + plotH + 22} textAnchor="middle">
              {month === 0 ? "Today" : `Year ${month / 12}`}
            </text>
          </g>
        ))}

        <text className="chart-axis-title" x={PAD.left - 12} y={PAD.top - 6} textAnchor="end">
          Balance
        </text>

        {planSeries && (
          <path
            d={`${path(planSeries.points)} L ${x(planSeries.points.length - 1).toFixed(1)} ${y(0)} L ${x(0)} ${y(0)} Z`}
            fill="url(#planArea)"
          />
        )}

        {series.map((item) => (
          <path key={item.key} className={`chart-line chart-line-${item.variant}`} d={path(item.points)} />
        ))}

        {markers.map((marker) => (
          <g key={marker.rank}>
            <line
              className="chart-marker-stem"
              x1={x(marker.month)}
              x2={x(marker.month)}
              y1={y(marker.value)}
              y2={PAD.top + plotH}
            />
            <circle className="chart-marker" cx={x(marker.month)} cy={y(marker.value)} r="7" />
            <text className="chart-marker-label" x={x(marker.month)} y={y(marker.value) + 3.5} textAnchor="middle">
              {marker.rank}
            </text>
          </g>
        ))}

        {hover !== null && (
          <g className="chart-hover">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} />
            {series.map((item) => {
              const value = item.points[Math.min(hover, item.points.length - 1)] ?? 0;
              return <circle key={item.key} className={`chart-dot chart-dot-${item.variant}`} cx={x(hover)} cy={y(value)} r="4.5" />;
            })}
            <g transform={`translate(${tooltipRight ? x(hover) - TIP_W - 12 : x(hover) + 12}, ${PAD.top + 6})`}>
              <rect className="chart-tip" width={TIP_W} height={30 + series.length * 20} rx="10" />
              <text className="chart-tip-title" x="12" y="21">
                {hover === 0 ? "Today" : `${hoverMonthDate} · month ${hover}`}
              </text>
              {series.map((item, index) => {
                const done = hover > item.points.length - 1;
                const value = item.points[Math.min(hover, item.points.length - 1)] ?? 0;
                return (
                  <g key={item.key} transform={`translate(0, ${34 + index * 20})`}>
                    <rect className={`chart-swatch chart-swatch-${item.variant}`} x="12" y="0" width="10" height="10" rx="3" />
                    <text className="chart-tip-label" x="28" y="9">{item.label}</text>
                    <text className="chart-tip-value" x={TIP_W - 12} y="9" textAnchor="end">
                      {done && value <= 0 ? "Debt-free" : exact.format(value)}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
        )}
      </svg>

      <figcaption className="chart-legend">
        {series.map((item) => (
          <span key={item.key} className={`chart-key chart-key-${item.variant}`}>
            <i />
            <span>
              <strong>{item.label}</strong>
              {item.note && <small>{item.note}</small>}
            </span>
          </span>
        ))}
      </figcaption>

      {markers.length > 0 && (
        <ol className="chart-markers">
          {markers.map((marker) => (
            <li key={marker.rank}>
              <b style={{ background: marker.accent }}>{marker.rank}</b>
              <span>{marker.name} paid off</span>
              <em>{formatMonth(marker.date)}</em>
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}
