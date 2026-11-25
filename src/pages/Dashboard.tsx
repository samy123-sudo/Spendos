import { useMemo, useState } from "react";
import type { PageProps } from "../pageProps";
import { CashFlowChart, Donut } from "../components/charts";
import { Card, CardHead, EmptyState, Trend } from "../components/ui";
import {
  PERIOD_OPTIONS,
  categoryTotals,
  classNames,
  filterTransactions,
  formatDate,
  money,
  monthlySeries,
  percent,
  periodRange,
  previousRange,
  round,
  savingsRate,
  shortDate,
  sumBy,
  today,
  type SeriesPoint,
} from "../utils";

function dailySeries(transactions: PageProps["state"]["transactions"], start: string, end: string): SeriesPoint[] {
  const buckets = new Map<string, SeriesPoint>();
  for (const tx of transactions) {
    if (tx.date < start || tx.date > end) continue;
    const point = buckets.get(tx.date) || { key: tx.date, label: shortDate(tx.date), income: 0, expense: 0 };
    if (tx.type === "income") point.income += tx.amount;
    else point.expense += tx.amount;
    buckets.set(tx.date, point);
  }
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export default function Dashboard({ state, saveSettings, goTo, notify }: PageProps) {
  const settings = state.settings;
  const currency = settings.currency || "INR";
  const period = settings.selectedPeriod || "this-month";
  const range = periodRange(period);
  const transactions = filterTransactions(state.transactions, range);
  const income = round(sumBy(transactions, "income"));
  const spending = round(sumBy(transactions, "expense"));
  const rate = savingsRate(income, spending);

  const prevRange = previousRange(range);
  const prevTransactions = prevRange.start ? filterTransactions(state.transactions, prevRange) : [];
  const prevIncome = prevTransactions.length ? round(sumBy(prevTransactions, "income")) : null;
  const prevSpending = prevTransactions.length ? round(sumBy(prevTransactions, "expense")) : null;

  const netWorth = round((settings.assets || 0) - (settings.liabilities || 0));
  const categories = categoryTotals(transactions);
  const recent = transactions.slice(0, 5);

  const [chartMode, setChartMode] = useState<"6" | "12" | "custom">("6");
  const [customStart, setCustomStart] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 60);
    return date.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState(today());

  const points = useMemo(() => {
    if (chartMode === "custom") {
      if (!customStart || !customEnd || customStart > customEnd) return [];
      const days = Math.round(
        (new Date(`${customEnd}T00:00:00`).getTime() - new Date(`${customStart}T00:00:00`).getTime()) / 86400000,
      );
      if (days <= 45) return dailySeries(state.transactions, customStart, customEnd);
      return monthlySeries(state.transactions, { start: customStart, end: customEnd }, 14);
    }
    return monthlySeries(state.transactions, { start: null, end: null }, chartMode === "12" ? 12 : 7);
  }, [chartMode, customStart, customEnd, state.transactions]);

  const needsReview = state.transactions.filter((tx) => tx.needsReview).length;
  const insights: string[] = [];
  if (!state.transactions.length) {
    insights.push("No transactions yet. Add or import entries to unlock factual insights about your household.");
  } else {
    if (needsReview > 0) {
      insights.push(`${needsReview} transaction${needsReview === 1 ? "" : "s"} flagged as Needs review. Confirm the category to keep reports accurate.`);
    }
    const top = categories[0];
    if (top && spending > 0) {
      insights.push(`${top.name} is your largest expense category in this period at ${money(top.value, currency)} (${percent((top.value / spending) * 100, 0)} of spending).`);
    }
    if (income > 0) {
      insights.push(
        rate >= 0
          ? `You kept ${money(income - spending, currency)} of ${money(income, currency)} income — a savings rate of ${percent(rate, 1)}.`
          : `Spending exceeded income by ${money(spending - income, currency)} in this period.`,
      );
    } else if (spending > 0) {
      insights.push(`No income recorded in this period, so the savings rate shows 0%.`);
    }
    const thisMonthRange = periodRange("this-month");
    const monthTx = filterTransactions(state.transactions, thisMonthRange);
    for (const budget of settings.budgets || []) {
      const spent = monthTx
        .filter((tx) => tx.type === "expense" && tx.category.toLowerCase() === budget.category.toLowerCase())
        .reduce((sum, tx) => sum + tx.amount, 0);
      if (budget.amount > 0 && spent > budget.amount) {
        insights.push(`${budget.category} is over its monthly budget by ${money(spent - budget.amount, currency)}.`);
      }
    }
    const unsorted = transactions.filter((tx) => (tx.category || "") === "Uncategorized").length;
    if (unsorted > 0) {
      insights.push(`${unsorted} transaction${unsorted === 1 ? "" : "s"} in this period still sit in Uncategorized.`);
    }
  }

  const dueSoon = useMemo(() => {
    const rows: { name: string; date: string; amount: number }[] = [];
    for (const sub of settings.subscriptions || []) {
      if (!sub.active || !sub.nextDate) continue;
      const days = Math.round((new Date(`${sub.nextDate}T00:00:00`).getTime() - new Date(`${today()}T00:00:00`).getTime()) / 86400000);
      if (days >= 0 && days <= 30) rows.push({ name: `${sub.name} · subscription`, date: sub.nextDate, amount: sub.amount });
    }
    for (const item of settings.recurring || []) {
      if (!item.confirmed || item.type !== "expense" || !item.nextDate) continue;
      const days = Math.round((new Date(`${item.nextDate}T00:00:00`).getTime() - new Date(`${today()}T00:00:00`).getTime()) / 86400000);
      if (days >= 0 && days <= 30) rows.push({ name: item.name, date: item.nextDate, amount: item.amount });
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  }, [settings.subscriptions, settings.recurring]);

  const changePeriod = async (value: string) => {
    try {
      await saveSettings({ selectedPeriod: value });
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not save the period.", true);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{settings.household?.name || "Our household"}</p>
          <h1 className="page-title">Overview</h1>
          <p className="page-sub">Plan first, then spend — every entry is checked against a real budget.</p>
        </div>
        <div className="segmented" role="group" aria-label="Selected period">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.key}
              className={classNames(period === option.key && "active")}
              onClick={() => void changePeriod(option.key)}
              aria-pressed={period === option.key}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="stat-grid">
        <article className={classNames("stat", !settings.netWorthConfigured && "attention")}>
          <span className="stat-label">Net worth</span>
          {settings.netWorthConfigured ? (
            <div className="stat-value">{money(netWorth, currency)}</div>
          ) : (
            <>
              <div className="stat-value muted">Not set</div>
              <p className="stat-hint">Chequing, savings, investments and loans you enter yourself — cash flow never changes this automatically.</p>
              <button className="link-btn" style={{ marginTop: 8, textAlign: "left" }} onClick={() => goTo("settings")}>
                Set assets and liabilities in Settings →
              </button>
            </>
          )}
          <div className="stat-strip">
            <span>
              {settings.netWorthConfigured
                ? `Assets ${money(settings.assets, currency)} − Liabilities ${money(settings.liabilities, currency)}`
                : "Nothing saved yet"}
            </span>
          </div>
        </article>

        <article className="stat">
          <span className="stat-label">Income</span>
          <div className="stat-value">{money(income, currency)}</div>
          <p className="stat-hint">All income entries inside the selected period.</p>
          <div className="stat-strip">
            <span>Selected period</span>
            <Trend current={income} previous={prevIncome} currency={currency} label="previous period" />
          </div>
        </article>

        <article className="stat">
          <span className="stat-label">Spending</span>
          <div className="stat-value">{money(spending, currency)}</div>
          <p className="stat-hint">All expense entries inside the selected period.</p>
          <div className="stat-strip">
            <span>Selected period</span>
            <Trend current={spending} previous={prevSpending} currency={currency} label="previous period" polarity="down" />
          </div>
        </article>

        <article className="stat">
          <span className="stat-label">Savings rate</span>
          <div className="stat-value">{percent(rate, 1)}</div>
          <p className="stat-hint">(income − spending) ÷ income. Income of zero shows 0%.</p>
          <div className="stat-strip">
            <span>Calculation strip</span>
            <span className="muted small">
              {income > 0 ? `${money(income - spending, currency)} saved` : "No income yet"}
            </span>
          </div>
        </article>
      </div>

      <div className="grid-2">
        <Card>
          <CardHead
            title="Cash flow"
            note="Monthly income and spending from saved transactions"
            action={
              <div className="segmented" role="group" aria-label="Cash flow range">
                <button className={classNames(chartMode === "6" && "active")} onClick={() => setChartMode("6")}>
                  6M
                </button>
                <button className={classNames(chartMode === "12" && "active")} onClick={() => setChartMode("12")}>
                  12M
                </button>
                <button className={classNames(chartMode === "custom" && "active")} onClick={() => setChartMode("custom")}>
                  Date period
                </button>
              </div>
            }
          />
          {chartMode === "custom" ? (
            <div className="row" style={{ marginBottom: 12 }}>
              <label className="field" style={{ flex: "1 1 140px" }}>
                <span>From</span>
                <input className="input" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
              </label>
              <label className="field" style={{ flex: "1 1 140px" }}>
                <span>To</span>
                <input className="input" type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
              </label>
            </div>
          ) : null}
          {points.length ? (
            <>
              <CashFlowChart points={points} currency={currency} />
              <div className="chart-legend" style={{ marginTop: 8 }}>
                <span>
                  <span className="swatch" style={{ background: "var(--chart-income)" }} /> Income
                </span>
                <span>
                  <span className="swatch" style={{ background: "var(--chart-expense)" }} /> Expenses
                </span>
                <span className="muted">Up to {chartMode === "12" ? "12" : "7"} monthly points</span>
              </div>
            </>
          ) : (
            <EmptyState title="Nothing to chart yet">
              Import or add transactions to see cash flow.
              <div style={{ marginTop: 10 }}>
                <button className="btn small" onClick={() => goTo("transactions")}>
                  Add a transaction
                </button>
              </div>
            </EmptyState>
          )}
        </Card>

        <Card>
          <CardHead title="Spending by category" note="Expense entries in the selected period" />
          {categories.length ? (
            <Donut data={categories.slice(0, 8)} currency={currency} />
          ) : (
            <EmptyState title="No spending recorded">
              Add an expense to see the category split for this period.
            </EmptyState>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card pad={false}>
          <div style={{ padding: "16px 16px 4px" }}>
            <CardHead title="Recent activity" note="Five newest transactions in the selected period" />
          </div>
          {recent.length ? (
            <div className="tx-list">
              {recent.map((tx) => (
                <div className="tx-row" key={tx.id}>
                  <div className={classNames("tx-icon", tx.type === "expense" && "expense")}>
                    {tx.merchant.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="tx-main">
                    <div className="tx-merchant">{tx.merchant}</div>
                    <div className="tx-meta">
                      <span>{formatDate(tx.date)}</span>
                      <span>·</span>
                      <span>{tx.category}</span>
                      {tx.account ? (
                        <>
                          <span>·</span>
                          <span>{tx.account}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className={classNames("tx-amount", tx.type)}>
                    {tx.type === "income" ? "+" : "−"}
                    {money(tx.amount, currency)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No activity in this period">
              Try another period or add your first entry.
            </EmptyState>
          )}
          <div style={{ padding: 12, borderTop: "1px solid var(--line)" }}>
            <button className="link-btn" onClick={() => goTo("transactions")}>
              View all transactions →
            </button>
          </div>
        </Card>

        <div className="stack">
          <Card>
            <CardHead title="Spendos insight" note="Facts from your saved data only" />
            <ul className="insight-list">
              {insights.slice(0, 4).map((insight, index) => (
                <li key={index}>
                  <span className="bullet" />
                  <span>{insight}</span>
                </li>
              ))}
            </ul>
            {needsReview > 0 ? (
              <div className="row" style={{ marginTop: 12 }}>
                <span className="pill warn">{needsReview} needs review</span>
                <button className="link-btn" onClick={() => goTo("transactions")}>
                  Review now →
                </button>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHead title="Coming up" note="Confirmed recurring expenses and subscriptions due in 30 days" />
            {dueSoon.length ? (
              <div>
                {dueSoon.map((row) => (
                  <div className="coming-row" key={`${row.name}-${row.date}`}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{row.name}</div>
                      <div className="card-note">{formatDate(row.date)}</div>
                    </div>
                    <div className="tx-amount">{money(row.amount, currency)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Nothing scheduled">
                No confirmed recurring expense is due in the next 30 days.{" "}
                <button className="link-btn" onClick={() => goTo("recurring")}>
                  Set up Recurring →
                </button>
              </EmptyState>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
