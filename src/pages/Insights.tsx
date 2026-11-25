import { useMemo } from "react";
import type { PageProps } from "../pageProps";
import { Card, CardHead, EmptyState } from "../components/ui";
import {
  categoryTotals,
  classNames,
  filterTransactions,
  money,
  percent,
  periodRange,
  previousRange,
  round,
  savingsRate,
  sumBy,
} from "../utils";

export default function Insights({ state, goTo }: PageProps) {
  const settings = state.settings;
  const currency = settings.currency || "INR";
  const period = settings.selectedPeriod || "this-month";
  const range = periodRange(period);
  const transactions = filterTransactions(state.transactions, range);
  const income = round(sumBy(transactions, "income"));
  const spending = round(sumBy(transactions, "expense"));
  const rate = savingsRate(income, spending);

  const prevRange = previousRange(range);
  const prevTxs = prevRange.start ? filterTransactions(state.transactions, prevRange) : [];
  const prevIncome = round(sumBy(prevTxs, "income"));
  const prevSpending = round(sumBy(prevTxs, "expense"));
  const prevRate = prevIncome > 0 ? savingsRate(prevIncome, prevSpending) : null;

  const prevCategories = useMemo(() => {
    const map = new Map(categoryTotals(prevTxs).map((row) => [row.name, row.value]));
    return map;
  }, [prevTxs]);

  const categories = categoryTotals(transactions);
  const monthTx = filterTransactions(state.transactions, periodRange("this-month"));
  const openDebts = state.debts.filter((debt) => !debt.settled);
  const owedToMe = round(openDebts.filter((debt) => debt.direction === "owed_to_me").reduce((sum, debt) => sum + debt.amount, 0));
  const iOwe = round(openDebts.filter((debt) => debt.direction === "i_owe").reduce((sum, debt) => sum + debt.amount, 0));
  const withMe = round(openDebts.filter((debt) => debt.direction === "with_me").reduce((sum, debt) => sum + debt.amount, 0));
  const needsReview = state.transactions.filter((tx) => tx.needsReview);

  const recurringMonthly = round(
    (settings.recurring || [])
      .filter((item) => item.confirmed && item.type === "expense")
      .reduce((sum, item) => {
        if (item.cadence === "yearly") return sum + item.amount / 12;
        if (item.cadence === "quarterly") return sum + item.amount / 3;
        if (item.cadence === "weekly") return sum + (item.amount * 52) / 12;
        return sum + item.amount;
      }, 0) +
      (settings.subscriptions || [])
        .filter((sub) => sub.active)
        .reduce((sum, sub) => {
          if (sub.cadence === "yearly") return sum + sub.amount / 12;
          if (sub.cadence === "quarterly") return sum + sub.amount / 3;
          if (sub.cadence === "weekly") return sum + (sub.amount * 52) / 12;
          return sum + sub.amount;
        }, 0),
  );

  const budgetOver = (settings.budgets || [])
    .map((budget) => {
      const spent = round(
        monthTx
          .filter((tx) => tx.type === "expense" && tx.category.toLowerCase() === budget.category.toLowerCase())
          .reduce((sum, tx) => sum + tx.amount, 0),
      );
      return { category: budget.category, amount: budget.amount, spent };
    })
    .filter((row) => row.spent > row.amount);

  const movements = categories
    .map((row) => {
      const before = prevCategories.get(row.name);
      if (before === undefined || before === 0) return null;
      const change = ((row.value - before) / before) * 100;
      if (Math.abs(change) < 15) return null;
      return { name: row.name, change, before, now: row.value };
    })
    .filter(Boolean)
    .slice(0, 5) as { name: string; change: number; before: number; now: number }[];

  const obligations = round(iOwe + withMe);
  const monthsToClear = obligations > 0 && income - spending > 0 ? Math.ceil(obligations / (income - spending)) : null;

  const hasData = state.transactions.length > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Advice</p>
          <h1 className="page-title">Insights &amp; advice</h1>
          <p className="page-sub">
            Every figure comes from entries you saved. Nothing here is generated from missing data.
          </p>
        </div>
      </div>

      {!hasData ? (
        <Card>
          <EmptyState
            title="Not enough data for advice"
            action={
              <button className="btn small" onClick={() => goTo("transactions")}>
                Add your first transaction
              </button>
            }
          >
            Insights appear once there are saved transactions. Spendos will never invent a saving that is not in your ledger.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid-2">
            <Card>
              <CardHead title="Financial progress" note={`Selected period: ${period.replace(/-/g, " ")}`} />
              <div className="budget-row">
                <div className="budget-top">
                  <span>Savings rate</span>
                  <span className="num">{percent(rate, 1)}</span>
                </div>
                <div className="progress">
                  <span style={{ width: `${Math.min(100, Math.max(0, rate))}%` }} />
                </div>
                <p className="card-note">
                  {income > 0
                    ? `${money(income - spending, currency)} of ${money(income, currency)} income kept.`
                    : "No income recorded in this period, so the rate is 0%."}
                  {prevRate !== null ? ` Previous period: ${percent(prevRate, 1)}.` : ""}
                </p>
              </div>
              <div className="budget-row">
                <div className="budget-top">
                  <span>Income vs spending</span>
                  <span className="num">
                    {money(income, currency)} / {money(spending, currency)}
                  </span>
                </div>
                <div className={classNames("progress", spending > income && "over")}>
                  <span style={{ width: `${income > 0 ? Math.min(100, (spending / income) * 100) : 100}%` }} />
                </div>
                <p className="card-note">
                  {income > 0
                    ? spending > income
                      ? `Spending is ${percent(((spending - income) / income) * 100, 1)} above income.`
                      : `Spending uses ${percent((spending / income) * 100, 1)} of income.`
                    : `Spending with no recorded income in this period: ${money(spending, currency)}.`}
                </p>
              </div>
              <div className="budget-row">
                <div className="budget-top">
                  <span>Committed monthly cost</span>
                  <span className="num">{money(recurringMonthly, currency)}</span>
                </div>
                <p className="card-note">
                  Confirmed recurring expenses and active subscriptions, normalised to a month.{" "}
                  {income > 0 ? `That is ${percent((recurringMonthly / income) * 100, 1)} of this period's income.` : ""}
                </p>
              </div>
            </Card>

            <Card>
              <CardHead title="Plan before you spend" note="Budget and category signals" />
              {budgetOver.length ? (
                <ul className="insight-list">
                  {budgetOver.map((row) => (
                    <li key={row.category}>
                      <span className="bullet" />
                      <span>
                        <strong>{row.category}</strong> is {money(row.spent - row.amount, currency)} over its{" "}
                        {money(row.amount, currency)} monthly budget.
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="card-note">
                  {settings.budgets?.length
                    ? "No category is over its monthly budget right now."
                    : "No budgets set yet. A budget per category makes the first warning measurable."}
                </p>
              )}
              {movements.length ? (
                <>
                  <p className="section-title" style={{ marginTop: 16 }}>
                    Category movement vs previous period
                  </p>
                  <ul className="insight-list">
                    {movements.map((row) => (
                      <li key={row.name}>
                        <span className="bullet" />
                        <span>
                          <strong>{row.name}</strong> {row.change > 0 ? "up" : "down"} {percent(Math.abs(row.change), 0)}:{" "}
                          {money(row.before, currency)} → {money(row.now, currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="card-note" style={{ marginTop: 14 }}>
                  No category moved by 15% or more versus the previous period with comparable data.
                </p>
              )}
              {settings.budgets?.length === 0 ? (
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn secondary small" onClick={() => goTo("budgets")}>
                    Set monthly budgets
                  </button>
                </div>
              ) : null}
            </Card>
          </div>

          <div className="grid-2">
            <Card>
              <CardHead title="Debt advice" note="Based on the balances you recorded" />
              {openDebts.length ? (
                <ul className="insight-list">
                  <li>
                    <span className="bullet" />
                    <span>
                      You owe <strong>{money(iOwe, currency)}</strong>, hold <strong>{money(withMe, currency)}</strong> that
                      belongs to someone else, and are owed <strong>{money(owedToMe, currency)}</strong>.
                    </span>
                  </li>
                  {obligations > owedToMe ? (
                    <li>
                      <span className="bullet" />
                      <span>
                        Net debt is <strong>{money(obligations - owedToMe, currency)}</strong>. Clearing the smallest balances
                        first reduces the number of open obligations fastest.
                      </span>
                    </li>
                  ) : null}
                  {monthsToClear !== null ? (
                    <li>
                      <span className="bullet" />
                      <span>
                        At this period's surplus of {money(income - spending, currency)}, the full{" "}
                        {money(obligations, currency)} owed back would take about <strong>{monthsToClear} month(s)</strong> of
                        simple arithmetic — no interest modelled.
                      </span>
                    </li>
                  ) : (
                    <li>
                      <span className="bullet" />
                      <span>No positive surplus in this period, so no repayment timeline is shown.</span>
                    </li>
                  )}
                  <li>
                    <span className="bullet" />
                    <span>
                      Balances you settle stop counting toward your position immediately.{" "}
                      <button className="link-btn" onClick={() => goTo("debts")}>
                        Review balances →
                      </button>
                    </span>
                  </li>
                </ul>
              ) : (
                <EmptyState title="No balances recorded">
                  Track money lent and borrowed on the Debts tab to get debt guidance.
                </EmptyState>
              )}
            </Card>

            <Card>
              <CardHead title="Data quality" note="What still needs a human decision" />
              <div className="insight-list">
                <div>
                  <div className="budget-top">
                    <span>Transactions flagged for review</span>
                    <span className="num">{needsReview.length}</span>
                  </div>
                </div>
                <div>
                  <div className="budget-top">
                    <span>Uncategorized in this period</span>
                    <span className="num">
                      {transactions.filter((tx) => tx.category === "Uncategorized").length}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="budget-top">
                    <span>Documents stored</span>
                    <span className="num">{state.documents.length}</span>
                  </div>
                </div>
                <div>
                  <div className="budget-top">
                    <span>Transactions saved</span>
                    <span className="num">{state.transactions.length}</span>
                  </div>
                </div>
              </div>
              {needsReview.length ? (
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn secondary small" onClick={() => goTo("transactions")}>
                    Review {needsReview.length} transaction(s)
                  </button>
                </div>
              ) : (
                <p className="card-note" style={{ marginTop: 12 }}>
                  Nothing is waiting for review.
                </p>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
