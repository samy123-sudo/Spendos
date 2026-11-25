import type { AppState, Transaction } from "./types";

export const PERIOD_OPTIONS = [
  { key: "all-time", label: "All time" },
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "last-3-months", label: "Last 3 months" },
  { key: "last-6-months", label: "Last 6 months" },
  { key: "this-year", label: "This year" },
] as const;

export type PeriodKey = (typeof PERIOD_OPTIONS)[number]["key"];

export interface DateRange {
  start: string | null;
  end: string | null;
}

export const iso = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const today = () => iso(new Date());

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addMonths = (date: Date, months: number) => new Date(date.getFullYear(), date.getMonth() + months, date.getDate());

export function periodRange(key: string): DateRange {
  const now = new Date();
  switch (key) {
    case "this-month":
      return { start: iso(startOfMonth(now)), end: iso(now) };
    case "last-month": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: iso(first), end: iso(last) };
    }
    case "last-3-months":
      return { start: iso(startOfMonth(addMonths(now, -2))), end: iso(now) };
    case "last-6-months":
      return { start: iso(startOfMonth(addMonths(now, -5))), end: iso(now) };
    case "this-year":
      return { start: iso(new Date(now.getFullYear(), 0, 1)), end: iso(now) };
    default:
      return { start: null, end: null };
  }
}

export const inRange = (date: string, range: DateRange) => {
  if (range.start && date < range.start) return false;
  if (range.end && date > range.end) return false;
  return true;
};

export const filterTransactions = (transactions: Transaction[], range: DateRange) =>
  transactions.filter((tx) => inRange(tx.date, range));

export function previousRange(range: DateRange): DateRange {
  if (!range.start || !range.end) return { start: null, end: null };
  const start = new Date(`${range.start}T00:00:00`);
  const end = new Date(`${range.end}T00:00:00`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  return { start: iso(prevStart), end: iso(prevEnd) };
}

export const sumBy = (transactions: Transaction[], type: "expense" | "income") =>
  transactions.filter((tx) => tx.type === type).reduce((total, tx) => total + tx.amount, 0);

export const round = (value: number) => Math.round(value * 100) / 100;

export function money(value: number, currency = "INR", compact = false) {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: compact ? 1 : 2,
      notation: compact ? "compact" : "standard",
    }).format(safe);
  } catch {
    return `₹${safe.toFixed(2)}`;
  }
}

export function signedMoney(value: number, currency = "INR") {
  const sign = value < 0 ? "−" : "+";
  return `${sign}${money(Math.abs(value), currency)}`;
}

export function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function shortDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export const monthKey = (date: string) => date.slice(0, 7);

export function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, 1);
  return date.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

export interface SeriesPoint {
  key: string;
  label: string;
  income: number;
  expense: number;
}

/** Monthly points for the cash-flow chart, at most `limit` points, newest last. */
export function monthlySeries(transactions: Transaction[], range: DateRange, limit = 7): SeriesPoint[] {
  const buckets = new Map<string, SeriesPoint>();
  for (const tx of filterTransactions(transactions, range)) {
    const key = monthKey(tx.date);
    const point = buckets.get(key) || { key, label: monthLabel(key), income: 0, expense: 0 };
    if (tx.type === "income") point.income += tx.amount;
    else point.expense += tx.amount;
    buckets.set(key, point);
  }
  const sorted = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  return sorted.slice(-limit);
}

export function categoryTotals(transactions: Transaction[]) {
  const map = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.type !== "expense") continue;
    const key = tx.category || "Uncategorized";
    map.set(key, (map.get(key) || 0) + tx.amount);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value: round(value) }))
    .sort((a, b) => b.value - a.value);
}

/** Category ramp: the Spendos palette, defined as CSS variables in styles.css. */
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
  "var(--chart-9)",
  "var(--chart-10)",
  "var(--chart-11)",
  "var(--chart-12)",
];

export function daysUntil(date: string) {
  if (!date) return null;
  const target = new Date(`${date.slice(0, 10)}T00:00:00`).getTime();
  const now = new Date(`${today()}T00:00:00`).getTime();
  return Math.round((target - now) / 86400000);
}

export function addDays(date: string, days: number) {
  const base = new Date(`${date.slice(0, 10)}T00:00:00`);
  base.setDate(base.getDate() + days);
  return iso(base);
}

export function advanceCadence(date: string, cadence: string) {
  const base = new Date(`${date.slice(0, 10)}T00:00:00`);
  if (cadence === "weekly") base.setDate(base.getDate() + 7);
  else if (cadence === "yearly") base.setFullYear(base.getFullYear() + 1);
  else if (cadence === "quarterly") base.setMonth(base.getMonth() + 3);
  else base.setMonth(base.getMonth() + 1);
  return iso(base);
}

export const savingsRate = (income: number, spending: number) => (income > 0 ? ((income - spending) / income) * 100 : 0);

export const percent = (value: number, digits = 1) => `${(Number.isFinite(value) ? value : 0).toFixed(digits)}%`;

export function classNames(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

export function uniqNames(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export const DEFAULT_STATE_SAFE = (state: AppState | null) =>
  state ?? {
    transactions: [],
    tags: [],
    rules: [],
    documents: [],
    debts: [],
    settings: {} as AppState["settings"],
    meta: { generatedAt: "", transactionLimit: 5000, documentLimit: 100 },
  };
