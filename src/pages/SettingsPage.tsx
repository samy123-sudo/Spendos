import { useEffect, useState } from "react";
import { wipeAllData } from "../api";
import type { PageProps } from "../pageProps";
import { Card, CardHead, EmptyState, Field } from "../components/ui";
import type { AccountDef, Category, HouseholdMember, Rule, Settings } from "../types";
import { PERIOD_OPTIONS, money, round, today } from "../utils";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
const WIPE_PHRASE = "DELETE ALL SPENDOS DATA";

export default function SettingsPage({ state, refresh, saveSettings, notify, goTo }: PageProps) {
  const settings = state.settings;
  const currency = settings.currency || "INR";

  const [categoryDraft, setCategoryDraft] = useState("");
  const [accountDraft, setAccountDraft] = useState({ name: "", type: "bank" });
  const [memberDraft, setMemberDraft] = useState({ name: "", role: "viewer" });
  const [ruleDraft, setRuleDraft] = useState({ match: "", category: settings.categories[0]?.name || "Groceries", tags: "" });
  const [assets, setAssets] = useState(String(settings.assets ?? 0));
  const [liabilities, setLiabilities] = useState(String(settings.liabilities ?? 0));
  const [householdName, setHouseholdName] = useState(settings.household?.name || "Our household");
  const [wipeText, setWipeText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAssets(String(settings.assets ?? 0));
    setLiabilities(String(settings.liabilities ?? 0));
    setHouseholdName(settings.household?.name || "Our household");
  }, [settings.assets, settings.liabilities, settings.household?.name]);

  const commit = async (patch: Record<string, unknown>, message: string) => {
    setBusy(true);
    try {
      await saveSettings(patch);
      notify(message);
      return true;
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not save settings.", true);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addCategory = async () => {
    const name = categoryDraft.trim();
    if (!name) return;
    if (settings.categories.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
      notify("That category already exists.", true);
      return;
    }
    const next: Category[] = [...settings.categories, { id: uid(), name }];
    if (await commit({ categories: next }, "Category added.")) setCategoryDraft("");
  };

  const removeCategory = async (id: string) => {
    await commit(
      { categories: settings.categories.filter((category) => category.id !== id) },
      "Category removed. Existing transactions keep their saved label.",
    );
  };

  const addAccount = async () => {
    const name = accountDraft.name.trim();
    if (!name) {
      notify("Give the account a name.", true);
      return;
    }
    if (settings.accounts.some((account) => account.name.toLowerCase() === name.toLowerCase())) {
      notify("That account already exists.", true);
      return;
    }
    const next: AccountDef[] = [...settings.accounts, { id: uid(), name, type: accountDraft.type, note: "" }];
    if (await commit({ accounts: next }, "Account added.")) setAccountDraft({ name: "", type: "bank" });
  };

  const removeAccount = async (id: string) => {
    await commit(
      { accounts: settings.accounts.filter((account) => account.id !== id) },
      "Account removed. Transactions keep the account name they were saved with.",
    );
  };

  const addMember = async () => {
    const name = memberDraft.name.trim();
    if (!name) {
      notify("Enter the person's name.", true);
      return;
    }
    const members: HouseholdMember[] = [
      ...(settings.household?.members || []),
      { id: uid(), name, role: memberDraft.role },
    ];
    if (await commit({ household: { name: householdName || "Our household", members } }, "Household member added.")) {
      setMemberDraft({ name: "", role: "viewer" });
    }
  };

  const removeMember = async (id: string) => {
    const members = (settings.household?.members || []).filter((member) => member.id !== id);
    await commit({ household: { name: householdName || "Our household", members } }, "Member removed.");
  };

  const saveNetWorth = async (configured: boolean) => {
    const nextAssets = configured ? Math.max(0, Number(assets) || 0) : 0;
    const nextLiabilities = configured ? Math.max(0, Number(liabilities) || 0) : 0;
    await commit(
      { assets: nextAssets, liabilities: nextLiabilities, netWorthConfigured: configured },
      configured ? "Net worth totals saved." : "Net worth totals cleared.",
    );
  };

  const addRule = async () => {
    if (!ruleDraft.match.trim()) {
      notify("A rule needs text to match against the merchant.", true);
      return;
    }
    const rules: Rule[] = [
      ...state.rules,
      {
        id: uid(),
        match: ruleDraft.match.trim(),
        category: ruleDraft.category,
        tags: ruleDraft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ];
    if (await commit({ rules }, "Rule added. It applies to new transactions only.")) {
      setRuleDraft({ ...ruleDraft, match: "", tags: "" });
    }
  };

  const removeRule = async (id: string) => {
    await commit({ rules: state.rules.filter((rule) => rule.id !== id) }, "Rule removed.");
  };

  const toggleRule = async (rule: Rule) => {
    await commit(
      { rules: state.rules.map((item) => (item.id === rule.id ? { ...item, enabled: !item.enabled } : item)) },
      rule.enabled ? "Rule disabled." : "Rule enabled.",
    );
  };

  const wipe = async () => {
    if (wipeText !== WIPE_PHRASE) {
      notify(`Type ${WIPE_PHRASE} exactly to confirm.`, true);
      return;
    }
    setBusy(true);
    try {
      const result = await wipeAllData();
      await refresh();
      setWipeText("");
      notify(result.message || "All data deleted.");
      goTo("dashboard");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not wipe the data.", true);
    } finally {
      setBusy(false);
    }
  };

  const shareUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Configure</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">
            Everything here is stored with your household data and applies to every device that opens this Site.
          </p>
        </div>
      </div>

      <div className="grid-2">
        <div className="stack">
          <Card>
            <CardHead title="Household &amp; collaboration" note="Your partner or financial advisor views the same figures" />
            <div className="row" style={{ alignItems: "flex-end", marginBottom: 14 }}>
              <label className="field" style={{ flex: "1 1 220px" }}>
                <span>Household name</span>
                <input className="input" value={householdName} onChange={(event) => setHouseholdName(event.target.value)} />
              </label>
              <button
                className="btn secondary"
                onClick={() =>
                  void commit(
                    { household: { name: householdName.trim() || "Our household", members: settings.household?.members || [] } },
                    "Household name saved.",
                  )
                }
                disabled={busy}
              >
                Save name
              </button>
            </div>

            {(settings.household?.members || []).length ? (
              (settings.household?.members || []).map((member) => (
                <div className="coming-row" key={member.id}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{member.name}</div>
                    <div className="card-note">{member.role}</div>
                  </div>
                  <button className="link-btn" onClick={() => void removeMember(member.id)}>
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <p className="card-note" style={{ marginBottom: 10 }}>
                No members listed yet. Add who shares this ledger; access itself is controlled by this Site's link.
              </p>
            )}

            <div className="row" style={{ alignItems: "flex-end", marginTop: 12 }}>
              <label className="field" style={{ flex: "1 1 160px" }}>
                <span>Add member</span>
                <input
                  className="input"
                  value={memberDraft.name}
                  onChange={(event) => setMemberDraft({ ...memberDraft, name: event.target.value })}
                  placeholder="Partner or advisor"
                />
              </label>
              <Field label="Role">
                <select
                  className="select"
                  value={memberDraft.role}
                  onChange={(event) => setMemberDraft({ ...memberDraft, role: event.target.value })}
                >
                  <option value="viewer">Viewer</option>
                  <option value="partner">Partner</option>
                  <option value="advisor">Financial advisor</option>
                  <option value="owner">Owner</option>
                </select>
              </Field>
              <button className="btn secondary" onClick={() => void addMember()} disabled={busy}>
                Add
              </button>
            </div>

            <div className="note-box" style={{ marginTop: 14 }}>
              Share this Site link so a partner or advisor sees the same household figures:{" "}
              <strong style={{ wordBreak: "break-all" }}>{shareUrl}</strong>
              <br />
              Spendos has no per-person logins — anyone with this Site's link opens the same ledger, so only share it with
              people you trust.
            </div>
          </Card>

          <Card>
            <CardHead title="Categories" note="Used for transactions, budgets and reports" />
            <div className="row" style={{ marginBottom: 12 }}>
              <input
                className="input"
                style={{ flex: "1 1 200px" }}
                value={categoryDraft}
                onChange={(event) => setCategoryDraft(event.target.value)}
                placeholder="New category name"
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addCategory();
                }}
              />
              <button className="btn secondary" onClick={() => void addCategory()} disabled={busy}>
                Add category
              </button>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {settings.categories.map((category) => (
                <span className="cat-chip" key={category.id}>
                  {category.name}
                  <button aria-label={`Remove ${category.name}`} onClick={() => void removeCategory(category.id)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            {!settings.categories.length ? <p className="card-note">No categories — add at least one for budgets.</p> : null}
          </Card>

          <Card>
            <CardHead title="Accounts" note="Add the accounts transactions can belong to" />
            {settings.accounts.length ? (
              <div style={{ marginBottom: 12 }}>
                {settings.accounts.map((account) => (
                  <div className="coming-row" key={account.id}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{account.name}</div>
                      <div className="card-note">{account.type}</div>
                    </div>
                    <button className="link-btn" onClick={() => void removeAccount(account.id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="warning-box" style={{ marginBottom: 12 }}>
                No accounts yet. The account selector on new transactions stays disabled until you add one here.
              </div>
            )}
            <div className="row" style={{ alignItems: "flex-end" }}>
              <label className="field" style={{ flex: "1 1 180px" }}>
                <span>Account name</span>
                <input
                  className="input"
                  value={accountDraft.name}
                  onChange={(event) => setAccountDraft({ ...accountDraft, name: event.target.value })}
                  placeholder="HDFC savings"
                />
              </label>
              <Field label="Type">
                <select
                  className="select"
                  value={accountDraft.type}
                  onChange={(event) => setAccountDraft({ ...accountDraft, type: event.target.value })}
                >
                  <option value="bank">Bank</option>
                  <option value="cash">Cash</option>
                  <option value="credit">Credit card</option>
                  <option value="wallet">Wallet</option>
                  <option value="investment">Investment</option>
                </select>
              </Field>
              <button className="btn secondary" onClick={() => void addAccount()} disabled={busy}>
                Add account
              </button>
            </div>
          </Card>

          <Card>
            <CardHead title="Categorization rules" note="Applied to new transactions after duplicate checks" />
            <div className="row" style={{ alignItems: "flex-end", marginBottom: 12 }}>
              <label className="field" style={{ flex: "1 1 160px" }}>
                <span>If merchant contains</span>
                <input
                  className="input"
                  value={ruleDraft.match}
                  onChange={(event) => setRuleDraft({ ...ruleDraft, match: event.target.value })}
                  placeholder="swiggy"
                />
              </label>
              <Field label="Set category">
                <select
                  className="select"
                  value={ruleDraft.category}
                  onChange={(event) => setRuleDraft({ ...ruleDraft, category: event.target.value })}
                >
                  {settings.categories.map((category) => (
                    <option key={category.id} value={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="field" style={{ flex: "1 1 140px" }}>
                <span>And tags</span>
                <input
                  className="input"
                  value={ruleDraft.tags}
                  onChange={(event) => setRuleDraft({ ...ruleDraft, tags: event.target.value })}
                  placeholder="food-delivery"
                />
              </label>
              <button className="btn secondary" onClick={() => void addRule()} disabled={busy}>
                Add rule
              </button>
            </div>
            {state.rules.length ? (
              state.rules.map((rule) => (
                <div className="coming-row" key={rule.id}>
                  <div>
                    <div style={{ fontWeight: 600 }}>“{rule.match}” → {rule.category || "no category"}</div>
                    <div className="card-note">
                      {rule.tags.length ? `tags: ${rule.tags.join(", ")} · ` : ""}
                      {rule.enabled ? "enabled" : "disabled"}
                    </div>
                  </div>
                  <span className="row" style={{ gap: 8 }}>
                    <button className="btn-xs btn secondary" onClick={() => void toggleRule(rule)}>
                      {rule.enabled ? "Disable" : "Enable"}
                    </button>
                    <button className="link-btn" onClick={() => void removeRule(rule.id)}>
                      Remove
                    </button>
                  </span>
                </div>
              ))
            ) : (
              <p className="card-note">No rules yet.</p>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card>
            <CardHead title="Net worth" note="Entered by you — cash flow never changes this automatically" />
            {settings.netWorthConfigured ? (
              <div className="note-box" style={{ marginBottom: 12 }}>
                Saved: {money(round(settings.assets - settings.liabilities), currency)} net worth (
                {money(settings.assets, currency)} assets − {money(settings.liabilities, currency)} liabilities).
              </div>
            ) : (
              <div className="warning-box" style={{ marginBottom: 12 }}>
                Not set. The dashboard shows <strong>Not set</strong> until you save totals here.
              </div>
            )}
            <div className="row" style={{ alignItems: "flex-end" }}>
              <label className="field" style={{ flex: "1 1 130px" }}>
                <span>Total assets (₹)</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="100"
                  value={assets}
                  onChange={(event) => setAssets(event.target.value)}
                />
              </label>
              <label className="field" style={{ flex: "1 1 130px" }}>
                <span>Total liabilities (₹)</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="100"
                  value={liabilities}
                  onChange={(event) => setLiabilities(event.target.value)}
                />
              </label>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => void saveNetWorth(true)} disabled={busy}>
                Save totals
              </button>
              <button className="btn secondary" onClick={() => void saveNetWorth(false)} disabled={busy}>
                Clear totals
              </button>
            </div>
          </Card>

          <Card>
            <CardHead title="Display &amp; defaults" />
            <div className="row" style={{ alignItems: "flex-end" }}>
              <Field label="Currency">
                <select
                  className="select"
                  value={settings.currency}
                  onChange={(event) => void commit({ currency: event.target.value }, "Currency updated.")}
                >
                  <option value="INR">INR — Indian rupee (₹)</option>
                  <option value="USD">USD — US dollar</option>
                  <option value="EUR">EUR — Euro</option>
                  <option value="GBP">GBP — Pound sterling</option>
                  <option value="AED">AED — UAE dirham</option>
                </select>
              </Field>
              <Field label="Default period">
                <select
                  className="select"
                  value={settings.selectedPeriod}
                  onChange={(event) => void commit({ selectedPeriod: event.target.value }, "Default period saved.")}
                >
                  {PERIOD_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="card-note" style={{ marginTop: 10 }}>
              Amounts are stored as plain numbers; changing currency only changes how they are displayed.
            </p>
          </Card>

          <Card>
            <CardHead title="Saved data" note="Counts from this Site" />
            <div className="insight-list">
              <div>
                <div className="budget-top">
                  <span>Transactions</span>
                  <span className="num">{state.transactions.length}</span>
                </div>
              </div>
              <div>
                <div className="budget-top">
                  <span>Documents</span>
                  <span className="num">{state.documents.length}</span>
                </div>
              </div>
              <div>
                <div className="budget-top">
                  <span>Tags</span>
                  <span className="num">{state.tags.length}</span>
                </div>
              </div>
              <div>
                <div className="budget-top">
                  <span>Debt balances</span>
                  <span className="num">{state.debts.length}</span>
                </div>
              </div>
            </div>
            <p className="card-note" style={{ marginTop: 10 }}>
              A fresh start was last requested{" "}
              {settings.driveResetAt ? new Date(settings.driveResetAt).toLocaleString("en-IN") : "never"}.
            </p>
          </Card>

          <Card>
            <CardHead title="Delete all data" note="This cannot be undone" />
            <div className="danger-box">
              <p style={{ marginBottom: 8 }}>
                This deletes every transaction, document, tag, rule, balance and setting for this Site, and removes all stored
                files. It does not delete anything from Google Drive.
              </p>
              <p>
                Type <strong>{WIPE_PHRASE}</strong> to enable the button.
              </p>
            </div>
            <div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
              <label className="field" style={{ flex: "1 1 220px" }}>
                <span>Confirmation</span>
                <input
                  className="input"
                  value={wipeText}
                  onChange={(event) => setWipeText(event.target.value)}
                  placeholder={WIPE_PHRASE}
                  autoComplete="off"
                />
              </label>
              <button className="btn danger" onClick={() => void wipe()} disabled={busy || wipeText !== WIPE_PHRASE}>
                Delete everything
              </button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
