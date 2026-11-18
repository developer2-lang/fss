// IUOVA Cashflow TypeScript Interfaces

export type EntryType = 'inflow' | 'outflow' | 'transfer';
export type UserRole = 'owner' | 'accountant' | 'manager';
export type PartyKind = 'client' | 'vendor' | 'employee' | 'other';
export type GstType = 'intra' | 'inter' | 'none';
export type OrderType = 'PO' | 'LOI' | 'Email' | 'Contract';
export type OrderStatus = 'active' | 'closed' | 'cancelled';
export type PIStatus = 'issued' | 'cancelled';
export type EmailStatus = 'draft' | 'queued' | 'sent' | 'failed' | 'cancelled' | 'mailapp';

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
}

export interface Entry {
  id: string;
  type: EntryType;
  date: string;
  categoryId?: string;
  departmentId?: string;
  partyKind?: PartyKind;
  partyId?: string;
  projectId?: string;
  description?: string;
  refNo?: string;
  taxable?: number;
  gstType?: GstType;
  gstRate?: number;
  gstAmount?: number;
  itc?: boolean;
  tdsRate?: number;
  tdsAmount?: number;
  tdsSection?: string;
  amount: number; // Net cash
  paymentMode?: string;
  accountId?: string;
  toAccountId?: string; // For transfers
  txnRef?: string;
  notes?: string;
  attachments?: Attachment[];
  recurringId?: string;
  recurringPeriod?: string;
  piId?: string;
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
  deleted?: boolean;
  deletedBy?: string;
  deletedAt?: string;
  supabase_id?: string | null;
}

export interface Account {
  id: string;
  name: string;
  type: 'bank' | 'cash' | 'fd';
  number?: string;
  openingBalance: number;
  active: boolean;
}

export interface Department {
  id: string;
  name: string;
  active: boolean;
  managerName?: string;
  managerEmail?: string;
}

export interface Category {
  id: string;
  type: 'inflow' | 'outflow';
  bucket?: string;
  group: string;
  name: string;
  partyKind?: PartyKind;
  kind: 'operating' | 'tax' | 'capex' | 'financing';
  active: boolean;
  sac?: string;
  itcBlocked?: boolean;
  tdsSection?: string;
  supabase_id?: number | string | null;
  createdAt?: string;
}

export interface PartyContact {
  name: string;
  email: string;
  phone?: string;
  tag?: 'accounts' | 'projects' | 'management';
}

export interface Party {
  id: string;
  kind: PartyKind;
  name: string;
  gstin?: string;
  gstType?: GstType;
  departmentId?: string;
  designation?: string;
  monthlySalary?: number;
  joinDate?: string;
  email?: string;
  phone?: string;
  active: boolean;
  pan?: string;
  msme?: string;
  tan?: string;
  state?: string;
  city?: string;
  address?: string;
  pincode?: string;
  creditDays?: number;
  bankName?: string;
  bankAcc?: string;
  bankIfsc?: string;
  contacts?: PartyContact[];
  tdsSection?: string;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  clientId: string;
  departmentId: string;
  contractValue?: number;
  startDate?: string;
  status: 'active' | 'completed' | 'on_hold';
  active: boolean;
}

export interface Recurring {
  id: string;
  name: string;
  type: EntryType;
  categoryId?: string;
  departmentId?: string;
  partyId?: string;
  projectId?: string;
  description?: string;
  taxable: number;
  gstType?: GstType;
  gstRate?: number;
  tdsRate?: number;
  itc?: boolean;
  paymentMode?: string;
  accountId?: string;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  dayOfMonth: number;
  startDate: string;
  endDate?: string;
  active: boolean;
  skipped?: string[];
  variable?: boolean;
}

export interface Order {
  id: string;
  orderNo: string;
  type: OrderType;
  date: string;
  clientId: string;
  projectId?: string;
  departmentId?: string;
  split?: Array<{ departmentId: string; pct: number; amount?: number; department_name?: string }>;
  scope?: string;
  taxable: number;
  gstRate?: number;
  gstType?: GstType;
  gstAmount?: number;
  total: number;
  terms?: Array<{ label: string; pct: number; amount?: number; milestone_name?: string }>;
  expectedCompletion?: string;
  contact?: string;
  notes?: string;
  attachments?: Attachment[];
  status: OrderStatus;
  amendments?: Array<{ date: string; by: string; from: any; to: any; note: string }>;
  deleted?: boolean;
  supabase_id?: string | null;
  createdAt?: string;
  updatedAt?: string;
  clientName?: string;
  projectName?: string;
}

export interface PI {
  id: string;
  piNo: string;
  date: string;
  dueDate?: string;
  orderId?: string;
  clientId: string;
  projectId?: string;
  milestone?: string;
  taxable: number;
  gstRate?: number;
  gstType?: GstType;
  gstAmount?: number;
  tdsRate?: number;
  tdsAmount?: number;
  total: number;
  taxInvoiceNo?: string;
  notes?: string;
  attachments?: Attachment[];
  status: PIStatus;
  deleted?: boolean;
}

export interface BankLine {
  id: string;
  importId: string;
  date: string;
  narration: string;
  ref?: string;
  type: 'cr' | 'dr';
  amount: number;
  balance?: number;
  status: 'open' | 'matched' | 'ignored';
  matchedId?: string;
}

export interface EmailOutbox {
  id: string;
  kind: string;
  entity: 'entries' | 'pis';
  entityId: string;
  partyId?: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  attachments?: Attachment[];
  status: EmailStatus;
  sentAt?: string;
  error?: string;
  deleted?: boolean;
}

export interface AuditLog {
  id: string;
  ts: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
  changes?: Array<{ field: string; from: any; to: any }>;
}

export interface AppSettings {
  company: string;
  gstin?: string;
  state?: string;
  openingDate: string;
  currentUserId: string;
  lockedMonths: string[];
  email?: {
    from: string;
    cc: string[];
    autoTick: boolean;
    templates: Record<string, { subject: string; body: string }>;
  };
  reminders?: any;
  digest?: any;
  gst?: any;
  compliance?: any;
  bankMaps?: Record<string, string>;
  bankRules?: any[];
  udyamNo?: string;
}

export interface StoreData {
  settings: AppSettings;
  users: Array<{ id: string; name: string; role: UserRole; avatar: string; email?: string }>;
  accounts: Account[];
  departments: Department[];
  categories: Category[];
  parties: Party[];
  projects: Project[];
  entries: Entry[];
  recurring: Recurring[];
  orders: Order[];
  pis: PI[];
  targets: Record<string, Record<string, number[]>>;
  creditNotes: any[];
  gstBills: any[];
  gst2b: any[];
  gstMonths: Record<string, any>;
  tdsMonths: Record<string, any>;
  tdsQuarters: Record<string, any>;
  tds26: any[];
  tdsCerts: any[];
  tdsOutCerts: any[];
  bankLines: BankLine[];
  bankImports: any[];
  compliance: any[];
  emails: EmailOutbox[];
  audit: AuditLog[];
  meta: {
    schemaVersion: number;
    testData?: boolean;
    createdAt?: string;
  };
}
