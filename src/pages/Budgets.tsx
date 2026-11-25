import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { PageProps } from "../pageProps";
import { Card, CardHead, EmptyState, Field } from "../components/ui";
import type { Budget, Goal } from "../types";
import { classNames, filterTransactions, formatDate, money, periodRange, round, sumBy, today } from "../utils";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));

export default function Budgets({ state, saveSettings, notify, goTo }: PageProps) {
  const settings = state.settings;
  const currency = settings.currency || "INR";
  const budgets = settings.budgets || [];
  const goals = settings.goals || [];

  const monthRange = periodRange("this-month");
  const monthTx = filterTransactions(state.transactions, monthRange);
  const monthSpend = round(sumBy(monthTx, "expense"));
  const monthIncome = round(sumBy(monthTx, "income"));
  const totalBudget = round(budgets.reduce((sum, budget) => sum + budget.amount, 0));

  const [budgetDraft, setBudgetDraft] = useState({ category: settings.categories[0]?.name || "Groceries", amount: "" });
  const [goalDraft, setGoalDraft] = useState({ name: "", targetAmount: "", savedAmount: "", targetDate: "" });
  const [busy, setBusy] = useState(false);

  const categorySpend = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of monthTx) {
      if (tx.type !== "expense") continue;
      const key = tx.category || "Uncategorized";
      map.set(key, (map.get(key) || 0) + tx.amount);
    }
    return map;
  }, [monthTx]);

  const averages = useMemo(() => {
    const threeMonths = periodRange("last-3-months");
    const txs = filterTransactions(state.transactions, threeMonths);
    const map = new Map<string, number>();
    for (const tx of txs) {
      if (tx.type !== "expense") continue;
      map.set(tx.category, (map.get(tx.category) || 0) + tx.amount);
    }
    const result = new Map<string, number>();
    map.forEach((total, category) => result.set(category, round(total / 3)));
    return result;
  }, [state.transactions]);

  const saveBudget = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(budgetDraft.amount);
    if (!(amount > 0)) {
      notify("Enter a monthly amount greater than zero.", true);
      return;
    }
    setBusy(true);
    try {
      const existing = budgets.find((budget) => budget.category.toLowerCase() === budgetDraft.category.toLowerCase());
      const next: Budget[] = existing
        ? budgets.map((budget) => (budget.id === existing.id ? { ...budget, amount } : budget))
        : [...budgets, { id: uid(), category: budgetDraft.category, amount }];
      await saveSettings({ budgets: next });
      setBudgetDraft({ ...budgetDraft, amount: "" });
      notify(existing ? "Budget updated." : "Budget added.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not save the budget.", true);
    } finally {
      setBusy(false);
    }
  };

  const removeBudget = async (id: string) => {
    setBusy(true);
    try {
      await saveSettings({ budgets: budgets.filter((budget) => budget.id !== id) });
      notify("Budget removed.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not remove the budget.", true);
    } finally {
      setBusy(false);
    }
  };

  const saveGoal = async (event: FormEvent) => {
    event.preventDefault();
    if (!goalDraft.name.trim()) {
      notify("Give the goal a name.", true);
      return;
    }
    const targetAmount = Number(goalDraft.targetAmount);
    if (!(targetAmount > 0)) {
      notify("A goal needs a target amount.", true);
      return;
    }
    setBusy(true);
    try {
      const goal: Goal = {
        id: uid(),
        name: goalDraft.name.trim(),
        targetAmount,
        savedAmount: Number(goalDraft.savedAmount) || 0,
        targetDate: goalDraft.targetDate,
        note: "",
      };
      await saveSettings({ goals: [...goals, goal] });
      setGoalDraft({ name: "", targetAmount: "", savedAmount: "", targetDate: "" });
      notify("Goal saved.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not save the goal.", true);
    } finally {
      setBusy(false);
    }
  };

  const updateGoal = async (goal: Goal, savedAmount: number) => {
    try {
      await saveSettings({ goals: goals.map((item) => (item.id === goal.id ? { ...item, savedAmount } : item)) });
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update the goal.", true);
    }
  };

  const removeGoal = async (id: string) => {
    try {
      await saveSettings({ goals: goals.filter((goal) => goal.id !== id) });
      notify("Goal removed.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not remove the goal.", true);
    }
  };

  const unbudgeted = [...categorySpend.entries()]
    .filter(([category]) => !budgets.some((budget) => budget.category.toLowerCase() === category.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Plan before you spend</p>
          <h1 className="page-title">Budgets &amp; goals</h1>
          <p className="page-sub">
            {money(monthSpend, currency)} spent this month against {money(totalBudget, currency)} planned
            {monthIncome > 0 ? ` · ${money(monthIncome, currency)} income` : ""}.
          </p>
        </div>
        <button className="btn secondary small" onClick={() => goTo("transactions")}>
          Add an expense
        </button>
      </div>

      <div className="grid-2">
        <Card>
          <CardHead title="Monthly budgets" note="Compared with real expenses recorded this month" />
          <form className="row" style={{ alignItems: "flex-end", marginBottom: 14 }} onSubmit={saveBudget}>
            <Field label="Category">
              <select
                className="select"
                value={budgetDraft.category}
                onChange={(event) => setBudgetDraft({ ...budgetDraft, category: event.target.value })}
              >
                {settings.categories.map((category) => (
                  <option key={category.id} value={category.name}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
            <label className="field" style={{ flex: "1 1 130px" }}>
              <span>Monthly amount (₹)</span>
              <input
                className="input"
                type="number"
                min="1"
                step="1"
                value={budgetDraft.amount}
                onChange={(event) => setBudgetDraft({ ...budgetDraft, amount: event.target.value })}
                placeholder="0"
              />
            </label>
            <button className="btn" type="submit" disabled={busy}>
              Set budget
            </button>
          </form>

          {budgets.length ? (
            <div>
              {budgets.map((budget) => {
                const spent = round(categorySpend.get(budget.category) || 0);
                const used = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
                const over = spent > budget.amount;
                return (
                  <div className="budget-row" key={budget.id}>
                    <div className="budget-top">
                      <span style={{ fontWeight: 600 }}>{budget.category}</span>
                      <span className="num">
                        {money(spent, currency)} of {money(budget.amount, currency)}
                      </span>
                    </div>
                    <div className={classNames("progress", over && "over")}>
                      <span style={{ width: `${Math.min(100, Math.max(used, spent > 0 ? 3 : 0))}%` }} />
                    </div>
                    <div className="row-between" style={{ fontSize: "0.74rem", color: "var(--ink-soft)" }}>
                      <span className={over ? "pill red" : "pill ok"}>
                        {over
                          ? `${money(spent - budget.amount, currency)} over`
                          : `${money(budget.amount - spent, currency)} left`}
                      </span>
                      <span>
                        {averages.get(budget.category) !== undefined
                          ? `3-month average ${money(averages.get(budget.category)!, currency)}`
                          : `No 3-month history yet`}
                        {" · "}
                        <button className="link-btn" onClick={() => void removeBudget(budget.id)}>
                          Remove
                        </button>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState title="No budgets yet">
              Plan a category above. Spendos compares each budget with the expenses you actually record.
            </EmptyState>
          )}
        </Card>

        <div className="stack">
          <Card>
            <CardHead title="Plan check" note="Where this month stands" />
            <div className="insight-list">
              <div>
                <div className="budget-top">
                  <span>Planned</span>
                  <span className="num">{money(totalBudget, currency)}</span>
                </div>
              </div>
              <div>
                <div className="budget-top">
                  <span>Spent</span>
                  <span className="num">{money(monthSpend, currency)}</span>
                </div>
              </div>
              <div>
                <div className="budget-top">
                  <span>{totalBudget - monthSpend >= 0 ? "Remaining" : "Over plan"}</span>
                  <span className="num">{money(Math.abs(totalBudget - monthSpend), currency)}</span>
                </div>
              </div>
            </div>
            {unbudgeted.length ? (
              <>
                <p className="section-title" style={{ marginTop: 16 }}>
                  Spending without a budget
                </p>
                <ul className="insight-list">
                  {unbudgeted.map(([category, amount]) => (
                    <li key={category}>
                      <span className="bullet" />
                      <span>
                        <strong>{category}</strong> · {money(amount, currency)} this month
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="card-note" style={{ marginTop: 14 }}>
                Every category you spent in this month has a budget.
              </p>
            )}
          </Card>

          <Card>
            <CardHead title="Goals" note="Track progress toward money you are setting aside" />
            <form className="stack" onSubmit={saveGoal} style={{ marginBottom: goals.length ? 12 : 0 }}>
              <div className="row" style={{ alignItems: "flex-end" }}>
                <label className="field" style={{ flex: "2 1 150px" }}>
                  <span>Goal name</span>
                  <input
                    className="input"
                    value={goalDraft.name}
                    onChange={(event) => setGoalDraft({ ...goalDraft, name: event.target.value })}
                    placeholder="Emergency fund"
                  />
                </label>
                <label className="field" style={{ flex: "1 1 110px" }}>
                  <span>Target (₹)</span>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={goalDraft.targetAmount}
                    onChange={(event) => setGoalDraft({ ...goalDraft, targetAmount: event.target.value })}
                  />
                </label>
              </div>
              <div className="row" style={{ alignItems: "flex-end" }}>
                <label className="field" style={{ flex: "1 1 110px" }}>
                  <span>Saved (₹)</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    value={goalDraft.savedAmount}
                    onChange={(event) => setGoalDraft({ ...goalDraft, savedAmount: event.target.value })}
                  />
                </label>
                <label className="field" style={{ flex: "1 1 150px" }}>
                  <span>Target date</span>
                  <input
                    className="input"
                    type="date"
                    min={today()}
                    value={goalDraft.targetDate}
                    onChange={(event) => setGoalDraft({ ...goalDraft, targetDate: event.target.value })}
                  />
                </label>
                <button className="btn secondary" type="submit" disabled={busy}>
                  Add goal
                </button>
              </div>
            </form>

            {goals.length ? (
              goals.map((goal) => {
                const progress = goal.targetAmount > 0 ? (goal.savedAmount / goal.targetAmount) * 100 : 0;
                return (
                  <div className="budget-row" key={goal.id}>
                    <div className="budget-top">
                      <span style={{ fontWeight: 600 }}>{goal.name}</span>
                      <span className="num">
                        {money(goal.savedAmount, currency)} / {money(goal.targetAmount, currency)}
                      </span>
                    </div>
                    <div className="progress">
                      <span style={{ width: `${Math.min(100, progress)}%` }} />
                    </div>
                    <div className="row-between" style={{ fontSize: "0.74rem", color: "var(--ink-soft)" }}>
                      <span>
                        {progress.toFixed(0)}% funded
                        {goal.targetDate ? ` · target ${formatDate(goal.targetDate)}` : ""}
                      </span>
                      <span className="row" style={{ gap: 6 }}>
                        <button
                          className="btn-xs btn secondary"
                          onClick={() => void updateGoal(goal, round(goal.savedAmount + goal.targetAmount * 0.1))}
                        >
                          +10% of target
                        </button>
                        <button className="link-btn" onClick={() => void removeGoal(goal.id)}>
                          Remove
                        </button>
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="card-note">No goals yet. Add one to track planned savings — saved amounts are entered by you, not inferred.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
