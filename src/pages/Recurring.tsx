import { useState } from "react";
import type { FormEvent } from "react";
import type { PageProps } from "../pageProps";
import { Card, CardHead, EmptyState, Field } from "../components/ui";
import type { Cadence, RecurringEntry, Subscription } from "../types";
import { advanceCadence, daysUntil, formatDate, money, round, today } from "../utils";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
const CADENCES: Cadence[] = ["monthly", "quarterly", "yearly", "weekly"];

export default function Recurring({ state, saveSettings, notify }: PageProps) {
  const settings = state.settings;
  const currency = settings.currency || "INR";
  const recurring = settings.recurring || [];
  const subscriptions = settings.subscriptions || [];

  const [entryDraft, setEntryDraft] = useState({
    name: "",
    amount: "",
    type: "expense" as "expense" | "income",
    cadence: "monthly" as Cadence,
    nextDate: today(),
    category: "Rent",
    account: settings.accounts[0]?.name || "",
  });
  const [subDraft, setSubDraft] = useState({
    name: "",
    amount: "",
    cadence: "monthly" as Cadence,
    nextDate: today(),
    category: "Subscriptions",
    account: settings.accounts[0]?.name || "",
  });
  const [busy, setBusy] = useState(false);

  const commit = async (patch: Record<string, unknown>, message: string) => {
    setBusy(true);
    try {
      await saveSettings(patch);
      notify(message);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not save.", true);
    } finally {
      setBusy(false);
    }
  };

  const addEntry = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(entryDraft.amount);
    if (!entryDraft.name.trim() || !(amount > 0)) {
      notify("A recurring entry needs a name and a positive amount.", true);
      return;
    }
    const entry: RecurringEntry = {
      id: uid(),
      name: entryDraft.name.trim(),
      amount: round(amount),
      type: entryDraft.type,
      cadence: entryDraft.cadence,
      nextDate: entryDraft.nextDate,
      category: entryDraft.category,
      account: entryDraft.account,
      confirmed: false,
    };
    await commit({ recurring: [...recurring, entry] }, "Recurring entry added — confirm it to show it in Coming up.");
    setEntryDraft({ ...entryDraft, name: "", amount: "" });
  };

  const addSub = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(subDraft.amount);
    if (!subDraft.name.trim() || !(amount > 0)) {
      notify("A subscription needs a name and a positive amount.", true);
      return;
    }
    const sub: Subscription = {
      id: uid(),
      name: subDraft.name.trim(),
      amount: round(amount),
      cadence: subDraft.cadence,
      nextDate: subDraft.nextDate,
      category: subDraft.category,
      account: subDraft.account,
      active: true,
    };
    await commit({ subscriptions: [...subscriptions, sub] }, "Subscription added.");
    setSubDraft({ ...subDraft, name: "", amount: "" });
  };

  const toggleConfirmed = (entry: RecurringEntry) =>
    commit(
      { recurring: recurring.map((item) => (item.id === entry.id ? { ...item, confirmed: !item.confirmed } : item)) },
      entry.confirmed ? "Recurring entry unconfirmed." : "Recurring entry confirmed.",
    );

  const toggleActive = (sub: Subscription) =>
    commit(
      { subscriptions: subscriptions.map((item) => (item.id === sub.id ? { ...item, active: !item.active } : item)) },
      sub.active ? "Subscription paused." : "Subscription resumed.",
    );

  const advance = (kind: "recurring" | "subscription", id: string) => {
    if (kind === "recurring") {
      const next = recurring.map((item) =>
        item.id === id ? { ...item, nextDate: advanceCadence(item.nextDate || today(), item.cadence) } : item,
      );
      void commit({ recurring: next }, "Next due date advanced.");
    } else {
      const next = subscriptions.map((item) =>
        item.id === id ? { ...item, nextDate: advanceCadence(item.nextDate || today(), item.cadence) } : item,
      );
      void commit({ subscriptions: next }, "Next due date advanced.");
    }
  };

  const monthlyCost = round(
    subscriptions
      .filter((sub) => sub.active)
      .reduce((sum, sub) => {
        if (sub.cadence === "yearly") return sum + sub.amount / 12;
        if (sub.cadence === "quarterly") return sum + sub.amount / 3;
        if (sub.cadence === "weekly") return sum + (sub.amount * 52) / 12;
        return sum + sub.amount;
      }, 0),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Repeat business</p>
          <h1 className="page-title">Recurring &amp; subscriptions</h1>
          <p className="page-sub">
            Active subscriptions cost about {money(monthlyCost, currency)} a month. Confirmed recurring expenses appear in
            Coming up on the dashboard.
          </p>
        </div>
      </div>

      <div className="grid-2">
        <Card>
          <CardHead title="Recurring entries" note="Rent, salary, EMI, school fees and other repeat entries" />
          <form className="stack" onSubmit={addEntry} style={{ marginBottom: 14 }}>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <label className="field" style={{ flex: "2 1 150px" }}>
                <span>Name</span>
                <input
                  className="input"
                  value={entryDraft.name}
                  onChange={(event) => setEntryDraft({ ...entryDraft, name: event.target.value })}
                  placeholder="House rent"
                />
              </label>
              <label className="field" style={{ flex: "1 1 110px" }}>
                <span>Amount (₹)</span>
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={entryDraft.amount}
                  onChange={(event) => setEntryDraft({ ...entryDraft, amount: event.target.value })}
                />
              </label>
              <Field label="Type">
                <select
                  className="select"
                  value={entryDraft.type}
                  onChange={(event) => setEntryDraft({ ...entryDraft, type: event.target.value as "expense" | "income" })}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </Field>
            </div>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <Field label="Repeats">
                <select
                  className="select"
                  value={entryDraft.cadence}
                  onChange={(event) => setEntryDraft({ ...entryDraft, cadence: event.target.value as Cadence })}
                >
                  {CADENCES.map((cadence) => (
                    <option key={cadence} value={cadence}>
                      {cadence}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="field" style={{ flex: "1 1 150px" }}>
                <span>Next due</span>
                <input
                  className="input"
                  type="date"
                  value={entryDraft.nextDate}
                  onChange={(event) => setEntryDraft({ ...entryDraft, nextDate: event.target.value })}
                />
              </label>
              <Field label="Category">
                <select
                  className="select"
                  value={entryDraft.category}
                  onChange={(event) => setEntryDraft({ ...entryDraft, category: event.target.value })}
                >
                  {settings.categories.map((category) => (
                    <option key={category.id} value={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>
              <button className="btn" type="submit" disabled={busy}>
                Add
              </button>
            </div>
          </form>

          {recurring.length ? (
            recurring.map((entry) => {
              const days = daysUntil(entry.nextDate);
              return (
                <div className="budget-row" key={entry.id}>
                  <div className="budget-top">
                    <span style={{ fontWeight: 600 }}>
                      {entry.name}{" "}
                      <span className={entry.confirmed ? "pill ok" : "pill warn"}>
                        {entry.confirmed ? "confirmed" : "needs confirmation"}
                      </span>
                    </span>
                    <span className="num">
                      {entry.type === "income" ? "+" : "−"}
                      {money(entry.amount, currency)}
                    </span>
                  </div>
                  <div className="row-between" style={{ fontSize: "0.76rem", color: "var(--ink-soft)" }}>
                    <span>
                      {entry.cadence} · next {formatDate(entry.nextDate) || "not set"}
                      {days !== null ? ` (${days >= 0 ? `in ${days} days` : `${Math.abs(days)} days ago`})` : ""}
                      {entry.category ? ` · ${entry.category}` : ""}
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      <button className="btn-xs btn secondary" onClick={() => void advance("recurring", entry.id)}>
                        Advance
                      </button>
                      <button className="btn-xs btn secondary" onClick={() => void toggleConfirmed(entry)}>
                        {entry.confirmed ? "Unconfirm" : "Confirm"}
                      </button>
                      <button
                        className="link-btn"
                        onClick={() => void commit({ recurring: recurring.filter((item) => item.id !== entry.id) }, "Recurring entry removed.")}
                      >
                        Remove
                      </button>
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <EmptyState title="No recurring entries">
              Add rent, salary or an EMI so the dashboard can warn you about what is coming up.
            </EmptyState>
          )}
        </Card>

        <Card>
          <CardHead title="Subscriptions" note="Streaming, software and memberships" />
          <form className="stack" onSubmit={addSub} style={{ marginBottom: 14 }}>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <label className="field" style={{ flex: "2 1 150px" }}>
                <span>Service</span>
                <input
                  className="input"
                  value={subDraft.name}
                  onChange={(event) => setSubDraft({ ...subDraft, name: event.target.value })}
                  placeholder="Music streaming"
                />
              </label>
              <label className="field" style={{ flex: "1 1 110px" }}>
                <span>Amount (₹)</span>
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={subDraft.amount}
                  onChange={(event) => setSubDraft({ ...subDraft, amount: event.target.value })}
                />
              </label>
              <Field label="Billed">
                <select
                  className="select"
                  value={subDraft.cadence}
                  onChange={(event) => setSubDraft({ ...subDraft, cadence: event.target.value as Cadence })}
                >
                  {CADENCES.map((cadence) => (
                    <option key={cadence} value={cadence}>
                      {cadence}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <label className="field" style={{ flex: "1 1 150px" }}>
                <span>Next renewal</span>
                <input
                  className="input"
                  type="date"
                  value={subDraft.nextDate}
                  onChange={(event) => setSubDraft({ ...subDraft, nextDate: event.target.value })}
                />
              </label>
              <Field label="Category">
                <select
                  className="select"
                  value={subDraft.category}
                  onChange={(event) => setSubDraft({ ...subDraft, category: event.target.value })}
                >
                  {settings.categories.map((category) => (
                    <option key={category.id} value={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>
              <button className="btn" type="submit" disabled={busy}>
                Add
              </button>
            </div>
          </form>

          {subscriptions.length ? (
            subscriptions.map((sub) => (
              <div className="budget-row" key={sub.id}>
                <div className="budget-top">
                  <span style={{ fontWeight: 600 }}>
                    {sub.name}{" "}
                    <span className={sub.active ? "pill ok" : "pill"}>{sub.active ? "active" : "paused"}</span>
                  </span>
                  <span className="num">{money(sub.amount, currency)}</span>
                </div>
                <div className="row-between" style={{ fontSize: "0.76rem", color: "var(--ink-soft)" }}>
                  <span>
                    {sub.cadence} · renews {formatDate(sub.nextDate) || "not set"}
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <button className="btn-xs btn secondary" onClick={() => void advance("subscription", sub.id)}>
                      Advance
                    </button>
                    <button className="btn-xs btn secondary" onClick={() => void toggleActive(sub)}>
                      {sub.active ? "Pause" : "Resume"}
                    </button>
                    <button
                      className="link-btn"
                      onClick={() => void commit({ subscriptions: subscriptions.filter((item) => item.id !== sub.id) }, "Subscription removed.")}
                    >
                      Remove
                    </button>
                  </span>
                </div>
              </div>
            ))
          ) : (
            <EmptyState title="No subscriptions tracked">
              Add them here to see the true monthly cost and upcoming renewals.
            </EmptyState>
          )}
        </Card>
      </div>
    </>
  );
}
