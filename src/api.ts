import type { AppState, Debt, Settings, Transaction } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload?.error || `Request failed (${response.status})`;
    if (response.status === 401) throw new UnauthenticatedError(message);
    throw new Error(message);
  }
  return payload as T;
}

export class UnauthenticatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export const signIn = (passphrase: string) =>
  request<{ ok: boolean; authenticated: boolean; expiresAt: string }>("/api/session", {
    method: "POST",
    body: JSON.stringify({ passphrase }),
  });

export const signOut = () => request<{ ok: boolean }>("/api/session", { method: "DELETE" });

export const fetchState = () => request<AppState>("/api/state");

export const savePreferences = (patch: Record<string, unknown>) =>
  request<{ ok: boolean; updated: string[]; settings: Settings }>("/api/preferences", {
    method: "PUT",
    body: JSON.stringify(patch),
  });

export const addTransactions = (transactions: Partial<Transaction>[] | Partial<Transaction>) =>
  request<{ ok: boolean; inserted: number; duplicates: number; transactions: Transaction[] }>("/api/transactions", {
    method: "POST",
    body: JSON.stringify(Array.isArray(transactions) ? { transactions } : transactions),
  });

export const updateTransaction = (id: string, patch: { category?: string; tags?: string[]; needsReview?: boolean }) =>
  request<{ ok: boolean; transaction: Transaction }>("/api/transactions", {
    method: "PATCH",
    body: JSON.stringify({ id, ...patch }),
  });

export const removeTransaction = (id: string) =>
  request<{ ok: boolean }>("/api/transactions", {
    method: "DELETE",
    body: JSON.stringify({ id }),
  });

export const uploadDocuments = (files: File[], docType: string) => {
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  form.append("docType", docType);
  return request<{ ok: boolean; stored: any[]; rejected: { name: string; reason: string }[] }>("/api/documents", {
    method: "POST",
    body: form,
  });
};

export const removeDocument = (id: string) => request<{ ok: boolean }>(`/api/documents/${id}`, { method: "DELETE" });

export const addDebt = (debt: Partial<Debt>) =>
  request<{ ok: boolean; debt: Debt }>("/api/debts", { method: "POST", body: JSON.stringify(debt) });

export const updateDebt = (id: string, patch: Partial<Debt>) =>
  request<{ ok: boolean; debt: Debt }>(`/api/debts/${id}`, { method: "PATCH", body: JSON.stringify(patch) });

export const removeDebt = (id: string) => request<{ ok: boolean }>(`/api/debts/${id}`, { method: "DELETE" });

export const wipeAllData = () =>
  request<{ ok: boolean; message: string; deletedObjects: number }>("/api/state", {
    method: "DELETE",
    body: JSON.stringify({ confirm: "DELETE ALL SPENDOS DATA" }),
  });
