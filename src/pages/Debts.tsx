import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { addDebt, removeDebt, updateDebt } from "../api";
import type { PageProps } from "../pageProps";
import { Card, CardHead, EmptyState, Field } from "../components/ui";
import { daysUntil, formatDate, money, round, today } from "../utils";
import type { Debt } from "../types";

export default function Debts({ state, refresh, notify }: PageProps) {
  const settings = state.settings;
  const currency = settings.currency || "INR";
  const debts = state.debts || [];

  const [draft, setDraft] = useState({
    counterparty: "",
    amount: "",
    direction: "owed_to_me" as Debt["direction"],
    date: today(),
    dueDate: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);

  const open = debts.filter((debt) => !debt.settled);
  const totals = useMemo(() => {
    const owedToMe = round(open.filter((debt) => debt.direction === "owed_to_me").reduce((sum, debt) => sum + debt.amount, 0));
    const iOwe = round(open.filter((debt) => debt.direction === "i_owe").reduce((sum, debt) => sum + debt.amount, 0));
    const withMe = round(open.filter((debt) => debt.direction === "with_me").reduce((sum, debt) => sum + debt.amount, 0));
    return { owedToMe, iOwe, withMe, net: round(owedToMe - iOwe - withMe) };
  }, [open]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(draft.amount);
    if (!draft.counterparty.trim() || !(amount > 0)) {
      notify("A name and a positive amount are required.", true);
      return;
    }
    setBusy(true);
    try {
      await addDebt({
        counterparty: draft.counterparty.trim(),
        amount,
        direction: draft.direction,
        date: draft.date,
        dueDate: draft.dueDate,
        note: draft.note,
      });
      await refresh();
      setDraft({ ...draft, counterparty: "", amount: "", dueDate: "", note: "" });
      notify("Balance recorded.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not record the balance.", true);
    } finally {
      setBusy(false);
    }
  };

  const settle = async (id: string, settled: boolean) => {
    setBusy(true);
    try {
      await updateDebt(id, { settled });
      await refresh();
      notify(settled ? "Marked as settled." : "Reopened.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update.", true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Remove this balance entry?")) return;
    setBusy(true);
    try {
      await removeDebt(id);
      await refresh();
      notify("Balance removed.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not remove.", true);
    } finally {
      setBusy(false);
    }
  };

  const renderList = (direction: Debt["direction"]) => {
    const list = debts.filter((debt) => debt.direction === direction);
    const copy = {
      owed_to_me: {
        empty: "Nobody owes you right now",
        hint: "Record money you lent to a friend or family member.",
      },
      i_owe: {
        empty: "You owe nobody right now",
        hint: "Record money you borrowed so the balance is never a surprise.",
      },
      with_me: {
        empty: "No money with you from someone else",
        hint: "Record cash you are holding from a person — salary, a family fund or an advance — that you spend from.",
      },
    }[direction];
    if (!list.length) {
      return (
        <EmptyState title={copy.empty}>
          {copy.hint}
        </EmptyState>
      );
    }
    return list.map((debt) => {
      const days = debt.dueDate ? daysUntil(debt.dueDate) : null;
      return (
        <div className="budget-row" key={debt.id}>
          <div className="budget-top">
            <span style={{ fontWeight: 600 }}>
              {debt.counterparty}{" "}
              {debt.settled ? <span className="pill ok">settled</span> : null}
              {!debt.settled && days !== null && days < 0 ? <span className="pill red">overdue</span> : null}
            </span>
            <span className="num" style={{ fontWeight: 650, color: direction === "owed_to_me" ? "var(--olive-brown)" : "var(--charcoal)" }}>
              {money(debt.amount, currency)}
            </span>
          </div>
          <div className="row-between" style={{ fontSize: "0.76rem", color: "var(--ink-soft)" }}>
            <span>
              {formatDate(debt.date)}
              {debt.dueDate ? ` · due ${formatDate(debt.dueDate)}` : ""}
              {debt.note ? ` · ${debt.note}` : ""}
            </span>
            <span className="row" style={{ gap: 6 }}>
              <button className="btn-xs btn secondary" onClick={() => void settle(debt.id, !debt.settled)} disabled={busy}>
                {debt.settled ? "Reopen" : "Mark settled"}
              </button>
              <button className="link-btn" onClick={() => void remove(debt.id)}>
                Remove
              </button>
            </span>
          </div>
        </div>
      );
    });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Balances</p>
          <h1 className="page-title">Debts &amp; balances</h1>
          <p className="page-sub">
            Who owes you, what you still owe back, and money you are holding from someone else — all kept separate from
            spending.
          </p>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        <article className="stat">
          <span className="stat-label">Owed to you</span>
          <div className="stat-value" style={{ color: "var(--olive-brown)" }}>{money(totals.owedToMe, currency)}</div>
          <div className="stat-strip">
            <span>{open.filter((debt) => debt.direction === "owed_to_me").length} open balance(s)</span>
          </div>
        </article>
        <article className="stat">
          <span className="stat-label">You owe</span>
          <div className="stat-value">{money(totals.iOwe, currency)}</div>
          <div className="stat-strip">
            <span>{open.filter((debt) => debt.direction === "i_owe").length} open balance(s)</span>
          </div>
        </article>
        <article className="stat">
          <span className="stat-label">Money with me</span>
          <div className="stat-value" style={{ color: "var(--charcoal)" }}>{money(totals.withMe, currency)}</div>
          <div className="stat-strip">
            <span>{open.filter((debt) => debt.direction === "with_me").length} open fund(s) · money you hold but did not earn</span>
          </div>
        </article>
        <article className="stat">
          <span className="stat-label">Net position</span>
          <div className="stat-value" style={{ color: totals.net < 0 ? "var(--danger)" : "var(--olive-brown)" }}>
            {totals.net < 0 ? "−" : ""}
            {money(Math.abs(totals.net), currency)}
          </div>
          <div className="stat-strip">
            <span>Owed to you − you owe − money with me</span>
          </div>
        </article>
      </div>

      <Card style={{ marginBottom: 18 }}>
        <CardHead title="Record a balance" note="This never changes income, spending or net worth on its own" />
        <form className="stack" onSubmit={add}>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ flex: "2 1 160px" }}>
              <span>Person or business</span>
              <input
                className="input"
                value={draft.counterparty}
                onChange={(event) => setDraft({ ...draft, counterparty: event.target.value })}
                placeholder="e.g. Priya, Landlord"
              />
            </label>
            <label className="field" style={{ flex: "1 1 120px" }}>
              <span>Amount (₹)</span>
              <input
                className="input"
                type="number"
                min="1"
                step="0.01"
                value={draft.amount}
                onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
              />
            </label>
            <Field label="Direction">
              <select
                className="select"
                value={draft.direction}
                onChange={(event) => setDraft({ ...draft, direction: event.target.value as Debt["direction"] })}
              >
                <option value="owed_to_me">They owe me</option>
                <option value="i_owe">I owe them</option>
                <option value="with_me">Money with me (I use it)</option>
              </select>
            </Field>
          </div>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ flex: "1 1 140px" }}>
              <span>Date</span>
              <input className="input" type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
            </label>
            <label className="field" style={{ flex: "1 1 140px" }}>
              <span>Due date (optional)</span>
              <input className="input" type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} />
            </label>
            <label className="field" style={{ flex: "2 1 200px" }}>
              <span>Note</span>
              <input className="input" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Optional" />
            </label>
            <button className="btn" type="submit" disabled={busy}>
              Save balance
            </button>
          </div>
        </form>
      </Card>

      <div className="grid-3">
        <Card>
          <CardHead title="Who owes you" note="Money you lent and expect back" />
          {renderList("owed_to_me")}
        </Card>
        <Card>
          <CardHead title="What you owe" note="Money borrowed from others" />
          {renderList("i_owe")}
        </Card>
        <Card>
          <CardHead title="Money with me" note="Cash you hold from someone and spend from" />
          {renderList("with_me")}
          <p className="card-note" style={{ marginTop: 10 }}>
            To track what you spend from it, add an account with the same name in Settings and choose it when you add an
            expense. Salary you earn normally is income, not money with me.
          </p>
        </Card>
      </div>

      {debts.some((debt) => debt.settled) ? (
        <Card>
          <CardHead title="Settled history" note="Kept for your records" />
          {debts
            .filter((debt) => debt.settled)
            .map((debt) => (
              <div className="coming-row" key={debt.id}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {debt.counterparty}{" "}
                    <span className="pill">
                      {debt.direction === "owed_to_me" ? "lent" : debt.direction === "with_me" ? "with me" : "borrowed"}
                    </span>
                  </div>
                  <div className="card-note">
                    {formatDate(debt.date)}
                    {debt.note ? ` · ${debt.note}` : ""}
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="tx-amount muted">{money(debt.amount, currency)}</span>
                  <button className="link-btn" onClick={() => void settle(debt.id, false)}>
                    Reopen
                  </button>
                </div>
              </div>
            ))}
        </Card>
      ) : null}
    </>
  );
}
