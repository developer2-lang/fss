-- ============================================================================
-- IUOVA CASHFLOW TRACKER — Supabase Schema
-- ============================================================================

-- 1. EXTENSIONS
create extension if not exists "uuid-ossp";

-- 2. ENUMS & DOMAINS
do $$ begin
  create type entry_kind as enum ('inflow', 'outflow', 'transfer');
exception
  when duplicate_object then null;
end $$;

-- 3. SETTINGS & APP STATE
create table if not exists app_settings (
  id text primary key default 'iuova_settings',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 4. PARTIES (Clients, Vendors, Employees)
create table if not exists parties (
  id text primary key,
  kind text not null check (kind in ('client', 'vendor', 'employee')),
  name text not null,
  legal_name text,
  gstin text,
  pan text,
  msme text,
  tan text,
  state text,
  city text,
  address text,
  pincode text,
  credit_days int default 30,
  bank_name text,
  bank_acc text,
  bank_ifsc text,
  contacts jsonb default '[]'::jsonb,
  department text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_parties_kind on parties(kind);

-- 5. CASHFLOW ENTRIES
create table if not exists entries (
  id text primary key,
  date date not null,
  type text not null check (type in ('inflow', 'outflow', 'transfer')),
  amount numeric(15,2) not null,
  taxable numeric(15,2) default 0,
  gst_rate numeric(5,2) default 0,
  gst_amount numeric(15,2) default 0,
  tds_section text,
  tds_rate numeric(5,2) default 0,
  tds_amount numeric(15,2) default 0,
  category_id text,
  bucket text,
  party_id text,
  party_name text,
  department text,
  project text,
  invoice_ref text,
  pi_id text,
  order_id text,
  payment_mode text,
  bank_acc text,
  reference_no text,
  narration text,
  attachments jsonb default '[]'::jsonb,
  is_verified boolean default false,
  verified_by text,
  verified_at timestamptz,
  deleted boolean default false,
  deleted_at timestamptz,
  created_by text default 'owner',
  created_at timestamptz default now(),
  updated_by text,
  updated_at timestamptz default now()
);
create index if not exists idx_entries_date on entries(date);
create index if not exists idx_entries_type on entries(type);
create index if not exists idx_entries_party on entries(party_id);
create index if not exists idx_entries_deleted on entries(deleted);

-- 6. RECURRING RULES
create table if not exists recurring_rules (
  id text primary key,
  type text not null check (type in ('inflow', 'outflow', 'transfer')),
  freq text not null check (freq in ('monthly', 'quarterly', 'annual')),
  day_of_month int default 1,
  start_date date not null,
  end_date date,
  amount numeric(15,2) not null,
  category_id text,
  party_id text,
  department text,
  narration text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 7. ORDERS (Client Purchase Orders)
create table if not exists orders (
  id text primary key,
  order_no text not null,
  date date not null,
  party_id text not null,
  amount numeric(15,2) not null,
  taxable numeric(15,2) not null,
  gst_amount numeric(15,2) default 0,
  department text,
  project text,
  status text default 'active',
  expected_delivery date,
  scope_of_work text,
  attachments jsonb default '[]'::jsonb,
  deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_orders_party on orders(party_id);

-- 8. PROFORMA INVOICES (PIs)
create table if not exists proforma_invoices (
  id text primary key,
  pi_no text not null,
  order_id text,
  party_id text not null,
  date date not null,
  due_date date,
  amount numeric(15,2) not null,
  taxable numeric(15,2) not null,
  gst_amount numeric(15,2) default 0,
  status text default 'issued',
  notes text,
  attachments jsonb default '[]'::jsonb,
  deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_pis_party on proforma_invoices(party_id);
create index if not exists idx_pis_order on proforma_invoices(order_id);

-- 9. TARGETS & QUOTAS
create table if not exists targets (
  id text primary key,
  fy text not null,
  quarter text,
  month text,
  scope text default 'company',
  department text,
  target_amount numeric(15,2) not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 10. BANK LINES & IMPORTS
create table if not exists bank_imports (
  id text primary key,
  filename text not null,
  bank_name text,
  account_no text,
  imported_at timestamptz default now(),
  line_count int default 0
);

create table if not exists bank_lines (
  id text primary key,
  import_id text references bank_imports(id) on delete cascade,
  date date not null,
  narration text not null,
  reference_no text,
  cheque_no text,
  type text not null check (type in ('cr', 'dr')),
  amount numeric(15,2) not null,
  balance numeric(15,2),
  status text default 'open',
  matched_entry_id text,
  matched_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_bank_lines_date on bank_lines(date);
create index if not exists idx_bank_lines_status on bank_lines(status);

-- 11. GST & TDS REGISTERS
create table if not exists gst_bills (
  id text primary key,
  party_id text,
  invoice_no text,
  invoice_date date,
  taxable numeric(15,2) default 0,
  igst numeric(15,2) default 0,
  cgst numeric(15,2) default 0,
  sgst numeric(15,2) default 0,
  total numeric(15,2) default 0,
  status text default 'pending',
  period text,
  created_at timestamptz default now()
);

create table if not exists credit_notes (
  id text primary key,
  original_inv_ref text,
  date date not null,
  party_id text,
  taxable numeric(15,2) default 0,
  gst_amount numeric(15,2) default 0,
  reason text,
  created_at timestamptz default now()
);

-- 12. EMAIL OUTBOX
create table if not exists email_outbox (
  id text primary key,
  to_addresses text[] not null,
  cc_addresses text[] default '{}',
  bcc_addresses text[] default '{}',
  subject text not null,
  body text not null,
  status text default 'draft', -- draft, queued, sent, failed
  entity_type text,
  entity_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_email_status on email_outbox(status);

-- 13. AUDIT LOGS
create table if not exists audit_logs (
  id text primary key,
  user_name text not null,
  role text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb default '{}'::jsonb,
  timestamp timestamptz default now()
);
create index if not exists idx_audit_time on audit_logs(timestamp desc);

-- 14. ROW LEVEL SECURITY (RLS) POLICIES
alter table app_settings enable row level security;
alter table parties enable row level security;
alter table entries enable row level security;
alter table recurring_rules enable row level security;
alter table orders enable row level security;
alter table proforma_invoices enable row level security;
alter table targets enable row level security;
alter table bank_imports enable row level security;
alter table bank_lines enable row level security;
alter table gst_bills enable row level security;
alter table credit_notes enable row level security;
alter table email_outbox enable row level security;
alter table audit_logs enable row level security;

-- Open policies for anon/authenticated access (configure perms in Supabase dashboard)
create policy "Allow all actions on app_settings" on app_settings for all using (true) with check (true);
create policy "Allow all actions on parties" on parties for all using (true) with check (true);
create policy "Allow all actions on entries" on entries for all using (true) with check (true);
create policy "Allow all actions on recurring_rules" on recurring_rules for all using (true) with check (true);
create policy "Allow all actions on orders" on orders for all using (true) with check (true);
create policy "Allow all actions on proforma_invoices" on proforma_invoices for all using (true) with check (true);
create policy "Allow all actions on targets" on targets for all using (true) with check (true);
create policy "Allow all actions on bank_imports" on bank_imports for all using (true) with check (true);
create policy "Allow all actions on bank_lines" on bank_lines for all using (true) with check (true);
create policy "Allow all actions on gst_bills" on gst_bills for all using (true) with check (true);
create policy "Allow all actions on credit_notes" on credit_notes for all using (true) with check (true);
create policy "Allow all actions on email_outbox" on email_outbox for all using (true) with check (true);
create policy "Allow all actions on audit_logs" on audit_logs for all using (true) with check (true);

-- 15. FSS CUSTOM TABLES
-- 15.1 fss_departments
create table if not exists fss.fss_departments (
    id bigint generated always as identity primary key,
    department_name varchar(150) not null,
    manager varchar(150),
    manager_email varchar(255),
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

alter table fss.fss_departments enable row level security;
create policy "Allow all actions on fss_departments" on fss.fss_departments for all using (true) with check (true);

-- 15.2 fss_bank_accounts
create table if not exists fss.fss_bank_accounts (
    id bigint generated always as identity primary key,
    account_name varchar(150) not null,
    account_type varchar(50) not null default 'Bank',
    account_number_masked varchar(50),
    opening_balance numeric(15, 2) not null default 0,
    opening_balance_date date not null default '2025-04-01',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table fss.fss_bank_accounts enable row level security;
create policy "Allow all actions on fss_bank_accounts" on fss.fss_bank_accounts for all using (true) with check (true);

-- 15.3 fss_form_tax_statutory
create table if not exists fss.fss_form_tax_statutory (
    id uuid primary key default gen_random_uuid(),
    paying_type text not null check (paying_type in ('GST', 'TDS', 'Professional tax', 'Advance tax')),
    tax_month date not null,
    amount_paid numeric(14,2) not null default 0,
    party text,
    category text,
    department text,
    challan_no text,
    attachment_url text,
    payment_date date not null,
    payment_mode text,
    paid_from text not null,
    utr_cheque_ref text,
    description text,
    notes text,
    repeat_every_cycle boolean default false,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

alter table fss.fss_form_tax_statutory enable row level security;
create policy "Allow all actions on fss_form_tax_statutory" on fss.fss_form_tax_statutory for all using (true) with check (true);

-- 15.4 fss_form_other_expense
create table if not exists fss.fss_form_other_expense (
    id uuid primary key default gen_random_uuid(),
    expense_category text not null,
    paid_to text,
    department text,
    amount_before_gst numeric(14,2) not null default 0,
    gst_rate numeric(5,2) default 0,
    gst_amount numeric(14,2) default 0,
    tds_amount numeric(14,2) default 0,
    net_cash_paid numeric(14,2) default 0,
    payment_date date not null,
    payment_mode text,
    paid_from text not null,
    utr_cheque_ref text,
    attachment_url text,
    description text,
    reference_no text,
    project text,
    gst_type text,
    input_gst_claimable boolean default true,
    notes text,
    repeat_every_cycle boolean default false,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

alter table fss.fss_form_other_expense enable row level security;
create policy "Allow all actions on fss_form_other_expense" on fss.fss_form_other_expense for all using (true) with check (true);

-- 15.5 fss_form_client_payment
create table if not exists fss.fss_form_client_payment (
    id uuid primary key default gen_random_uuid(),
    client_name text not null,
    category text,
    project text,
    department text,
    amount_before_gst numeric(14,2) not null default 0,
    gst_rate numeric(5,2) default 0,
    gst_amount numeric(14,2) default 0,
    tds_rate numeric(5,2) default 0,
    tds_amount numeric(14,2) default 0,
    net_cash_received numeric(14,2) default 0,
    payment_date date not null,
    payment_mode text,
    received_into text not null,
    utr_cheque_ref text,
    attachment_url text,
    description text,
    gst_type text,
    notes text,
    repeat_every_cycle boolean default false,
    email_receipt boolean default false,
    receipt_to text,
    receipt_cc text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

alter table fss.fss_form_client_payment enable row level security;
create policy "Allow all actions on fss_form_client_payment" on fss.fss_form_client_payment for all using (true) with check (true);


