import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { addTransactions, removeTransaction, updateTransaction } from "../api";
import type { PageProps } from "../pageProps";
import { Card, CardHead, EmptyState, Field } from "../components/ui";
import type { Transaction } from "../types";
import {
  PERIOD_OPTIONS,
  classNames,
  filterTransactions,
  formatDate,
  money,
  periodRange,
  today,
} from "../utils";

const CHANNELS = ["UPI", "Card", "Cash", "Bank transfer", "Net banking", "Wallet", "Cheque", "Other"];

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

export default function Transactions({ state, refresh, notify, goTo }: PageProps) {
  const settings = state.settings;
  const currency = settings.currency || "INR";
  const accounts = settings.accounts || [];

  const [period, setPeriod] = useState(settings.selectedPeriod || "all-time");
  const [type, setType] = useState<"all" | "expense" | "income">("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<string>("");

  const [form, setForm] = useState({
    merchant: "",
    amount: "",
    date: today(),
    type: "expense" as "expense" | "income",
    category: settings.categories[0]?.name || "Uncategorized",
    account: accounts[0]?.name || "",
    source: "UPI",
    tags: "",
    note: "",
    needsReview: false,
  });

  const [editDraft, setEditDraft] = useState<{ category: string; tags: string; needsReview: boolean }>({
    category: "",
    tags: "",
    needsReview: false,
  });

  const importRef = useRef<HTMLInputElement | null>(null);

  const visible = useMemo(() => {
    const range = periodRange(period);
    return filterTransactions(state.transactions, range).filter((tx) => {
      if (type !== "all" && tx.type !== type) return false;
      if (category !== "all" && tx.category !== category) return false;
      if (tagFilter !== "all" && !tx.tags.some((tag) => tag.toLowerCase() === tagFilter.toLowerCase())) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const haystack = `${tx.merchant} ${tx.category} ${tx.account} ${tx.note} ${tx.tags.join(" ")}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [state.transactions, period, type, category, tagFilter, search]);

  const totals = visible.reduce(
    (acc, tx) => {
      if (tx.type === "income") acc.income += tx.amount;
      else acc.expense += tx.amount;
      return acc;
    },
    { income: 0, expense: 0 },
  );

  const categoryNames = useMemo(() => {
    const set = new Set<string>();
    settings.categories.forEach((item) => set.add(item.name));
    state.transactions.forEach((tx) => set.add(tx.category));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [settings.categories, state.transactions]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const amount = Number(form.amount);
    if (!form.merchant.trim()) {
      notify("Add a merchant or source.", true);
      return;
    }
    if (!(amount > 0)) {
      notify("Amount must be a positive number.", true);
      return;
    }
    setBusy(true);
    try {
      const result = await addTransactions({
        merchant: form.merchant.trim(),
        amount,
        date: form.date,
        type: form.type,
        category: form.category,
        account: form.account,
        source: form.source,
        tags: form.tags.split(","),
        note: form.note,
        needsReview: form.needsReview,
      });
      await refresh();
      notify(
        result.inserted
          ? "Transaction added."
          : "That transaction already exists — it was skipped as a duplicate.",
        !result.inserted,
      );
      setForm((current) => ({
        ...current,
        merchant: "",
        amount: "",
        tags: "",
        note: "",
        needsReview: false,
        date: today(),
      }));
      if (result.inserted) setShowForm(false);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not save the transaction.", true);
    } finally {
      setBusy(false);
    }
  };

  const runImport = async (file: File) => {
    setBusy(true);
    setBatchResult("");
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length < 2) throw new Error("The CSV needs a header row and at least one entry.");
      const headers = rows[0].map((cell) => cell.trim().toLowerCase());
      const idx = (...names: string[]) => headers.findIndex((header) => names.includes(header));
      const dateIdx = idx("date", "transaction date");
      const merchantIdx = idx("merchant", "source", "description", "payee");
      const amountIdx = idx("amount", "value");
      const typeIdx = idx("type", "direction");
      const categoryIdx = idx("category");
      const accountIdx = idx("account");
      const tagsIdx = idx("tags", "labels");
      const sourceIdx = idx("channel", "method", "payment method", "source type");
      if (dateIdx < 0 || merchantIdx < 0 || amountIdx < 0) {
        throw new Error("The CSV needs at least date, merchant and amount columns.");
      }
      const items = rows.slice(1).map((cells) => ({
        date: (cells[dateIdx] || "").trim(),
        merchant: (cells[merchantIdx] || "").trim(),
        amount: Number(String(cells[amountIdx] || "").replace(/[^0-9.-]/g, "")),
        type: (typeIdx >= 0 && /income|credit/i.test(cells[typeIdx] || "") ? "income" : "expense") as "income" | "expense",
        category: categoryIdx >= 0 ? (cells[categoryIdx] || "").trim() || "Uncategorized" : "Uncategorized",
        account: accountIdx >= 0 ? (cells[accountIdx] || "").trim() : "",
        tags: tagsIdx >= 0 ? (cells[tagsIdx] || "").split(/[;|]/) : [],
        source: sourceIdx >= 0 ? (cells[sourceIdx] || "").trim() || "import" : "import",
      }));
      const result = await addTransactions(items);
      await refresh();
      setBatchResult(`Imported ${result.inserted} · duplicates skipped ${result.duplicates}`);
      notify(`${result.inserted} imported, ${result.duplicates} duplicates skipped.`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Import failed.", true);
    } finally {
      setBusy(false);
      if (importRef.current) importRef.current.value = "";
    }
  };

  const openEditor = (tx: Transaction) => {
    if (expanded === tx.id) {
      setExpanded(null);
      return;
    }
    setExpanded(tx.id);
    setEditDraft({ category: tx.category, tags: tx.tags.join(", "), needsReview: tx.needsReview });
  };

  const saveEditor = async (tx: Transaction) => {
    setBusy(true);
    try {
      await updateTransaction(tx.id, {
        category: editDraft.category,
        tags: editDraft.tags.split(","),
        needsReview: editDraft.needsReview,
      });
      await refresh();
      setExpanded(null);
      notify("Transaction updated.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update the transaction.", true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tx: Transaction) => {
    if (!window.confirm(`Delete ${tx.merchant} · ${money(tx.amount, currency)}?`)) return;
    setBusy(true);
    try {
      await removeTransaction(tx.id);
      await refresh();
      notify("Transaction deleted.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not delete the transaction.", true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Ledger</p>
          <h1 className="page-title">Transactions</h1>
          <p className="page-sub">
            Online and offline entries in one place — {visible.length} shown, {money(totals.expense, currency)} spent,{" "}
            {money(totals.income, currency)} received.
          </p>
        </div>
        <div className="row">
          <button className="btn secondary small" onClick={() => importRef.current?.click()} disabled={busy}>
            Import CSV
          </button>
          <button className="btn" onClick={() => setShowForm((value) => !value)}>
            {showForm ? "Close form" : "Add entry"}
          </button>
        </div>
      </div>

      <input
        ref={importRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void runImport(file);
        }}
      />

      {batchResult ? (
        <div className="note-box" style={{ marginBottom: 14 }}>
          {batchResult}
        </div>
      ) : null}

      {showForm ? (
        <Card className="stack" pad>
          <CardHead title="Add an entry" note="Duplicate entries (same date, merchant, amount and account) are skipped." />
          <form className="stack" onSubmit={submit}>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <label className="field" style={{ flex: "2 1 220px" }}>
                <span>Merchant / source</span>
                <input
                  className="input"
                  value={form.merchant}
                  onChange={(event) => setForm({ ...form, merchant: event.target.value })}
                  placeholder="e.g. Big Bazaar, Salary, Electricity bill"
                  required
                />
              </label>
              <label className="field" style={{ flex: "1 1 130px" }}>
                <span>Amount (₹)</span>
                <input
                  className="input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={(event) => setForm({ ...form, amount: event.target.value })}
                  placeholder="0.00"
                  required
                />
              </label>
              <label className="field" style={{ flex: "1 1 150px" }}>
                <span>Date</span>
                <input
                  className="input"
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm({ ...form, date: event.target.value })}
                  required
                />
              </label>
            </div>

            <div className="row" style={{ alignItems: "flex-end" }}>
              <Field label="Type">
                <select
                  className="select"
                  value={form.type}
                  onChange={(event) => setForm({ ...form, type: event.target.value as "expense" | "income" })}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </Field>
              <Field label="Category">
                <select className="select" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                  {categoryNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Channel">
                <select className="select" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>
                  {CHANNELS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="field" style={{ flex: "1 1 180px" }}>
                <span>Account</span>
                {accounts.length ? (
                  <select className="select" value={form.account} onChange={(event) => setForm({ ...form, account: event.target.value })}>
                    <option value="">No account</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.name}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <select className="select" disabled>
                      <option>No accounts yet</option>
                    </select>
                    <button type="button" className="link-btn" style={{ textAlign: "left" }} onClick={() => goTo("settings")}>
                      Add an account in Settings
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="row" style={{ alignItems: "flex-end" }}>
              <label className="field" style={{ flex: "1 1 240px" }}>
                <span>Tags (comma separated)</span>
                <input
                  className="input"
                  value={form.tags}
                  onChange={(event) => setForm({ ...form, tags: event.target.value })}
                  placeholder="festival, reimbursable"
                />
              </label>
              <label className="field" style={{ flex: "2 1 280px" }}>
                <span>Note</span>
                <input
                  className="input"
                  value={form.note}
                  onChange={(event) => setForm({ ...form, note: event.target.value })}
                  placeholder="Optional context for your advisor"
                />
              </label>
              <label className="row" style={{ gap: 8, fontSize: "0.82rem", paddingBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={form.needsReview}
                  onChange={(event) => setForm({ ...form, needsReview: event.target.checked })}
                />
                Needs review
              </label>
            </div>

            <div className="row">
              <button className="btn" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save entry"}
              </button>
              <button className="btn secondary" type="button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card pad={false} className="stack" >
        <div style={{ padding: "14px 16px" }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <input
              className="input"
              style={{ flex: "2 1 200px" }}
              placeholder="Search merchant, category, note or tag"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search transactions"
            />
            <select className="select" style={{ flex: "1 1 140px" }} value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Period">
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <select className="select" style={{ flex: "1 1 120px" }} value={type} onChange={(event) => setType(event.target.value as any)} aria-label="Type">
              <option value="all">All types</option>
              <option value="expense">Expenses</option>
              <option value="income">Income</option>
            </select>
            <select className="select" style={{ flex: "1 1 140px" }} value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category">
              <option value="all">All categories</option>
              {categoryNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select className="select" style={{ flex: "1 1 130px" }} value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} aria-label="Tag">
              <option value="all">All tags</option>
              {state.tags.map((tag) => (
                <option key={tag.id} value={tag.name}>
                  {tag.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {visible.length ? (
          <div className="tx-list">
            {visible.map((tx) => (
              <div key={tx.id}>
                <button
                  className="tx-row"
                  style={{ width: "100%", background: "none", border: "none", textAlign: "left" }}
                  onClick={() => openEditor(tx)}
                  aria-expanded={expanded === tx.id}
                >
                  <div className={classNames("tx-icon", tx.type === "expense" && "expense")}>
                    {tx.merchant.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="tx-main">
                    <div className="tx-merchant">
                      {tx.merchant}
                      {tx.needsReview ? (
                        <span className="pill warn" style={{ marginLeft: 8 }}>
                          review
                        </span>
                      ) : null}
                    </div>
                    <div className="tx-meta">
                      <span>{formatDate(tx.date)}</span>
                      <span>·</span>
                      <span>{tx.category}</span>
                      <span>·</span>
                      <span>{tx.account || "No account"}</span>
                      {tx.source ? (
                        <>
                          <span>·</span>
                          <span>{tx.source}</span>
                        </>
                      ) : null}
                      {tx.tags.length ? (
                        <>
                          <span>·</span>
                          <span>{tx.tags.map((tag) => `#${tag}`).join(" ")}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className={classNames("tx-amount", tx.type)}>
                    {tx.type === "income" ? "+" : "−"}
                    {money(tx.amount, currency)}
                  </div>
                </button>

                {expanded === tx.id ? (
                  <div style={{ padding: "12px 16px 16px", background: "var(--surface-sunken)", borderTop: "1px solid var(--line)" }}>
                    <div className="row" style={{ alignItems: "flex-end" }}>
                      <Field label="Category">
                        <select
                          className="select"
                          value={editDraft.category}
                          onChange={(event) => setEditDraft({ ...editDraft, category: event.target.value })}
                        >
                          {categoryNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <label className="field" style={{ flex: "2 1 220px" }}>
                        <span>Tags</span>
                        <input
                          className="input"
                          value={editDraft.tags}
                          onChange={(event) => setEditDraft({ ...editDraft, tags: event.target.value })}
                          placeholder="comma separated"
                        />
                      </label>
                      <label className="row" style={{ gap: 8, fontSize: "0.82rem", paddingBottom: 8 }}>
                        <input
                          type="checkbox"
                          checked={editDraft.needsReview}
                          onChange={(event) => setEditDraft({ ...editDraft, needsReview: event.target.checked })}
                        />
                        Needs review
                      </label>
                    </div>
                    {tx.note ? <p className="card-note" style={{ marginTop: 8 }}>{tx.note}</p> : null}
                    <div className="row" style={{ marginTop: 12 }}>
                      <button className="btn small" onClick={() => void saveEditor(tx)} disabled={busy}>
                        Save changes
                      </button>
                      <button className="btn secondary small" onClick={() => setExpanded(null)}>
                        Close
                      </button>
                      <button className="btn danger small" style={{ marginLeft: "auto" }} onClick={() => void remove(tx)} disabled={busy}>
                        Delete
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No transactions match"
            action={
              <button className="btn small" onClick={() => setShowForm(true)}>
                Add your first entry
              </button>
            }
          >
            Change the filters, or record an entry to get started.
          </EmptyState>
        )}
      </Card>
    </>
  );
}
