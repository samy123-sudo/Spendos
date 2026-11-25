export type TxType = "expense" | "income";

export interface Transaction {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  type: TxType;
  category: string;
  account: string;
  note: string;
  tags: string[];
  source: string;
  needsReview: boolean;
  createdAt: string;
}

export interface TagRow {
  id: string;
  name: string;
  createdAt: string;
}

export interface Rule {
  id: string;
  match: string;
  category: string;
  tags: string[];
  enabled: boolean;
  createdAt: string;
}

export interface DocumentMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  status: "queued" | "stored" | "review";
  docType: string;
  driveFileId: string | null;
  driveModifiedTime: string | null;
  note: string;
  uploadedAt: string;
  fileUrl: string;
}

export interface Debt {
  id: string;
  counterparty: string;
  direction: "owed_to_me" | "i_owe" | "with_me";
  amount: number;
  date: string;
  dueDate: string;
  note: string;
  settled: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface AccountDef {
  id: string;
  name: string;
  type: string;
  note: string;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  targetDate: string;
  note: string;
}

export interface Budget {
  id: string;
  category: string;
  amount: number;
}

export type Cadence = "monthly" | "yearly" | "weekly" | "quarterly";

export interface Subscription {
  id: string;
  name: string;
  amount: number;
  cadence: Cadence;
  nextDate: string;
  category: string;
  account: string;
  active: boolean;
}

export interface RecurringEntry {
  id: string;
  name: string;
  amount: number;
  type: TxType;
  cadence: Cadence;
  nextDate: string;
  category: string;
  account: string;
  confirmed: boolean;
}

export interface HouseholdMember {
  id: string;
  name: string;
  role: string;
}

export interface Settings {
  currency: string;
  locale: string;
  household: { name: string; members: HouseholdMember[] };
  categories: Category[];
  accounts: AccountDef[];
  goals: Goal[];
  budgets: Budget[];
  subscriptions: Subscription[];
  recurring: RecurringEntry[];
  dismissedPatterns: string[];
  assets: number;
  liabilities: number;
  netWorthConfigured: boolean;
  selectedPeriod: string;
  freshStart: boolean;
  driveResetAt: string | null;
  notifyReview: boolean;
  note: string;
}

export interface AppState {
  transactions: Transaction[];
  tags: TagRow[];
  rules: Rule[];
  settings: Settings;
  documents: DocumentMeta[];
  debts: Debt[];
  meta: { generatedAt: string; transactionLimit: number; documentLimit: number };
}
