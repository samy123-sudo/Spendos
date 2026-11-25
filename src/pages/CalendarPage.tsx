import { useMemo, useState } from "react";
import type { PageProps } from "../pageProps";
import { Card, CardHead, EmptyState } from "../components/ui";
import type { Transaction } from "../types";
import { classNames, formatDate, iso, money, round, shortDate, today } from "../utils";

interface Cell {
  date: string;
  day: number;
  outside: boolean;
}

export default function CalendarPage({ state, goTo }: PageProps) {
  const settings = state.settings;
  const currency = settings.currency || "INR";

  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const monthName = new Date(cursor.year, cursor.month, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  const cells = useMemo<Cell[]>(() => {
    const firstWeekday = (new Date(cursor.year, cursor.month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const prevMonthDays = new Date(cursor.year, cursor.month, 0).getDate();
    const result: Cell[] = [];
    for (let i = firstWeekday - 1; i >= 0; i -= 1) {
      const day = prevMonthDays - i;
      const date = iso(new Date(cursor.year, cursor.month - 1, day));
      result.push({ date, day, outside: true });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      result.push({ date: iso(new Date(cursor.year, cursor.month, day)), day, outside: false });
    }
    let next = 1;
    while (result.length % 7 !== 0 || result.length < 35) {
      result.push({ date: iso(new Date(cursor.year, cursor.month + 1, next)), day: next, outside: true });
      next += 1;
    }
    return result;
  }, [cursor]);

  const byDate = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of state.transactions) {
      const list = map.get(tx.date) || [];
      list.push(tx);
      map.set(tx.date, list);
    }
    return map;
  }, [state.transactions]);

  const dueByDate = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; kind: string }[]>();
    const add = (date: string, name: string, amount: number, kind: string) => {
      if (!date) return;
      const list = map.get(date) || [];
      list.push({ name, amount, kind });
      map.set(date, list);
    };
    for (const sub of settings.subscriptions || []) {
      if (sub.active) add(sub.nextDate, sub.name, sub.amount, "subscription");
    }
    for (const item of settings.recurring || []) {
      if (item.confirmed && item.type === "expense") add(item.nextDate, item.name, item.amount, "recurring");
    }
    return map;
  }, [settings.subscriptions, settings.recurring]);

  const [selected, setSelected] = useState(() => today());

  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`;
  const monthTransactions = state.transactions.filter((tx) => tx.date.startsWith(monthPrefix));
  const monthSpend = round(monthTransactions.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + tx.amount, 0));
  const monthIncome = round(monthTransactions.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + tx.amount, 0));

  const selectedTransactions = byDate.get(selected) || [];
  const selectedDue = dueByDate.get(selected) || [];

  const move = (offset: number) => {
    const next = new Date(cursor.year, cursor.month + offset, 1);
    setCursor({ year: next.getFullYear(), month: next.getMonth() });
  };

  const goToday = () => {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
    setSelected(today());
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Calendar</p>
          <h1 className="page-title">Spending calendar</h1>
          <p className="page-sub">
            {monthName} · {money(monthSpend, currency)} spent, {money(monthIncome, currency)} received
          </p>
        </div>
        <div className="row">
          <button className="btn secondary small" onClick={() => move(-1)} aria-label="Previous month">
            ←
          </button>
          <button className="btn secondary small" onClick={goToday}>
            Today
          </button>
          <button className="btn secondary small" onClick={() => move(1)} aria-label="Next month">
            →
          </button>
        </div>
      </div>

      <div className="grid-2">
        <Card>
          <CardHead
            title={monthName}
            note="Tap a day to see its entries and what is due"
            action={
              <div className="chart-legend">
                <span>
                  <span className="swatch" style={{ background: "var(--chart-expense)" }} /> expense
                </span>
                <span>
                  <span className="swatch" style={{ background: "var(--chart-income)" }} /> income
                </span>
                <span>
                  <span className="swatch" style={{ background: "var(--ink)" }} /> due
                </span>
              </div>
            }
          />
          <div className="cal-head">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="cal-grid">
            {cells.map((cell) => {
              const entries = byDate.get(cell.date) || [];
              const due = dueByDate.get(cell.date) || [];
              const spend = round(entries.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + tx.amount, 0));
              return (
                <button
                  key={cell.date}
                  className={classNames(
                    "cal-day",
                    cell.outside && "outside",
                    cell.date === today() && "today",
                    cell.date === selected && "selected",
                  )}
                  onClick={() => setSelected(cell.date)}
                  aria-label={`${formatDate(cell.date)}${spend ? `, spent ${money(spend, currency)}` : ""}`}
                >
                  <span className="cal-num">{cell.day}</span>
                  {spend > 0 ? <span className="cal-spend">{money(spend, currency, true)}</span> : null}
                  <span className="cal-dots">
                    {entries.some((tx) => tx.type === "income") ? <span className="cal-dot income" /> : null}
                    {entries.some((tx) => tx.type === "expense") ? <span className="cal-dot" /> : null}
                    {due.length ? <span className="cal-dot due" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHead
            title={formatDate(selected)}
            note={`${selectedTransactions.length} entr${selectedTransactions.length === 1 ? "y" : "ies"}${
              selectedDue.length ? ` · ${selectedDue.length} due` : ""
            }`}
          />
          {selectedTransactions.length || selectedDue.length ? (
            <div>
              {selectedTransactions.map((tx) => (
                <div className="tx-row" key={tx.id} style={{ padding: "10px 0" }}>
                  <div className={classNames("tx-icon", tx.type === "expense" && "expense")}>
                    {tx.merchant.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="tx-main">
                    <div className="tx-merchant">{tx.merchant}</div>
                    <div className="tx-meta">
                      <span>{tx.category}</span>
                      {tx.account ? <span>· {tx.account}</span> : null}
                      {tx.needsReview ? <span className="pill warn">review</span> : null}
                    </div>
                  </div>
                  <div className={classNames("tx-amount", tx.type)}>
                    {tx.type === "income" ? "+" : "−"}
                    {money(tx.amount, currency)}
                  </div>
                </div>
              ))}
              {selectedDue.map((item) => (
                <div className="coming-row" key={`${item.kind}-${item.name}`}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                    <div className="card-note">Expected {item.kind}</div>
                  </div>
                  <div className="tx-amount">{money(item.amount, currency)}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Nothing on this day">
              No entries or scheduled payments for {shortDate(selected)}.
              <div style={{ marginTop: 10 }}>
                <button className="btn small" onClick={() => goTo("transactions")}>
                  Add an entry
                </button>
              </div>
            </EmptyState>
          )}
        </Card>
      </div>
    </>
  );
}
