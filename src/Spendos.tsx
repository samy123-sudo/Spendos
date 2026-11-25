import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { fetchState, savePreferences } from "./api";
import { Icon } from "./components/Icon";
import type { AppState } from "./types";
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Budgets from "./pages/Budgets";
import Recurring from "./pages/Recurring";
import CalendarPage from "./pages/CalendarPage";
import Debts from "./pages/Debts";
import Documents from "./pages/Documents";
import Insights from "./pages/Insights";
import SettingsPage from "./pages/SettingsPage";
import { classNames } from "./utils";

export const NAV = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "transactions", label: "Transactions", icon: "transactions" },
  { key: "budgets", label: "Budgets", icon: "budgets" },
  { key: "recurring", label: "Recurring", icon: "recurring" },
  { key: "calendar", label: "Calendar", icon: "calendar" },
  { key: "debts", label: "Debts", icon: "debts" },
  { key: "documents", label: "Documents", icon: "documents" },
  { key: "insights", label: "Insights", icon: "insights" },
  { key: "settings", label: "Settings", icon: "settings" },
] as const;

type TabKey = (typeof NAV)[number]["key"];

const readTab = (): TabKey => {
  const hash = window.location.hash.replace("#", "");
  return (NAV.some((item) => item.key === hash) ? hash : "dashboard") as TabKey;
};

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<TabKey>(readTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((message: string, isError = false) => {
    setToast({ message, isError });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchState();
      setState(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your ledger.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onHash = () => setTab(readTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [tab]);

  const goTo = useCallback((next: string) => {
    const key = (NAV.some((item) => item.key === next) ? next : "dashboard") as TabKey;
    setTab(key);
    window.location.hash = key;
  }, []);

  const saveSettings = useCallback(
    async (patch: Record<string, unknown>) => {
      const result = await savePreferences(patch);
      setState((current) => (current ? { ...current, settings: result.settings } : current));
      return result.settings;
    },
    [],
  );

  if (loading) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "var(--ink-soft)" }}>
        <div style={{ textAlign: "center" }}>
          <div className="brand-mark" style={{ margin: "0 auto 12px" }}>
            S
          </div>
          Loading your ledger…
        </div>
      </div>
    );
  }

  if (!state || error) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
        <div className="card card-pad" style={{ maxWidth: 460 }}>
          <h1 className="page-title" style={{ fontSize: "1.2rem", marginBottom: 8 }}>
            Spendos could not load
          </h1>
          <p className="page-sub" style={{ marginBottom: 14 }}>
            {error || "The ledger service did not respond."}
          </p>
          <button className="btn" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const current = NAV.find((item) => item.key === tab) || NAV[0];
  const reviewCount = state.transactions.filter((tx) => tx.needsReview).length;

  const pages: Record<TabKey, ReactNode> = {
    dashboard: <Dashboard state={state} refresh={refresh} saveSettings={saveSettings} notify={notify} goTo={goTo} />,
    transactions: <Transactions state={state} refresh={refresh} saveSettings={saveSettings} notify={notify} goTo={goTo} />,
    budgets: <Budgets state={state} refresh={refresh} saveSettings={saveSettings} notify={notify} goTo={goTo} />,
    recurring: <Recurring state={state} refresh={refresh} saveSettings={saveSettings} notify={notify} goTo={goTo} />,
    calendar: <CalendarPage state={state} refresh={refresh} saveSettings={saveSettings} notify={notify} goTo={goTo} />,
    debts: <Debts state={state} refresh={refresh} saveSettings={saveSettings} notify={notify} goTo={goTo} />,
    documents: <Documents state={state} refresh={refresh} saveSettings={saveSettings} notify={notify} goTo={goTo} />,
    insights: <Insights state={state} refresh={refresh} saveSettings={saveSettings} notify={notify} goTo={goTo} />,
    settings: <SettingsPage state={state} refresh={refresh} saveSettings={saveSettings} notify={notify} goTo={goTo} />,
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div className="brand-text">
            <span className="brand-name">Spendos</span>
            <span className="brand-tag">Plan before you spend</span>
          </div>
        </div>

        <nav className="nav" aria-label="Main navigation">
          {NAV.map((item) => (
            <button
              key={item.key}
              className={classNames("nav-item", tab === item.key && "active")}
              onClick={() => goTo(item.key)}
              aria-current={tab === item.key ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.key === "transactions" && reviewCount > 0 ? <span className="nav-count">{reviewCount}</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <strong>{state.settings.household?.name || "Our household"}</strong>
          <br />
          {state.settings.currency} · shared via this Site link
          <br />
          {state.documents.length} document{state.documents.length === 1 ? "" : "s"} stored
        </div>
      </aside>

      <main className="main">
        <div className="mobile-topbar">
          <div className="row" style={{ gap: 8 }}>
            <div className="brand-mark">S</div>
            <div>
              <div className="brand-name">Spendos</div>
              <div className="mobile-page">{current.label}</div>
            </div>
          </div>
          <button className="btn small accent" onClick={() => goTo("transactions")}>
            Add entry
          </button>
        </div>

        {pages[tab]}

        <div className="bottom-nav-hint">Swipe the bar for more tabs →</div>
      </main>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        {NAV.map((item) => (
          <button
            key={item.key}
            className={classNames(tab === item.key && "active")}
            onClick={() => goTo(item.key)}
            aria-current={tab === item.key ? "page" : undefined}
          >
            <span className="nav-icon">
              <Icon name={item.icon} size={19} />
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {toast ? <div className={classNames("toast", toast.isError && "error")}>{toast.message}</div> : null}
    </div>
  );
}
