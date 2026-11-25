import type { CSSProperties, ReactNode } from "react";
import { classNames, money, percent } from "../utils";

export function Card({
  children,
  className,
  pad = true,
  style,
}: {
  children: ReactNode;
  className?: string;
  pad?: boolean;
  style?: CSSProperties;
}) {
  return (
    <section className={classNames("card", pad && "card-pad", className)} style={style}>
      {children}
    </section>
  );
}

export function CardHead({
  title,
  note,
  action,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card-head">
      <div>
        <h2 className="card-title">{title}</h2>
        {note ? <p className="card-note">{note}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <span className="card-note" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>{hint}</span> : null}
    </label>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
      {action ? <div style={{ marginTop: 10 }}>{action}</div> : null}
    </div>
  );
}

export function Trend({
  current,
  previous,
  currency,
  label,
  polarity = "up",
}: {
  current: number;
  previous: number | null;
  currency: string;
  label: string;
  polarity?: "up" | "down";
}) {
  if (previous === null || previous === 0) {
    return <span className="muted small">No trend yet</span>;
  }
  const change = ((current - previous) / Math.abs(previous)) * 100;
  const rising = change > 0.5;
  const falling = change < -0.5;
  const good = polarity === "down" ? falling : rising;
  const direction = rising || falling ? (good ? "up" : "down") : "flat";
  return (
    <>
      <span className={classNames("trend", direction)}>
        {change > 0 ? "▲" : change < 0 ? "▼" : "•"} {percent(Math.abs(change), 0)}
      </span>
      <span className="muted small">
        vs {label} · {money(previous, currency)}
      </span>
    </>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = { stored: "ok", queued: "warn", review: "warn" };
  return <span className={`pill ${map[status] || ""}`}>{status}</span>;
}
