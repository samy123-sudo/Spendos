import type { SeriesPoint } from "../utils";
import { CHART_COLORS, money } from "../utils";

export function CashFlowChart({ points, currency }: { points: SeriesPoint[]; currency: string }) {
  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 14, bottom: 30, left: 52 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const max = Math.max(1, ...points.flatMap((p) => [p.income, p.expense]));
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const x = (index: number) => pad.left + (points.length > 1 ? index * stepX : innerW / 2);
  const y = (value: number) => pad.top + innerH - (value / max) * innerH;

  const linePath = (field: "income" | "expense") =>
    points
      .map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point[field]).toFixed(1)}`)
      .join(" ");

  const areaPath = `${linePath("income")} L${x(points.length - 1).toFixed(1)},${pad.top + innerH} L${x(0).toFixed(1)},${
    pad.top + innerH
  } Z`;

  const ticks = [0, 0.5, 1];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Monthly cash flow: income and spending">
        <defs>
          <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-income)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--chart-income)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(max * tick)}
              y2={y(max * tick)}
              stroke="var(--chart-grid)"
              strokeDasharray={tick === 0 ? "" : "3 4"}
            />
            <text x={pad.left - 8} y={y(max * tick) + 4} textAnchor="end" fontSize="10" fill="var(--chart-axis)">
              {money(max * tick, currency, true)}
            </text>
          </g>
        ))}
        <path d={areaPath} fill="url(#incomeFill)" />
        <path d={linePath("income")} fill="none" stroke="var(--chart-income)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d={linePath("expense")} fill="none" stroke="var(--chart-expense)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="0" />
        {points.map((point, index) => (
          <g key={point.key}>
            <circle cx={x(index)} cy={y(point.income)} r="3" fill="var(--chart-income)" />
            <circle cx={x(index)} cy={y(point.expense)} r="3" fill="var(--chart-expense)" />
            <text x={x(index)} y={height - 10} textAnchor="middle" fontSize="10" fill="var(--chart-axis)">
              {point.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function Donut({
  data,
  currency,
}: {
  data: { name: string; value: number }[];
  currency: string;
}) {
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="donut-layout">
      <svg viewBox="0 0 150 150" width="150" height="150" role="img" aria-label="Spending by category">
        <circle cx="75" cy="75" r={radius} fill="none" stroke="var(--chart-track)" strokeWidth="18" />
        {data.map((slice, index) => {
          const fraction = total > 0 ? slice.value / total : 0;
          const dash = fraction * circumference;
          const circle = (
            <circle
              key={slice.name}
              cx="75"
              cy="75"
              r={radius}
              fill="none"
              stroke={CHART_COLORS[index % CHART_COLORS.length]}
              strokeWidth="18"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 75 75)"
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return circle;
        })}
        <text x="75" y="71" textAnchor="middle" fontSize="10" fill="var(--chart-axis)">
          Spending
        </text>
        <text x="75" y="87" textAnchor="middle" fontSize="12.5" fontWeight="700" fill="var(--ink)">
          {money(total, currency, true)}
        </text>
      </svg>
      <div className="donut-legend" role="list" aria-label="Category legend">
        {data.map((slice, index) => (
          <div className="donut-legend-row" role="listitem" key={slice.name}>
            <span className="swatch" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
            <span className="name" title={slice.name}>
              {slice.name}
            </span>
            <span className="val">
              {money(slice.value, currency, true)} · {total > 0 ? ((slice.value / total) * 100).toFixed(0) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MiniBars({ values, color = "var(--chart-income)" }: { values: number[]; color?: string }) {
  const max = Math.max(1, ...values);
  return (
    <svg viewBox="0 0 80 24" width="80" height="24" aria-hidden="true">
      {values.map((value, index) => {
        const barHeight = Math.max(2, (value / max) * 20);
        return (
          <rect
            key={index}
            x={index * 10 + 2}
            y={22 - barHeight}
            width="6"
            height={barHeight}
            rx="2"
            fill={color}
            opacity={0.35 + (index / Math.max(1, values.length - 1)) * 0.65}
          />
        );
      })}
    </svg>
  );
}
