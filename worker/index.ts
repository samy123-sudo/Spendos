import { Hono } from "hono";

/* Minimal structural types so the worker type-checks without Cloudflare type packages. */
type D1Result = { success: boolean; results?: any[]; meta?: { changes?: number } };
type D1Stmt = {
  bind: (...values: any[]) => D1Stmt;
  first: <T = any>(col?: string) => Promise<T | null>;
  all: <T = any>() => Promise<{ results: T[] }>;
  run: () => Promise<D1Result>;
};
type D1 = {
  prepare: (sql: string) => D1Stmt;
  batch: (statements: D1Stmt[]) => Promise<D1Result[]>;
  exec: (sql: string) => Promise<any>;
};
type R2Object = { key: string; size?: number };
type R2 = {
  put: (key: string, value: any, options?: any) => Promise<any>;
  get: (key: string) => Promise<any>;
  delete: (key: string | string[]) => Promise<any>;
  list: (options?: any) => Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>;
};

type Env = {
  DB: D1;
  FILES: R2;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
};

const app = new Hono<{ Bindings: Env }>();

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TRANSACTIONS = 5000;
const MAX_DOCUMENTS = 100;
const WIPE_CONFIRMATION = "DELETE ALL SPENDOS DATA";

/* Security limits. Every one of these is enforced before work is done. */
const MAX_JSON_BYTES = 1 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 42 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 10;
const MAX_STORED_DOCUMENTS = 500;
const MAX_STORED_BYTES = 512 * 1024 * 1024;
const MAX_TAGS = 40;
const DOC_TYPES = ["receipt", "invoice", "statement", "spreadsheet", "image", "contract", "other", "document"];

const DEFAULT_CATEGORY_NAMES = [
  "Groceries",
  "Dining",
  "Transport",
  "Rent",
  "Utilities",
  "Health",
  "Education",
  "Shopping",
  "Entertainment",
  "Travel",
  "Subscriptions",
  "Fees",
  "Gifts",
  "Savings",
  "Uncategorized",
];

const slug = (value: string) =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "item";

const DEFAULT_CATEGORIES = DEFAULT_CATEGORY_NAMES.map((name) => ({ id: slug(name), name }));

const DEFAULT_SETTINGS: Record<string, unknown> = {
  currency: "INR",
  locale: "en-IN",
  household: { name: "Our household", members: [] as string[] },
  categories: DEFAULT_CATEGORIES,
  accounts: [] as any[],
  goals: [] as any[],
  budgets: [] as any[],
  subscriptions: [] as any[],
  recurring: [] as any[],
  dismissedPatterns: [] as string[],
  assets: 0,
  liabilities: 0,
  netWorthConfigured: false,
  selectedPeriod: "this-month",
  freshStart: false,
  driveResetAt: null,
  notifyReview: true,
  note: "",
};

const PERIODS = ["all-time", "this-month", "last-month", "last-3-months", "last-6-months", "this-year"];

/* ------------------------------------------------------------------ schema */

let schemaReady = false;

async function ensureSchema(db: D1) {
  if (schemaReady) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS transactions (
       id TEXT PRIMARY KEY,
       date TEXT NOT NULL,
       merchant TEXT NOT NULL,
       amount REAL NOT NULL,
       type TEXT NOT NULL,
       category TEXT NOT NULL DEFAULT 'Uncategorized',
       account TEXT NOT NULL DEFAULT '',
       note TEXT NOT NULL DEFAULT '',
       tags TEXT NOT NULL DEFAULT '[]',
       source TEXT NOT NULL DEFAULT 'manual',
       fingerprint TEXT NOT NULL UNIQUE,
       needs_review INTEGER NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_fingerprint ON transactions(fingerprint)`,
    `CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name ON tags(name COLLATE NOCASE)`,
    `CREATE TABLE IF NOT EXISTS rules (
       id TEXT PRIMARY KEY,
       match TEXT NOT NULL,
       category TEXT NOT NULL DEFAULT '',
       tags TEXT NOT NULL DEFAULT '[]',
       enabled INTEGER NOT NULL DEFAULT 1,
       created_at TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS documents (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       mime TEXT NOT NULL,
       size INTEGER NOT NULL,
       object_key TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'queued',
       doc_type TEXT NOT NULL DEFAULT 'document',
       drive_file_id TEXT,
       drive_modified_time TEXT,
       note TEXT NOT NULL DEFAULT '',
       uploaded_at TEXT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_documents_uploaded ON documents(uploaded_at DESC)`,
    `CREATE TABLE IF NOT EXISTS debts (
       id TEXT PRIMARY KEY,
       counterparty TEXT NOT NULL,
       direction TEXT NOT NULL,
       amount REAL NOT NULL,
       date TEXT NOT NULL,
       due_date TEXT,
       note TEXT NOT NULL DEFAULT '',
       settled INTEGER NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL
     )`,
  ];
  await db.batch(statements.map((sql) => db.prepare(sql)));

  await db.batch(
    Object.entries(DEFAULT_SETTINGS).map(([key, value]) =>
      db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).bind(key, JSON.stringify(value)),
    ),
  );
  schemaReady = true;
}

function decodeSettings(rows: { key: string; value: string }[]) {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return out;
}

async function readSettings(db: D1) {
  const rows = await db.prepare(`SELECT key, value FROM settings`).all<{ key: string; value: string }>();
  return decodeSettings(rows.results || []);
}

async function writeSetting(db: D1, key: string, value: unknown) {
  await db
    .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(key, JSON.stringify(value))
    .run();
}

/* -------------------------------------------------------------- normalizers */

const asString = (value: unknown, fallback = "") => (typeof value === "string" ? value.trim() : fallback);

const asNumber = (value: unknown, fallback = 0) => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const asBool = (value: unknown, fallback = false) => (typeof value === "boolean" ? value : fallback);

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

const uid = () => crypto.randomUUID();

function normalizeTags(input: unknown, max = MAX_TAGS): string[] {
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const name = asString(raw).replace(/\s+/g, " ");
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name.slice(0, 40));
  }
  return out.slice(0, max);
}

function normalizeCategories(input: unknown) {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const item of input) {
    const name = asString(typeof item === "string" ? item : item?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const id = asString((item as any)?.id) || slug(name);
    out.push({ id, name: name.slice(0, 60) });
  }
  return out.slice(0, 200);
}

function normalizeAccounts(input: unknown) {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const out: any[] = [];
  for (const item of input) {
    const name = asString(typeof item === "string" ? item : item?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: asString((item as any)?.id) || uid(),
      name: name.slice(0, 60),
      type: asString((item as any)?.type, "bank").slice(0, 30) || "bank",
      note: asString((item as any)?.note).slice(0, 200),
    });
  }
  return out.slice(0, 100);
}

function normalizeGoals(input: unknown) {
  if (!Array.isArray(input)) return null;
  return input
    .map((item: any) => {
      const name = asString(item?.name);
      if (!name) return null;
      return {
        id: asString(item?.id) || uid(),
        name: name.slice(0, 80),
        targetAmount: Math.max(0, asNumber(item?.targetAmount)),
        savedAmount: Math.max(0, asNumber(item?.savedAmount)),
        targetDate: isIsoDate(asString(item?.targetDate)) ? asString(item?.targetDate) : "",
        note: asString(item?.note).slice(0, 300),
      };
    })
    .filter(Boolean)
    .slice(0, 100);
}

function normalizeBudgets(input: unknown) {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const out: any[] = [];
  for (const item of input as any[]) {
    const category = asString(item?.category);
    const amount = asNumber(item?.amount);
    if (!category || !(amount > 0)) continue;
    const key = category.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: asString(item?.id) || uid(), category: category.slice(0, 60), amount });
  }
  return out.slice(0, 100);
}

function normalizeSubscriptions(input: unknown) {
  if (!Array.isArray(input)) return null;
  return input
    .map((item: any) => {
      const name = asString(item?.name);
      const amount = asNumber(item?.amount);
      if (!name || !(amount > 0)) return null;
      return {
        id: asString(item?.id) || uid(),
        name: name.slice(0, 80),
        amount,
        cadence: ["monthly", "yearly", "weekly", "quarterly"].includes(asString(item?.cadence))
          ? asString(item?.cadence)
          : "monthly",
        nextDate: isIsoDate(asString(item?.nextDate)) ? asString(item?.nextDate) : "",
        category: asString(item?.category, "Subscriptions") || "Subscriptions",
        account: asString(item?.account),
        active: item?.active === undefined ? true : asBool(item?.active, true),
      };
    })
    .filter(Boolean)
    .slice(0, 100);
}

function normalizeRecurring(input: unknown) {
  if (!Array.isArray(input)) return null;
  return input
    .map((item: any) => {
      const name = asString(item?.name);
      const amount = asNumber(item?.amount);
      if (!name || !(amount > 0)) return null;
      return {
        id: asString(item?.id) || uid(),
        name: name.slice(0, 80),
        amount,
        type: asString(item?.type) === "income" ? "income" : "expense",
        cadence: ["monthly", "yearly", "weekly", "quarterly"].includes(asString(item?.cadence))
          ? asString(item?.cadence)
          : "monthly",
        nextDate: isIsoDate(asString(item?.nextDate)) ? asString(item?.nextDate) : "",
        category: asString(item?.category, "Recurring") || "Recurring",
        account: asString(item?.account),
        confirmed: asBool(item?.confirmed, false),
      };
    })
    .filter(Boolean)
    .slice(0, 100);
}

function normalizeRules(input: unknown) {
  if (!Array.isArray(input)) return null;
  return input
    .map((item: any) => {
      const match = asString(item?.match);
      if (!match) return null;
      return {
        id: asString(item?.id) || uid(),
        match: match.slice(0, 80),
        category: asString(item?.category).slice(0, 60),
        tags: normalizeTags(item?.tags),
        enabled: item?.enabled === undefined ? true : asBool(item?.enabled, true),
        createdAt: asString(item?.createdAt) || new Date().toISOString(),
      };
    })
    .filter(Boolean)
    .slice(0, 300);
}

function normalizeStringList(input: unknown) {
  if (!Array.isArray(input)) return null;
  return normalizeTags(input, 300);
}

/* ---------------------------------------------------------------- utilities */

function fingerprintOf(tx: { date: string; merchant: string; amount: number; account: string }) {
  return (
    tx.date + "|" + tx.merchant.trim().toLowerCase() + "|" + tx.amount.toFixed(2) + "|" + tx.account.trim().toLowerCase()
  );
}

function parseTagsColumn(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((t) => String(t));
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map((t) => String(t)) : [];
  } catch {
    return [];
  }
}

function rowToTransaction(row: any) {
  return {
    id: row.id,
    date: row.date,
    merchant: row.merchant,
    amount: Number(row.amount),
    type: row.type === "income" ? "income" : "expense",
    category: row.category || "Uncategorized",
    account: row.account || "",
    note: row.note || "",
    tags: parseTagsColumn(row.tags),
    source: row.source || "manual",
    needsReview: !!row.needs_review,
    createdAt: row.created_at,
  };
}

function rowToDocument(row: any) {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: Number(row.size),
    status: row.status,
    docType: row.doc_type,
    driveFileId: row.drive_file_id || null,
    driveModifiedTime: row.drive_modified_time || null,
    note: row.note || "",
    uploadedAt: row.uploaded_at,
    fileUrl: `/api/documents/${row.id}/file`,
  };
}

function normalizeDirection(value: unknown) {
  const raw = asString(value);
  if (raw === "i_owe") return "i_owe";
  if (raw === "with_me") return "with_me";
  return "owed_to_me";
}

function rowToDebt(row: any) {
  return {
    id: row.id,
    counterparty: row.counterparty,
    direction: normalizeDirection(row.direction),
    amount: Number(row.amount),
    date: row.date,
    dueDate: row.due_date || "",
    note: row.note || "",
    settled: !!row.settled,
    createdAt: row.created_at,
  };
}

function safeFileName(name: string, fallback = "file") {
  const base = String(name || fallback)
    .replace(/^.*[\\/]/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return (base || fallback).slice(-120);
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/* --------------------------------------------------------------- hardening */

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const SKIP_CSP_HEADER = "x-spendos-skip-csp";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  json: "application/json",
  xml: "application/xml",
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/* Only passive formats are rendered inline; anything that can carry script is a download. */
const INLINE_PREVIEW_EXTENSIONS = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp"]);

function extensionOf(name: unknown) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(String(name ?? ""));
  return match ? match[1].toLowerCase() : "";
}

const contentTypeFor = (name: string) => CONTENT_TYPES[extensionOf(name)] || "application/octet-stream";

function isLocalRequest(request: Request) {
  try {
    return LOCAL_HOSTNAMES.has(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

function contentSecurityPolicy(request: Request) {
  const local = isLocalRequest(request);
  return [
    "default-src 'self'",
    local ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    local ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function pathOf(request: Request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "";
  }
}

function hardenResponse(request: Request, response: Response) {
  const headers = new Headers(response.headers);
  const skipCsp = headers.get(SKIP_CSP_HEADER) === "1";
  headers.delete(SKIP_CSP_HEADER);
  if (!skipCsp && !headers.has("content-security-policy")) {
    headers.set("content-security-policy", contentSecurityPolicy(request));
  }
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set(
    "permissions-policy",
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  );
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive, nosnippet");
  if (pathOf(request).startsWith("/api/")) headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/* Best-effort per-isolate throttling. Coarse, but stops runaway loops and scripted floods. */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (rateBuckets.size > 2000) {
    for (const [bucketKey, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(bucketKey);
    if (rateBuckets.size > 5000) rateBuckets.clear();
  }
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const retry = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    throw new HttpError(429, `Too many requests. Try again in ${retry}s.`);
  }
}

function timingSafeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function clientKey(request: Request) {
  const forwarded = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0].trim() || "local";
}

/* ----------------------------------------------------------- categorization */

function applyRules(tx: { merchant: string; category: string; tags: string[] }, rules: any[]) {
  const merchant = tx.merchant.toLowerCase();
  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue;
    const needle = asString(rule.match).toLowerCase();
    if (!needle || !merchant.includes(needle)) continue;
    if (asString(rule.category)) tx.category = asString(rule.category);
    if (Array.isArray(rule.tags) && rule.tags.length) {
      tx.tags = normalizeTags([...tx.tags, ...rule.tags]);
    }
  }
  return tx;
}

/* ------------------------------------------------------------------ routes */

app.use("*", async (c, next) => {
  await next();
  c.res = hardenResponse(c.req.raw, c.res);
});

app.use("/api/*", async (c, next) => {
  const method = c.req.method.toUpperCase();
  const unsafe = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

  /* No browser page on another origin may drive a state change. */
  if (unsafe) {
    const site = (c.req.header("sec-fetch-site") || "").toLowerCase();
    if (site && site !== "same-origin" && site !== "same-site" && site !== "none") {
      throw new HttpError(403, "Cross-site requests are blocked.");
    }
    const origin = c.req.header("origin");
    if (origin) {
      const self = (() => {
        try {
          return new URL(c.req.url).origin;
        } catch {
          return "";
        }
      })();
      if (!self || origin !== self) throw new HttpError(403, "Cross-site requests are blocked.");
    }
  }

  /* Reject oversized payloads before the body is read into memory. */
  const declared = Number(c.req.header("content-length") || 0);
  const upload = method === "POST" && c.req.path === "/api/documents";
  const bodyLimit = upload ? MAX_UPLOAD_BYTES : MAX_JSON_BYTES;
  if (Number.isFinite(declared) && declared > bodyLimit) {
    throw new HttpError(413, upload ? "That upload is too large." : "That request is too large.");
  }

  const key = clientKey(c.req.raw);
  enforceRateLimit(`${key}:${unsafe ? "write" : "read"}`, unsafe ? 90 : 300, 60_000);
  if (upload) enforceRateLimit(`${key}:upload`, 20, 5 * 60_000);

  await ensureSchema(c.env.DB);
  await next();
});

app.get("/api/health", (c) => c.json({ ok: true, service: "spendos", time: new Date().toISOString() }));

app.get("/api/state", async (c) => {
  const db = c.env.DB;
  const [txRes, tagRes, ruleRes, docRes, debtRes, settings] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM transactions ORDER BY date DESC, created_at DESC LIMIT ${MAX_TRANSACTIONS}`,
      )
      .all<any>(),
    db.prepare(`SELECT id, name, created_at FROM tags ORDER BY name COLLATE NOCASE ASC`).all<any>(),
    db.prepare(`SELECT * FROM rules ORDER BY created_at ASC`).all<any>(),
    db
      .prepare(`SELECT * FROM documents ORDER BY uploaded_at DESC LIMIT ${MAX_DOCUMENTS}`)
      .all<any>(),
    db.prepare(`SELECT * FROM debts ORDER BY created_at DESC`).all<any>(),
    readSettings(db),
  ]);

  return c.json({
    transactions: (txRes.results || []).map(rowToTransaction),
    tags: (tagRes.results || []).map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at })),
    rules: (ruleRes.results || []).map((row) => ({
      id: row.id,
      match: row.match,
      category: row.category,
      tags: parseTagsColumn(row.tags),
      enabled: !!row.enabled,
      createdAt: row.created_at,
    })),
    settings,
    documents: (docRes.results || []).map(rowToDocument),
    debts: (debtRes.results || []).map(rowToDebt),
    meta: {
      generatedAt: new Date().toISOString(),
      transactionLimit: MAX_TRANSACTIONS,
      documentLimit: MAX_DOCUMENTS,
    },
  });
});

app.put("/api/preferences", async (c) => {
  const db = c.env.DB;
  const body = (await c.req.json().catch(() => null)) as Record<string, any> | null;
  if (!body || typeof body !== "object") throw new HttpError(400, "Expected a JSON preferences object.");

  const updated: string[] = [];

  if ("categories" in body) {
    const categories = normalizeCategories(body.categories);
    if (!categories) throw new HttpError(400, "categories must be an array.");
    await writeSetting(db, "categories", categories);
    updated.push("categories");
  }
  if ("accounts" in body) {
    const accounts = normalizeAccounts(body.accounts);
    if (!accounts) throw new HttpError(400, "accounts must be an array.");
    await writeSetting(db, "accounts", accounts);
    updated.push("accounts");
  }
  if ("goals" in body) {
    const goals = normalizeGoals(body.goals);
    if (!goals) throw new HttpError(400, "goals must be an array.");
    await writeSetting(db, "goals", goals);
    updated.push("goals");
  }
  if ("budgets" in body) {
    const budgets = normalizeBudgets(body.budgets);
    if (!budgets) throw new HttpError(400, "budgets must be an array.");
    await writeSetting(db, "budgets", budgets);
    updated.push("budgets");
  }
  if ("subscriptions" in body) {
    const subscriptions = normalizeSubscriptions(body.subscriptions);
    if (!subscriptions) throw new HttpError(400, "subscriptions must be an array.");
    await writeSetting(db, "subscriptions", subscriptions);
    updated.push("subscriptions");
  }
  if ("recurring" in body) {
    const recurring = normalizeRecurring(body.recurring);
    if (!recurring) throw new HttpError(400, "recurring must be an array.");
    await writeSetting(db, "recurring", recurring);
    updated.push("recurring");
  }
  if ("dismissedPatterns" in body) {
    const dismissed = normalizeStringList(body.dismissedPatterns);
    if (!dismissed) throw new HttpError(400, "dismissedPatterns must be an array.");
    await writeSetting(db, "dismissedPatterns", dismissed);
    updated.push("dismissedPatterns");
  }
  if ("rules" in body) {
    const rules = normalizeRules(body.rules);
    if (!rules) throw new HttpError(400, "rules must be an array.");
    await db.prepare(`DELETE FROM rules`).run();
    if (rules.length) {
      await db.batch(
        rules.map((rule: any) =>
          db
            .prepare(
              `INSERT INTO rules (id, match, category, tags, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .bind(rule.id, rule.match, rule.category, JSON.stringify(rule.tags), rule.enabled ? 1 : 0, rule.createdAt),
        ),
      );
    }
    updated.push("rules");
  }
  if ("tags" in body) {
    const names = normalizeStringList(body.tags);
    if (!names) throw new HttpError(400, "tags must be an array.");
    const allTags = await db.prepare(`SELECT name FROM tags`).all<{ name: string }>();
    const existing = new Set((allTags.results || []).map((r) => r.name.toLowerCase()));
    const additions = names.filter((name) => !existing.has(name.toLowerCase()));
    if (additions.length) {
      const now = new Date().toISOString();
      await db.batch(
        additions.map((name) =>
          db
            .prepare(`INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)`)
            .bind(uid(), name, now),
        ),
      );
    }
    updated.push("tags");
  }

  const scalarKeys = ["currency", "locale", "household", "selectedPeriod", "freshStart", "driveResetAt", "notifyReview", "note"];
  for (const key of scalarKeys) {
    if (!(key in body)) continue;
    let value = body[key];
    if (key === "selectedPeriod") {
      const period = asString(value);
      value = PERIODS.includes(period) ? period : "this-month";
    } else if (key === "currency") {
      value = asString(value, "INR").toUpperCase().slice(0, 3) || "INR";
    } else if (key === "freshStart" || key === "notifyReview") {
      value = asBool(value, false);
    } else if (key === "driveResetAt") {
      value = typeof value === "string" && value ? value : null;
    } else if (key === "note") {
      value = asString(value).slice(0, 500);
    } else if (key === "household") {
      const members = Array.isArray((value as any)?.members) ? (value as any).members : [];
      const name = asString((value as any)?.name, "Our household").slice(0, 80) || "Our household";
      const normalizedMembers = members
        .map((m: any) => ({
          id: asString(m?.id) || uid(),
          name: asString(m?.name).slice(0, 60),
          role: asString(m?.role).slice(0, 40) || "viewer",
        }))
        .filter((m: any) => m.name)
        .slice(0, 50);
      value = { name, members: normalizedMembers };
    }
    await writeSetting(db, key, value);
    updated.push(key);
  }

  if ("assets" in body || "liabilities" in body || "netWorthConfigured" in body) {
    if ("assets" in body) await writeSetting(db, "assets", Math.max(0, asNumber(body.assets)));
    if ("liabilities" in body) await writeSetting(db, "liabilities", Math.max(0, asNumber(body.liabilities)));
    if ("netWorthConfigured" in body) await writeSetting(db, "netWorthConfigured", asBool(body.netWorthConfigured, false));
    updated.push("netWorth");
  }

  if (!updated.length) throw new HttpError(400, "No recognized preference groups in the request.");

  const settings = await readSettings(db);
  return c.json({ ok: true, updated, settings });
});

/* ------------------------------------------------------------ transactions */

function normalizeTransactionInput(raw: any) {
  if (!raw || typeof raw !== "object") throw new HttpError(400, "Each transaction must be an object.");
  const merchant = asString(raw.merchant ?? raw.source ?? raw.description);
  if (!merchant) throw new HttpError(400, "A transaction needs a non-empty merchant or source.");
  const date = asString(raw.date);
  if (!isIsoDate(date)) throw new HttpError(400, `Invalid date for "${merchant}" (expected YYYY-MM-DD).`);
  const amount = asNumber(raw.amount, NaN);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, `Amount must be a positive number for "${merchant}".`);
  const type = asString(raw.type).toLowerCase();
  if (type !== "expense" && type !== "income") throw new HttpError(400, `Type must be "expense" or "income" for "${merchant}".`);
  return {
    id: asString(raw.id) || uid(),
    date,
    merchant: merchant.slice(0, 160),
    amount: Math.round(amount * 100) / 100,
    type: type as "expense" | "income",
    category: asString(raw.category, "Uncategorized").slice(0, 60) || "Uncategorized",
    account: asString(raw.account).slice(0, 60),
    note: asString(raw.note).slice(0, 500),
    tags: normalizeTags(raw.tags),
    source: asString(raw.source, "manual").slice(0, 40) || "manual",
    needsReview: asBool(raw.needsReview, false),
  };
}

app.post("/api/transactions", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => null);
  if (!body) throw new HttpError(400, "Expected a JSON body.");

  const batch = Array.isArray(body) ? body : Array.isArray(body.transactions) ? body.transactions : [body];
  if (!batch.length) throw new HttpError(400, "No transactions supplied.");
  if (batch.length > 2000) throw new HttpError(400, "Send at most 2000 transactions per request.");

  const normalized: any[] = [];
  for (const raw of batch) normalized.push(normalizeTransactionInput(raw));

  // Deduplicate inside the request itself using the fingerprint.
  const seen = new Set<string>();
  const unique: any[] = [];
  let duplicateCount = 0;
  for (const tx of normalized) {
    const fingerprint = fingerprintOf(tx);
    if (seen.has(fingerprint)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(fingerprint);
    unique.push({ ...tx, fingerprint });
  }

  // Pre-check existing fingerprints so rules never resurrect a duplicate.
  const existing = new Set<string>();
  const fingerprints = unique.map((tx) => tx.fingerprint);
  for (let i = 0; i < fingerprints.length; i += 80) {
    const chunk = fingerprints.slice(i, i + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const found = await db
      .prepare(`SELECT fingerprint FROM transactions WHERE fingerprint IN (${placeholders})`)
      .bind(...chunk)
      .all<{ fingerprint: string }>();
    for (const row of found.results || []) existing.add(row.fingerprint);
  }

  const ruleRows = await db.prepare(`SELECT * FROM rules WHERE enabled = 1 ORDER BY created_at ASC`).all<any>();
  const rules = (ruleRows.results || []).map((row) => ({
    match: row.match,
    category: row.category,
    tags: parseTagsColumn(row.tags),
    enabled: !!row.enabled,
  }));

  const now = new Date().toISOString();
  const toInsert: any[] = [];
  for (const tx of unique) {
    if (existing.has(tx.fingerprint)) {
      duplicateCount += 1;
      continue;
    }
    applyRules(tx, rules);
    toInsert.push(tx);
  }

  if (!toInsert.length) {
    return c.json({ ok: true, inserted: 0, duplicates: duplicateCount, transactions: [] });
  }

  const results = await db.batch(
    toInsert.map((tx) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO transactions
            (id, date, merchant, amount, type, category, account, note, tags, source, fingerprint, needs_review, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          tx.id,
          tx.date,
          tx.merchant,
          tx.amount,
          tx.type,
          tx.category,
          tx.account,
          tx.note,
          JSON.stringify(tx.tags),
          tx.source,
          tx.fingerprint,
          tx.needsReview ? 1 : 0,
          now,
        ),
    ),
  );

  const inserted: any[] = [];
  results.forEach((result, index) => {
    if (result?.meta?.changes) inserted.push(rowToTransaction({ ...toInsert[index], created_at: now, needs_review: toInsert[index].needsReview ? 1 : 0 }));
  });
  duplicateCount += toInsert.length - inserted.length;

  if (toInsert.some((tx) => tx.tags.length)) {
    const names = normalizeTags(toInsert.flatMap((tx) => tx.tags));
    if (names.length) {
      await db.batch(
        names.map((name) =>
          db.prepare(`INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)`).bind(uid(), name, now),
        ),
      );
    }
  }

  return c.json(
    {
      ok: true,
      inserted: inserted.length,
      duplicates: duplicateCount,
      transactions: inserted,
    },
    201,
  );
});

app.patch("/api/transactions", async (c) => {
  const db = c.env.DB;
  const body = (await c.req.json().catch(() => null)) as any;
  if (!body || typeof body !== "object") throw new HttpError(400, "Expected a JSON body.");
  const id = asString(body.id ?? c.req.query("id"));
  if (!id) throw new HttpError(400, "A transaction id is required.");
  if (!("category" in body) && !("tags" in body) && !("needsReview" in body)) {
    throw new HttpError(400, "Nothing to update: supply category, tags or needsReview.");
  }

  const existing = await db.prepare(`SELECT * FROM transactions WHERE id = ?`).bind(id).first<any>();
  if (!existing) throw new HttpError(404, "Transaction not found.");

  let category = existing.category;
  let tags = parseTagsColumn(existing.tags);
  let needsReview = existing.needs_review;

  if ("category" in body) {
    category = asString(body.category, "Uncategorized").slice(0, 60) || "Uncategorized";
  }
  if ("tags" in body) {
    tags = normalizeTags(body.tags);
  }
  if ("needsReview" in body) {
    needsReview = asBool(body.needsReview, false) ? 1 : 0;
  }

  await db
    .prepare(`UPDATE transactions SET category = ?, tags = ?, needs_review = ? WHERE id = ?`)
    .bind(category, JSON.stringify(tags), needsReview, id)
    .run();

  if (tags.length) {
    const now = new Date().toISOString();
    await db.batch(
      tags.map((name) =>
        db.prepare(`INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)`).bind(uid(), name, now),
      ),
    );
  }

  const saved = await db.prepare(`SELECT * FROM transactions WHERE id = ?`).bind(id).first<any>();
  return c.json({ ok: true, transaction: rowToTransaction(saved) });
});

app.delete("/api/transactions", async (c) => {
  const db = c.env.DB;
  const body = (await c.req.json().catch(() => null)) as any;
  const id = asString(body?.id ?? c.req.query("id"));
  if (!id) throw new HttpError(400, "A transaction id is required.");
  const result = await db.prepare(`DELETE FROM transactions WHERE id = ?`).bind(id).run();
  if (!result.meta?.changes) throw new HttpError(404, "Transaction not found.");
  return c.json({ ok: true, deleted: id });
});

/* --------------------------------------------------------------- documents */

const SUPPORTED_EXTENSIONS =
  /\.(pdf|png|jpe?g|gif|webp|heic|svg|txt|csv|tsv|xlsx?|docx?|pptx?|json|xml|eml|msg)$/i;

app.post("/api/documents", async (c) => {
  const db = c.env.DB;
  const bucket = c.env.FILES;
  const form = await c.req.formData().catch(() => null);
  if (!form) throw new HttpError(400, "Expected a multipart form upload.");
  const entries = form.getAll("files").filter((entry) => typeof entry !== "string") as File[];
  const single = form.get("file");
  if (single && typeof single !== "string") entries.push(single as File);
  if (!entries.length) throw new HttpError(400, "Attach at least one file.");
  if (entries.length > MAX_FILES_PER_UPLOAD) {
    throw new HttpError(413, `Upload at most ${MAX_FILES_PER_UPLOAD} files at a time.`);
  }

  const rawDocType = asString(form.get("docType"), "document");
  const docType = DOC_TYPES.includes(rawDocType) ? rawDocType : "other";
  const driveFileId = asString(form.get("driveFileId")).slice(0, 120);
  const driveModifiedTime = asString(form.get("driveModifiedTime")).slice(0, 40);

  const usage = await db
    .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(size), 0) AS bytes FROM documents`)
    .first<{ total: number; bytes: number }>();
  const existingCount = Number(usage?.total || 0);
  const existingBytes = Number(usage?.bytes || 0);
  const incomingBytes = entries.reduce((sum, file) => sum + (file.size || 0), 0);
  if (existingCount + entries.length > MAX_STORED_DOCUMENTS) {
    throw new HttpError(429, `Storage is full: the limit is ${MAX_STORED_DOCUMENTS} documents.`);
  }
  if (existingBytes + incomingBytes > MAX_STORED_BYTES) {
    throw new HttpError(429, "Storage is full: delete a few documents before uploading more.");
  }

  const stored: any[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const file of entries) {
    const name = safeFileName(file.name || "file");
    if (!SUPPORTED_EXTENSIONS.test(name)) {
      rejected.push({ name: file.name, reason: "Unsupported file type." });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      rejected.push({ name: file.name, reason: "Files must be 20 MB or smaller." });
      continue;
    }
    if (file.size === 0) {
      rejected.push({ name: file.name, reason: "The file is empty." });
      continue;
    }

    const id = uid();
    const objectKey = driveFileId
      ? `drive-inbox/${safeFileName(driveFileId)}-${name}`
      : `uploads/${id}-${name}`;

    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO documents (id, name, mime, size, object_key, status, doc_type, drive_file_id, drive_modified_time, note, uploaded_at)
         VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, '', ?)`,
      )
      .bind(id, name, contentTypeFor(name), file.size, objectKey, docType, driveFileId || null, driveModifiedTime || null, now)
      .run();

    try {
      await bucket.put(objectKey, await file.arrayBuffer(), {
        httpMetadata: { contentType: contentTypeFor(name) },
        customMetadata: {
          documentId: id,
          originalName: name,
          docType,
          ...(driveFileId ? { driveFileId } : {}),
          ...(driveModifiedTime ? { driveModifiedTime } : {}),
        },
      });
      await db.prepare(`UPDATE documents SET status = 'stored' WHERE id = ?`).bind(id).run();
    } catch {
      await db.prepare(`DELETE FROM documents WHERE id = ?`).bind(id).run();
      rejected.push({ name: file.name, reason: "Storage failed, please retry." });
      continue;
    }

    const row = await db.prepare(`SELECT * FROM documents WHERE id = ?`).bind(id).first<any>();
    if (row) stored.push(rowToDocument(row));
  }

  if (!stored.length) {
    return c.json({ ok: false, error: rejected[0]?.reason || "No files stored.", rejected }, 400);
  }

  return c.json({ ok: true, stored, rejected, maxFileBytes: MAX_FILE_BYTES }, 201);
});

app.get("/api/documents/:id/file", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const row = await db.prepare(`SELECT * FROM documents WHERE id = ?`).bind(id).first<any>();
  if (!row) throw new HttpError(404, "Document not found.");
  const object = await c.env.FILES.get(row.object_key);
  if (!object) throw new HttpError(404, "The stored file is no longer available.");

  /* Type comes from the validated extension, never from the uploader's header. */
  const extension = extensionOf(row.name);
  const inline = INLINE_PREVIEW_EXTENSIONS.has(extension);
  const headers = new Headers();
  headers.set("Content-Type", inline ? contentTypeFor(row.name) : "application/octet-stream");
  headers.set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${safeFileName(row.name)}"`);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  if (inline) {
    /* Passive documents render for preview without any document-level policy. */
    headers.set(SKIP_CSP_HEADER, "1");
  } else {
    /* Active formats (svg, xml, html-ish) are inert even if a browser renders them. */
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  }
  return new Response(object.body, { headers });
});

app.delete("/api/documents/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const row = await db.prepare(`SELECT * FROM documents WHERE id = ?`).bind(id).first<any>();
  if (!row) throw new HttpError(404, "Document not found.");
  await c.env.FILES.delete(row.object_key);
  await db.prepare(`DELETE FROM documents WHERE id = ?`).bind(id).run();
  return c.json({ ok: true, deleted: id });
});

/* ------------------------------------------------------------------- debts */

function normalizeDebtInput(raw: any) {
  const counterparty = asString(raw?.counterparty);
  if (!counterparty) throw new HttpError(400, "A name is required.");
  const amount = asNumber(raw?.amount, NaN);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Amount must be a positive number.");
  const date = asString(raw?.date);
  if (!isIsoDate(date)) throw new HttpError(400, "A valid date is required.");
  const direction = normalizeDirection(raw?.direction);
  return {
    id: asString(raw?.id) || uid(),
    counterparty: counterparty.slice(0, 80),
    direction,
    amount: Math.round(amount * 100) / 100,
    date,
    dueDate: isIsoDate(asString(raw?.dueDate)) ? asString(raw?.dueDate) : null,
    note: asString(raw?.note).slice(0, 300),
    settled: asBool(raw?.settled, false),
  };
}

app.post("/api/debts", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => null);
  if (!body) throw new HttpError(400, "Expected a JSON body.");
  const debt = normalizeDebtInput(body);
  await db
    .prepare(
      `INSERT INTO debts (id, counterparty, direction, amount, date, due_date, note, settled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(debt.id, debt.counterparty, debt.direction, debt.amount, debt.date, debt.dueDate, debt.note, debt.settled ? 1 : 0, new Date().toISOString())
    .run();
  const row = await db.prepare(`SELECT * FROM debts WHERE id = ?`).bind(debt.id).first<any>();
  return c.json({ ok: true, debt: rowToDebt(row) }, 201);
});

app.patch("/api/debts/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as any;
  if (!body) throw new HttpError(400, "Expected a JSON body.");
  const existing = await db.prepare(`SELECT * FROM debts WHERE id = ?`).bind(id).first<any>();
  if (!existing) throw new HttpError(404, "Debt not found.");
  const merged = normalizeDebtInput({ ...rowToDebt(existing), ...body, id });
  await db
    .prepare(`UPDATE debts SET counterparty = ?, direction = ?, amount = ?, date = ?, due_date = ?, note = ?, settled = ? WHERE id = ?`)
    .bind(merged.counterparty, merged.direction, merged.amount, merged.date, merged.dueDate, merged.note, merged.settled ? 1 : 0, id)
    .run();
  const row = await db.prepare(`SELECT * FROM debts WHERE id = ?`).bind(id).first<any>();
  return c.json({ ok: true, debt: rowToDebt(row) });
});

app.delete("/api/debts/:id", async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(`DELETE FROM debts WHERE id = ?`).bind(c.req.param("id")).run();
  if (!result.meta?.changes) throw new HttpError(404, "Debt not found.");
  return c.json({ ok: true });
});

/* ------------------------------------------------------------- full wipe */

app.delete("/api/state", async (c) => {
  const db = c.env.DB;
  const body = (await c.req.json().catch(() => null)) as any;
  if (!body || !timingSafeEqual(asString(body.confirm), WIPE_CONFIRMATION)) {
    throw new HttpError(400, `Send {"confirm": "${WIPE_CONFIRMATION}"} to wipe all data.`);
  }

  await db.batch([
    db.prepare(`DELETE FROM transactions`),
    db.prepare(`DELETE FROM documents`),
    db.prepare(`DELETE FROM rules`),
    db.prepare(`DELETE FROM tags`),
    db.prepare(`DELETE FROM debts`),
    db.prepare(`DELETE FROM settings`),
  ]);

  let deletedObjects = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await c.env.FILES.list({ limit: 500, cursor });
    const keys = (page.objects || []).map((object: R2Object) => object.key);
    if (keys.length) {
      await c.env.FILES.delete(keys);
      deletedObjects += keys.length;
    }
    if (!page.truncated) break;
    cursor = page.cursor;
    if (!cursor) break;
  }

  const resetAt = new Date().toISOString();
  const fresh: Record<string, unknown> = {
    ...DEFAULT_SETTINGS,
    selectedPeriod: "all-time",
    freshStart: true,
    driveResetAt: resetAt,
    assets: 0,
    liabilities: 0,
    netWorthConfigured: false,
  };
  await db.batch(
    Object.entries(fresh).map(([key, value]) =>
      db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).bind(key, JSON.stringify(value)),
    ),
  );

  return c.json({
    ok: true,
    message: "All Spendos data on this Site was deleted. Settings were reset to a clean state.",
    deletedObjects,
    driveResetAt: resetAt,
    freshStart: true,
    selectedPeriod: "all-time",
  });
});

/* ------------------------------------------------------------------ errors */

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return hardenResponse(c.req.raw, c.json({ ok: false, error: error.message }, error.status as any));
  }
  console.error("Unhandled API error", error);
  return hardenResponse(c.req.raw, c.json({ ok: false, error: "Something went wrong. Please try again." }, 500));
});

app.all("/api/*", (c) => c.json({ ok: false, error: "Unknown API route." }, 404));

app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;