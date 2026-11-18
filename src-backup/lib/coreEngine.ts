// @ts-nocheck
import { SupabaseService } from './supabase';

/* ==========================================================================
   IUOVA CASHFLOW TRACKER — v2.0  (single-file prototype)
   --------------------------------------------------------------------------
   PURPOSE   Cash-basis cashflow tracker for IUOVA Design Company.
             Two users (Owner, Accountant). INR only. Indian FY (Apr–Mar).
   STORAGE   Prototype only: localStorage key 'iuova-cashflow-v2' (all records)
             + IndexedDB 'iuova-cashflow-files' (attachment blobs).

   BACKEND HANDOFF (for the dev team)
     Every read/write goes through the `api` object and `FileStore` below.
     Reads are served from an in-memory cache (Store.data); writes are async.
     To integrate a backend:
       1. On boot, hydrate Store.data from the GET endpoints (replace Store.load).
       2. Replace the bodies of api.create / api.update / api.softDelete /
          api.restore / api.purge / api.setLock / api.saveSettings and
          FileStore.put / get / del with HTTP calls. Keep the same signatures.
       3. Re-implement permission checks (api.can), month-lock checks
          (api.isLocked), entry validation (api.validateEntry) and audit
          logging (api.log) on the server — the client copies are UX only.
       4. Remove buildSeed() and the Reset/Clear buttons (Settings › Data).

   SUGGESTED REST ENDPOINTS
     GET    /api/entries ?from&to&type&categoryId&departmentId&partyId&projectId&accountId&mode&q&deleted
     POST   /api/entries                      PATCH /api/entries/:id
     POST   /api/entries/:id/delete (soft)    POST  /api/entries/:id/restore     DELETE /api/entries/:id (purge)
     POST   /api/attachments (multipart) → {id,name,type,size}    GET/DELETE /api/attachments/:id
     CRUD   /api/accounts  /api/departments  /api/categories  /api/parties  /api/projects  /api/recurring
     POST   /api/recurring/:id/skip {period}  POST /api/recurring/:id/unskip {period}
     GET    /api/audit ?userId&action&entity&from&to&q
     GET    /api/settings   PATCH /api/settings   POST /api/settings/locks {month:'YYYY-MM', locked:bool}
     CRUD   /api/orders  /api/pis      POST /api/orders/:id/status {status}   POST /api/pis/:id/status {status}
     GET/PUT /api/targets/:fy          GET /api/scorecards/:departmentId?month=YYYY-MM (manager: own dept only)
     GET/POST /api/emails ?status&kind&partyId   PATCH /api/emails/:id {status}   (backend worker sends queued mail)
     GET    /api/me

   DATA MODEL  (money = INR numbers, dates 'YYYY-MM-DD', timestamps ISO-8601)
     Entry {
       id, type:'inflow'|'outflow'|'transfer', date,
       categoryId, departmentId,
       partyKind:'client'|'vendor'|'employee'|'other', partyId, projectId,
       description, refNo            // invoice no. (inflow) / bill no. (outflow)
       taxable,                      // base value before GST
       gstType:'intra'|'inter'|'none', gstRate, gstAmount,
       itc,                          // outflow: input GST claimable (bool)
       tdsRate, tdsAmount,           // inflow: TDS deducted by client; outflow: TDS deducted by IUOVA
       amount,                       // NET CASH = taxable + gstAmount − tdsAmount (transfer: amount moved)
       paymentMode, accountId, toAccountId (transfer only), txnRef (UTR / cheque / UPI ref),
       notes, attachments:[{id,name,type,size}],
       recurringId, recurringPeriod ('YYYY-MM' of the cycle it settles), piId (receipt settles this PI),
       createdBy, createdAt, updatedBy, updatedAt, deleted, deletedBy, deletedAt }
     Account    { id, name, type:'bank'|'cash'|'fd', number, openingBalance, active }  // opening as of settings.openingDate
     Department { id, name, active }
     Category   { id, type:'inflow'|'outflow', bucket (see BUCKETS), group, name, partyKind, kind:'operating'|'tax'|'capex'|'financing', active }
                // Hierarchy for summary views: bucket → group → category
     Party      { id, kind, name, gstin, gstType, departmentId, designation, monthlySalary, joinDate, email, phone, active }
     Project    { id, code, name, clientId, departmentId, contractValue (taxable), startDate, status, active }
     Recurring  { id, name, type, categoryId, departmentId, partyId, projectId, description, taxable, gstType,
                  gstRate, tdsRate, itc, paymentMode, accountId, frequency:'monthly'|'quarterly'|'yearly',
                  dayOfMonth, startDate, endDate, active, skipped:['YYYY-MM'],
                  variable (bool: amount changes each cycle — pre-fill last actual, forecast on 3-cycle average) }
     Order      { id, orderNo, type:'PO'|'LOI'|'Email'|'Contract', date, clientId, projectId, departmentId,
                  split:[{departmentId,pct}] (optional; revenue credit), scope, taxable, gstRate, gstType, gstAmount, total,
                  terms:[{label,pct}], expectedCompletion, contact, notes, attachments, status:'active'|'closed'|'cancelled',
                  amendments:[{date,by,from,to,note}] }   // Open / Partly / Fully invoiced is derived from its PIs
     PI         { id, piNo, date, dueDate, orderId, clientId, projectId, milestone, taxable, gstRate, gstType, gstAmount,
                  tdsRate, tdsAmount (expected), total, taxInvoiceNo, notes, attachments, status:'issued'|'cancelled' }
                  // Paid / Part-paid derived from inflow entries with entry.piId === pi.id (taxable + GST settled)
     Targets    { [fyStartYear]: { [departmentId]: number[12] } }   // monthly revenue target, Apr..Mar, on PIs issued (pre-GST)
     Department { …, managerName, managerEmail }   // a named manager gets a scorecard-only login (role 'manager')
     Email      { id, kind:'vendor_payment'|'client_receipt'|'pi_issued', entity:'entries'|'pis', entityId, partyId, from, to[], cc[],
                  subject, body, attachments:[{id,name,type,size}], status:'queued'|'sent'|'failed'|'cancelled'|'mailapp',
                  sentAt, error, events:[{ts,status,by,note}] }
                  // BACKEND: a worker sends every 'queued' email from settings.email.from (accounts@iuova.in) with its
                  // attachments (blobs via /api/attachments/:id), then PATCHes status 'sent' (sentAt) or 'failed' (error).
     Settings.email { from, cc[], autoTick, templates:{ vendor_payment|client_receipt|pi_issued: {subject, body} } }  // {placeholders}
     AuditLog   { id, ts, userId, action, entity, entityId, summary, changes:[{field,from,to}] }
     Settings   { company, gstin, state, openingDate, currentUserId, lockedMonths:['YYYY-MM'] }

   BUSINESS RULES
     • Cash basis: record an entry on the date money actually moved.
     • Net cash (amount) drives every balance, chart and report; GST/TDS are tracked alongside.
     • Transfers move money between own accounts and never count as inflow or outflow.
     • Recurring templates create "due" items; nothing hits cashflow until a user confirms it.
     • Locked months reject create / edit / delete for every role until the Owner unlocks.
     • Deletes are soft (Trash). Only the Owner can delete, restore or purge.
     • Every write is recorded in the audit log with field-level changes.
   ========================================================================== */

/* ----------------------------- utilities ----------------------------- */
const pad2 = n => String(n).padStart(2, '0');
function isoDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
const TODAY = isoDate(new Date());
const nowISO = () => new Date().toISOString();
const ymOf = d => d.slice(0, 7);
function daysInMonth(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function ymDate(ym, day) { return ym + '-' + pad2(Math.min(day, daysInMonth(ym))); }
function addMonths(ym, n) { let [y, m] = ym.split('-').map(Number); let t = y * 12 + (m - 1) + n; return Math.floor(t / 12) + '-' + pad2(t % 12 + 1); }
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDate(d); }
function diffDays(a, b) { return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000); }
function fyOf(iso) { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); return m >= 4 ? y : y - 1; }
function fyLabel(y) { return 'FY ' + y + '-' + pad2((y + 1) % 100); }
function fyMonths(y) { return Array.from({ length: 12 }, (_, i) => addMonths(y + '-04', i)); }
function fyRange(y) { return [y + '-04-01', (y + 1) + '-03-31']; }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthLabel(ym, long) { const [y, m] = ym.split('-'); return long ? MONTH_LONG[+m - 1] + ' ' + y : MON[+m - 1] + ' ' + y.slice(2); }
function fmtDate(iso) { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return d + ' ' + MON[+m - 1] + ' ' + y; }
function fmtDateTime(ts) { if (!ts) return '—'; const d = new Date(ts); return fmtDate(isoDate(d)) + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = n => Math.round((+n || 0) * 100) / 100;
function money(n, opts = {}) {
  if (n == null || n === '' || isNaN(n)) return '—';
  const v = r2(n), a = Math.abs(v);
  const s = Number.isInteger(a) ? nf0.format(a) : nf2.format(a);
  return (v < 0 ? '−' : (opts.sign && v > 0 ? '+' : '')) + '₹' + s;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p = 'id') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sum = (arr, f = x => x) => arr.reduce((s, x) => s + (+f(x) || 0), 0);
const Hooks = { notify: () => {} };

/* ----------------------------- constants ----------------------------- */
const PAYMENT_MODES = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash', 'Card', 'Auto-debit', 'SWIFT'];
const GST_RATES = [0, 5, 12, 18, 28];
const TDS_RATES = [0, 1, 2, 5, 10, 15, 20, 30];
const GST_TYPES = { intra: 'CGST + SGST', inter: 'IGST', none: 'No GST' };
const PARTY_KINDS = { client: 'Client', vendor: 'Vendor', employee: 'Employee', other: 'Other (Bank / Govt / Owner)' };
const PARTY_KINDS_SHORT = { client: 'Client', vendor: 'Vendor', employee: 'Employee', other: 'Other' };
const TYPE_LABEL = { inflow: 'Inflow', outflow: 'Outflow', transfer: 'Transfer' };
const ACCOUNT_TYPES = { bank: 'Bank', cash: 'Cash', fd: 'Fixed deposit' };
const CAT_KINDS = { operating: 'Operating', tax: 'Statutory / Tax', capex: 'Capex', financing: 'Financing / Owner' };
const FREQ = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
const FREQ_STEP = { monthly: 1, quarterly: 3, yearly: 12 };
const ENTITY_LABEL = { emails: 'Email', orders: 'Order', pis: 'PI', targets: 'Targets', entries: 'Entry', parties: 'Party', projects: 'Project', recurring: 'Recurring', accounts: 'Bank account', departments: 'Department', categories: 'Category', settings: 'Settings', bankLines: 'Bank line', bankImports: 'Bank statement', tds26: '26AS record', tdsCerts: 'TDS certificate', compliance: 'Compliance', creditNotes: 'Credit note', gstBills: 'Purchase bill', gst2b: 'GSTR-2B', gstMonths: 'GST month', tdsMonths: 'TDS month', tdsOutCerts: 'TDS certificate (issued)' };
const ROLES = { owner: 'Owner', accountant: 'Accountant', manager: 'Dept. manager' };
const ORDER_TYPES = { PO: 'Purchase order', LOI: 'Letter of intent', Email: 'Email confirmation', Contract: 'Signed contract' };
const ORDER_STATUS = { open: 'Open', partly: 'Partly invoiced', full: 'Fully invoiced', closed: 'Closed', cancelled: 'Cancelled' };
const PI_STATUS = { issued: 'Issued', part: 'Part-paid', paid: 'Paid', cancelled: 'Cancelled' };
const METRICS = { booked: 'Orders booked', billed: 'PIs issued', collected: 'Collected' };
const ACCOUNTANT_ALLOWED = new Set(['gst.edit', 'gst.send', 'gst.confirm', 'tdsp.edit', 'tdsp.send', 'tdsp.confirm', 'bank.import', 'bank.match', 'compliance.mark', 'tds.edit', 'email.queue', 'email.status', 'order.create', 'order.edit', 'pi.create', 'pi.edit', 'entry.create', 'entry.edit', 'recurring.confirm', 'recurring.skip', 'recurring.create', 'recurring.edit', 'party.create', 'party.edit', 'project.create', 'project.edit']);

const DEFAULT_DEPARTMENTS = [['dep_design', 'Design'], ['dep_eng', 'Engineering'], ['dep_sales', 'Sales & BD'], ['dep_ops', 'Operations / Admin'], ['dep_hr', 'HR'], ['dep_fin', 'Finance'], ['dep_mgmt', 'Management'], ['dep_unalloc', 'Unallocated']];
// [id, type, group, name, partyKind, kind]
/** GST defaults per category: [SAC for sales, ITC blocked]. Confirm SAC codes with your CA. */
/** Default TDS section per expense category (editable in Masters). */
const CAT_TDS = { cat_sal: '192', cat_ceo: '192', cat_bonus: '192', cat_rent: '194I', cat_free: '194J', cat_ca: '194J', cat_legal: '194J', cat_test: '194J', cat_proto: '194C', cat_vserv: '194C', cat_print: '194C', cat_house: '194C', cat_repair: '194C', cat_furn: '194C' };
const CAT_GST = { cat_rdesign: ['998391'], cat_retain: ['998391'], cat_consult: ['998393'], cat_reng: ['998333'], cat_welfare: ['', true] };
const DEFAULT_CATEGORIES = [
  ['cat_sal', 'outflow', 'People', 'Salaries', 'employee', 'operating'],
  ['cat_ceo', 'outflow', 'People', 'CEO Fixed Salary', 'employee', 'operating'],
  ['cat_bonus', 'outflow', 'People', 'Bonus & Incentives', 'employee', 'operating'],
  ['cat_welfare', 'outflow', 'People', 'Staff Welfare', 'vendor', 'operating'],
  ['cat_rent', 'outflow', 'Office – Fixed', 'Office Rent', 'vendor', 'operating'],
  ['cat_elec', 'outflow', 'Office – Fixed', 'Electricity', 'vendor', 'operating'],
  ['cat_net', 'outflow', 'Office – Fixed', 'Internet & Phone', 'vendor', 'operating'],
  ['cat_soft', 'outflow', 'Office – Fixed', 'Software Subscriptions', 'vendor', 'operating'],
  ['cat_house', 'outflow', 'Office – Fixed', 'Housekeeping & Security', 'vendor', 'operating'],
  ['cat_ptax', 'outflow', 'Office – Fixed', 'Professional Tax', 'other', 'operating'],
  ['cat_supplies', 'outflow', 'Office – Variable', 'Office Supplies & Pantry', 'vendor', 'operating'],
  ['cat_print', 'outflow', 'Office – Variable', 'Printing & Courier', 'vendor', 'operating'],
  ['cat_repair', 'outflow', 'Office – Variable', 'Repairs & Maintenance', 'vendor', 'operating'],
  ['cat_travel', 'outflow', 'Travel', 'Travel & Conveyance', 'vendor', 'operating'],
  ['cat_reimb', 'outflow', 'Travel', 'Employee Reimbursements', 'employee', 'operating'],
  ['cat_free', 'outflow', 'Project Costs', 'Freelancers & Consultants', 'vendor', 'operating'],
  ['cat_proto', 'outflow', 'Project Costs', 'Prototyping & Materials', 'vendor', 'operating'],
  ['cat_vserv', 'outflow', 'Project Costs', 'Vendor Services (Project)', 'vendor', 'operating'],
  ['cat_test', 'outflow', 'Project Costs', 'Testing & Certification', 'vendor', 'operating'],
  ['cat_ca', 'outflow', 'Professional & Admin', 'CA, Audit & Accounting', 'vendor', 'operating'],
  ['cat_legal', 'outflow', 'Professional & Admin', 'Legal & Compliance', 'vendor', 'operating'],
  ['cat_bank', 'outflow', 'Professional & Admin', 'Bank Charges', 'other', 'operating'],
  ['cat_equip', 'outflow', 'Capex / Purchases', 'Equipment & Hardware', 'vendor', 'capex'],
  ['cat_lic', 'outflow', 'Capex / Purchases', 'Software Licences (Perpetual)', 'vendor', 'capex'],
  ['cat_furn', 'outflow', 'Capex / Purchases', 'Furniture & Fit-out', 'vendor', 'capex'],
  ['cat_gstpay', 'outflow', 'Statutory & Tax', 'GST Paid to Govt', 'other', 'tax'],
  ['cat_tdsdep', 'outflow', 'Statutory & Tax', 'TDS Deposited', 'other', 'tax'],
  ['cat_advtax', 'outflow', 'Statutory & Tax', 'Advance Tax', 'other', 'tax'],
  ['cat_emi', 'outflow', 'Financing & Owner', 'Loan EMI', 'other', 'financing'],
  ['cat_draw', 'outflow', 'Financing & Owner', 'Owner Drawings', 'other', 'financing'],
  ['cat_rdesign', 'inflow', 'Operating Receipts', 'Project Receipts – Design', 'client', 'operating'],
  ['cat_reng', 'inflow', 'Operating Receipts', 'Project Receipts – Engineering', 'client', 'operating'],
  ['cat_consult', 'inflow', 'Operating Receipts', 'Consulting Fees', 'client', 'operating'],
  ['cat_retain', 'inflow', 'Operating Receipts', 'Retainers', 'client', 'operating'],
  ['cat_fdint', 'inflow', 'Other Income', 'FD / Bank Interest', 'other', 'operating'],
  ['cat_othinc', 'inflow', 'Other Income', 'Other Income', 'other', 'operating'],
  ['cat_capital', 'inflow', 'Financing', 'Capital Infusion / Funding', 'other', 'financing'],
  ['cat_loanin', 'inflow', 'Financing', 'Loan Received', 'other', 'financing'],
];

/* High-level buckets used for summary views. Categories carry an optional `bucket`
   field; when absent it is derived from group/kind (see bucketOf). */
const BUCKETS = {
  inflow: [['op_rec', 'Operating receipts'], ['oth_inc', 'Other income'], ['fin_in', 'Financing']],
  outflow: [['op_cost', 'Operating costs'], ['proj_cost', 'Project costs'], ['tax', 'Tax & statutory'], ['capex', 'Capex'], ['fin_out', 'Financing & owner']],
};
const BUCKET_LABEL = Object.fromEntries([...BUCKETS.inflow, ...BUCKETS.outflow]);
function bucketOf(c) {
  if (!c) return '';
  if (c.bucket) {
    const norm = {
      'operating costs (outflow)': 'op_cost',
      'project costs (outflow)': 'proj_cost',
      'tax & statutory (outflow)': 'tax',
      'capex (outflow)': 'capex',
      'financing & owner (outflow)': 'fin_out',
      'operating receipts (inflow)': 'op_rec',
      'other income (inflow)': 'oth_inc',
      'financing (inflow)': 'fin_in'
    }[String(c.bucket).toLowerCase().trim()];
    if (norm) return norm;
    return c.bucket;
  }
  if (c.type === 'inflow') return c.kind === 'financing' ? 'fin_in' : c.group === 'Other Income' ? 'oth_inc' : 'op_rec';
  if (c.group === 'Project Costs') return 'proj_cost';
  return { tax: 'tax', capex: 'capex', financing: 'fin_out' }[c.kind] || 'op_cost';
}

/* ----------------------------- email (outbox) ----------------------------- */
/* The prototype only QUEUES emails. The backend picks up status 'queued' records, sends them from
   settings.email.from with the listed attachments, and sets status 'sent' / 'failed' (+ sentAt / error). */
const EMAIL_KINDS = { vendor_payment: 'Payment advice to vendor', client_receipt: 'Payment received – client', pi_issued: 'Proforma invoice to client', pi_reminder: 'PI payment reminder', statement: 'Statement of account', tds_request: 'TDS certificate request', digest: 'Weekly digest (owner)', gst_pack: 'Monthly GST working to CA', tds_pack: 'Monthly TDS working to CA', tds_return: 'Quarterly TDS return pack to CA', tds_cert: 'Form 16A / 16 to deductee' };
const EMAIL_STATUS = { queued: 'Queued', sent: 'Sent', failed: 'Failed', cancelled: 'Cancelled', mailapp: 'Opened in mail app' };
const EMAIL_VARS = { party: 'Client / vendor name', payee_bank: 'Vendor bank account paid into', date: 'Payment / PI date', ref: 'Bill / invoice no. (or description)', taxable: 'Value before GST', gst: 'GST', tds: 'TDS', net: 'Net amount paid / received', gross: 'Value incl. GST', mode: 'Payment mode', utr: 'Txn ref / UTR', project: 'Project', description: 'Description', pi_no: 'PI number', pi_total: 'PI total incl. GST', pi_balance: 'Balance due on the PI', milestone: 'Milestone', order_no: 'Order no.', due_date: 'PI due date', total: 'PI total', expected_net: 'PI total less expected TDS', company: 'Company name', status_line: 'Reminder: "is due on …" / "is due today" / "is N days overdue"', subject_prefix: 'Reminder subject start: Reminder / Due today / Overdue', days_overdue: 'Days past due', msme_line: 'MSME (Udyam) payment clause, if Udyam no. is set', statement_table: 'Table of open PIs', total_due: 'Total outstanding', tds_table: 'Receipts with TDS for the quarter', quarter: 'TDS quarter, e.g. Q2 FY 2026-27', tds_gap: 'TDS deducted but not in 26AS', month: 'GST month, e.g. September 2026', gst_summary: 'GSTR-3B summary table', gst_checks: 'Open points for the CA', tds_summary: 'TDS section-wise table', tds_checks: 'TDS open points for the CA', form: 'Form 16A or Form 16', fy: 'Financial year, e.g. FY 2026-27' };
const DEFAULT_EMAIL_TEMPLATES = {
  vendor_payment: { subject: 'Payment advice – {company} – {ref}', body: 'Dear {party},\n\nWe have made a payment of {net} on {date} towards {ref}.\n\nBill value (before GST): {taxable}\nGST: {gst}\nTDS deducted: {tds}\nNet paid: {net}\nMode: {mode} · Reference / UTR: {utr}\nPaid to: {payee_bank}\n\nTDS deducted will reflect against your PAN in Form 26AS once our quarterly return is filed.\n\nRegards,\nAccounts · {company}\naccounts@iuova.in' },
  client_receipt: { subject: 'Payment received – {ref} – thank you', body: 'Dear {party},\n\nThank you. We have received {net} on {date} via {mode} (reference {utr}) against {ref} for {project}.\n\nInvoice value (incl. GST): {gross}\nTDS deducted by you: {tds}\nAmount received: {net}\nBalance due on this invoice: {pi_balance}\n\nKindly share the TDS certificate (Form 16A) for this deduction when available.\n\nRegards,\nAccounts · {company}\naccounts@iuova.in' },
  pi_reminder: { subject: '{subject_prefix}: PI {pi_no} – {pi_balance}', body: 'Dear {party},\n\nThis is a reminder that our proforma invoice {pi_no} dated {date} for {milestone} ({project}) {status_line}.\n\nBalance due: {pi_balance}\nDue date: {due_date}\n\n{msme_line}Please share the remittance details with accounts@iuova.in once paid. If you have already paid, kindly ignore this reminder.\n\nRegards,\nAccounts · {company}' },
  statement: { subject: 'Statement of account – {company} – {total_due} outstanding', body: 'Dear {party},\n\nPlease find below the statement of open proforma invoices as of {date}.\n\n{statement_table}\n\nTotal outstanding: {total_due}\n\n{msme_line}Kindly arrange payment of the overdue amounts and share remittance details with accounts@iuova.in.\n\nRegards,\nAccounts · {company}' },
  tds_request: { subject: 'TDS certificate (Form 16A) request – {quarter}', body: 'Dear {party},\n\nWe have received the following payments from you in {quarter}, on which TDS was deducted:\n\n{tds_table}\n\n{tds_gap}Kindly share Form 16A for this quarter and ensure the TDS is reported against our PAN so that it reflects in our Form 26AS.\n\nRegards,\nAccounts · {company}' },
  gst_pack: { subject: 'GST working – {month} – {company}', body: 'Dear Sir / Madam,\n\nPlease find attached our GST working for {month} (sales register, purchase register, SAC summary and GSTR-3B computation).\n\n{gst_summary}\n\n{gst_checks}Kindly review and confirm, or let us know of any changes, so we can file GSTR-1 and GSTR-3B.\n\nRegards,\nAccounts · {company}' },
  tds_pack: { subject: 'TDS working – {month} – {company}', body: 'Dear Sir / Madam,\n\nPlease find attached our TDS working for {month} (deductions register, section-wise summary, challans and deductee-wise totals).\n\n{tds_summary}\n\n{tds_checks}Kindly review and confirm the challan amounts.\n\nRegards,\nAccounts · {company}' },
  tds_return: { subject: 'TDS returns 24Q / 26Q – {quarter} – {company}', body: 'Dear Sir / Madam,\n\nPlease find attached the deductee-wise details and challans for {quarter} to prepare our TDS returns (24Q and 26Q).\n\n{tds_summary}\n\n{tds_checks}Kindly share the token numbers once filed, and the Form 16A / Form 16 files from TRACES.\n\nRegards,\nAccounts · {company}' },
  tds_cert: { subject: '{form} – {quarter} – {company}', body: 'Dear {party},\n\nPlease find attached {form} for {quarter} for tax deducted at source by {company}.\n\nTDS deducted: {tds}\n\nThe credit should reflect in your Form 26AS. Do let us know if anything does not match.\n\nRegards,\nAccounts · {company}' },
  pi_issued: { subject: 'Proforma invoice {pi_no} – {project}', body: 'Dear {party},\n\nPlease find attached proforma invoice {pi_no} dated {date} for {milestone} under order {order_no} ({project}).\n\nValue before GST: {taxable}\nGST: {gst}\nTotal: {total}\nPayment due by: {due_date}\n\nKindly arrange payment by the due date and share the remittance details with accounts@iuova.in.\n\nRegards,\nAccounts · {company}' },
};
function defaultEmailSettings() { return { from: 'accounts@iuova.in', cc: [], autoTick: true, templates: JSON.parse(JSON.stringify(DEFAULT_EMAIL_TEMPLATES)) }; }
/** Scheduled jobs (PI reminders, weekly digest). The prototype runs them when the app opens and hourly;
    BACKEND: run the same functions from a server cron (every hour, Asia/Kolkata) so they fire with no browser open. */
const AUTOMATIONS = [];
async function runAutomations() { for (const fn of AUTOMATIONS) { try { await fn(); } catch (e) { console.warn('automation failed', e); } } }
function featureSettings() {
  const s = Store.data.settings;
  const fill = (k, def) => { if (!s[k] || typeof s[k] !== 'object') s[k] = {}; for (const [kk, vv] of Object.entries(def)) if (s[k][kk] === undefined) s[k][kk] = JSON.parse(JSON.stringify(vv)); };
  fill('reminders', { enabled: true, offsets: [-3, 0, 7, 15], repeatDays: 15, maxReminders: 8, escalateAfter: 15, pausedClients: [] });
  fill('digest', { enabled: true, weekday: 1, hour: 9, to: [], lastWeek: '' });
  fill('gst', { caName: 'CA', caEmails: ['accounts@iuova.in'], invPrefix: 'INV/', cnPrefix: 'CN/', lut: '', openingCredit: { igst: 0, cgst: 0, sgst: 0 } });
  fill('compliance', { gstFreq: 'monthly', ptMonthly: true, advTaxEstimate: 0, items: { tds: true, gstr1: true, gstr3b: true, pt: true, adv: true, tdsret: true, f16a: true, gstr9: true, itr: true } });
  if (!s.bankMaps) s.bankMaps = {}; if (!s.bankRules) s.bankRules = [];
  if (s.udyamNo === undefined) s.udyamNo = '';
  ['bankLines', 'bankImports', 'tds26', 'tdsCerts', 'creditNotes', 'gstBills', 'gst2b'].forEach(k => { if (!Store.data[k]) Store.data[k] = []; });
  if (!Store.data.gstMonths) Store.data.gstMonths = {};
  ['tdsMonths', 'tdsQuarters'].forEach(k => { if (!Store.data[k]) Store.data[k] = {}; }); if (!Store.data.tdsOutCerts) Store.data.tdsOutCerts = [];
  (Store.data.categories || []).forEach(c => { if (c.tdsSection === undefined) c.tdsSection = CAT_TDS[c.id] || ''; });
  (Store.data.categories || []).forEach(c => { if (c.sac === undefined) c.sac = CAT_GST[c.id] ? CAT_GST[c.id][0] : ''; if (c.itcBlocked === undefined) c.itcBlocked = !!(CAT_GST[c.id] && CAT_GST[c.id][1]); });
  if (!Store.data.compliance) Store.data.compliance = {};
  return s;
}
/** Which month a statutory payment belongs to: explicit taxPeriod, else "for <Month YYYY>" in the description, else the previous month. */
function taxPeriodOf(e) {
  if (e.taxPeriod) return e.taxPeriod;
  const m = String(e.description || '').match(/for (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})/);
  if (m) return m[2] + '-' + pad2(MONTH_LONG.indexOf(m[1]) + 1);
  return addMonths(ymOf(e.date), -1);
}
const FY_Q = q => ['Q1 Apr–Jun', 'Q2 Jul–Sep', 'Q3 Oct–Dec', 'Q4 Jan–Mar'][q];
const quarterOf = date => { const m = +date.slice(5, 7); return m >= 4 && m <= 6 ? 0 : m >= 7 && m <= 9 ? 1 : m >= 10 ? 2 : 3; };
const quarterMonths = (fy, q) => fyMonths(fy).slice(q * 3, q * 3 + 3);
function emailSettings() { const s = Store.data.settings; if (!s.email) s.email = defaultEmailSettings(); return s.email; }
const splitEmails = str => String(str || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
/* ---- party contacts & company details ---- */
const CONTACT_TAGS = { accounts: 'Accounts', projects: 'Projects', management: 'Management' };
const CONTACT_TAG_HINT = { accounts: 'To: on payment advices, receipts and PIs', projects: 'CC: on PIs and receipts', management: 'CC: on PIs' };
const HOME_STATE = '27';
const IN_STATES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other territory', '99': 'Outside India (export / import)' };
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
function gstinInfo(g) { g = String(g || '').trim().toUpperCase(); if (!g) return null; return { valid: GSTIN_RE.test(g), stateCode: IN_STATES[g.slice(0, 2)] ? g.slice(0, 2) : '', pan: g.length >= 12 ? g.slice(2, 12) : '' }; }
/** GST type that follows from the party's state: same state = CGST+SGST, other state = IGST, outside India = none. */
const gstTypeForState = code => !code ? null : code === '99' ? 'none' : code === HOME_STATE ? 'intra' : 'inter';
/** Ensure the contacts structure exists (older records stored a comma list in p.email). */
function normalizeParty(p) {
  if (!p || p.kind === 'employee' || p.kind === 'other') return p;
  if (!Array.isArray(p.contacts)) {
    const em = splitEmails(p.email);
    p.contacts = em.length ? em.map((x, i) => ({ id: 'ct' + i + Math.random().toString(36).slice(2, 6), name: '', designation: '', email: x, phone: i === 0 ? (p.phone || '') : '', whatsapp: false, tags: i === 0 ? ['accounts'] : ['projects'] })) : (p.phone ? [{ id: 'ct0', name: '', designation: '', email: '', phone: p.phone, whatsapp: false, tags: ['accounts'] }] : []);
  }
  if (p.bank === undefined) p.bank = null;
  if (p.creditDays === undefined) p.creditDays = p.kind === 'client' ? 30 : null;
  if (p.stateCode === undefined) { const gi = gstinInfo(p.gstin); p.stateCode = gi ? gi.stateCode : ''; }
  if (p.pan === undefined) { const gi = gstinInfo(p.gstin); p.pan = gi ? gi.pan : ''; }
  return p;
}
const partyContacts = p => (p && Array.isArray(p.contacts)) ? p.contacts : [];
const contactLabel = c => c.name ? c.name + (c.designation ? ' (' + c.designation + ')' : '') : (c.email || c.phone || 'Contact');
function partyEmails(p) { if (!p) return []; const cs = partyContacts(p).map(c => c.email).filter(Boolean); return [...new Set([...cs, ...(p.contacts ? [] : splitEmails(p.email))])]; }
/** Who an automatic email goes to: Accounts-tagged people in To; Projects / Management in CC per email kind. */
function emailRoute(p, kind) {
  const cs = partyContacts(p).filter(c => c.email && validEmail(c.email));
  let to = cs.filter(c => (c.tags || []).includes('accounts')).map(c => c.email);
  if (!to.length) to = cs.slice(0, 1).map(c => c.email);
  if (!to.length) to = splitEmails(p && p.email).slice(0, 1);
  const ccTags = kind === 'pi_issued' ? ['projects', 'management'] : ['client_receipt', 'pi_reminder', 'statement'].includes(kind) ? ['projects'] : [];
  const cc = cs.filter(c => (c.tags || []).some(t => ccTags.includes(t)) && !to.includes(c.email)).map(c => c.email);
  return { to: [...new Set(to)], cc: [...new Set(cc)] };
}
const maskAcc = n => { n = String(n || '').replace(/\s/g, ''); return n.length > 4 ? '••' + n.slice(-4) : n; };
function bankLine(p, full) { const b = p && p.bank; if (!b || !(b.accNo || b.upi)) return ''; return [b.bankName, b.accNo ? 'A/c ' + (full ? b.accNo : maskAcc(b.accNo)) : '', b.ifsc ? 'IFSC ' + b.ifsc : '', b.upi ? 'UPI ' + b.upi : ''].filter(Boolean).join(' · '); }
function fillTemplate(t, vars) { return String(t || '').replace(/\{(\w+)\}/g, (m, k) => vars[k] != null && vars[k] !== '' ? vars[k] : (/_line$|^tds_gap$|^gst_checks$/.test(k) && k in vars ? '' : k in EMAIL_VARS ? '—' : m)); }
/** Which email (if any) an entry can trigger. */
function entryEmailKind(e) { if (!e || e.type === 'transfer') return null; const p = api.get('parties', e.partyId); if (!p) return null; if (e.type === 'outflow' && p.kind === 'vendor') return 'vendor_payment'; if (e.type === 'inflow' && p.kind === 'client') return 'client_receipt'; return null; }
function entryEmailVars(e) {
  const p = api.get('parties', e.partyId) || {}, pi = e.piId ? api.get('pis', e.piId) : null, gross = (+e.taxable || 0) + (+e.gstAmount || 0);
  const net = e.type === 'transfer' ? +e.amount : r2(gross - (+e.tdsAmount || 0));
  let bal = '';
  if (pi) { const st = Sales.piState(pi); const already = e.id && st.entries.some(x => x.id === e.id); bal = money(Math.max(0, st.outstanding - (already ? 0 : gross))); }
  return { payee_bank: bankLine(p) || '—', party: p.name || '', date: fmtDate(e.date), ref: e.refNo || (pi ? pi.piNo : '') || e.description || '—', taxable: money(+e.taxable || 0), gst: money(+e.gstAmount || 0), tds: money(+e.tdsAmount || 0), net: money(net), gross: money(gross), mode: e.paymentMode || '', utr: e.txnRef || '—', project: nameOf('projects', e.projectId) || '—', description: e.description || '', pi_no: pi ? pi.piNo : '', pi_total: pi ? money(pi.total) : '', pi_balance: bal || '—', company: Store.data.settings.company };
}
function piEmailVars(pi) {
  const o = api.get('orders', pi.orderId) || {}, p = api.get('parties', pi.clientId) || {};
  const total = (+pi.taxable || 0) + (+pi.gstAmount || 0);
  return { party: p.name || '', date: fmtDate(pi.date), pi_no: pi.piNo, ref: pi.piNo, taxable: money(+pi.taxable || 0), gst: money(+pi.gstAmount || 0), total: money(total), gross: money(total), tds: money(+pi.tdsAmount || 0), expected_net: money(total - (+pi.tdsAmount || 0)), due_date: fmtDate(pi.dueDate), milestone: pi.milestone || '—', order_no: o.orderNo || '—', project: nameOf('projects', pi.projectId || o.projectId) || '—', company: Store.data.settings.company };
}
function mailtoHref(m) { return 'mailto:' + m.to.map(encodeURIComponent).join(',') + '?' + [m.cc && m.cc.length ? 'cc=' + m.cc.map(encodeURIComponent).join(',') : '', 'subject=' + encodeURIComponent(m.subject), 'body=' + encodeURIComponent(m.body + (m.attachments && m.attachments.length ? '\n\n[Attachments: ' + m.attachments.map(a => a.name).join(', ') + ']' : ''))].filter(Boolean).join('&'); }

/* ----------------------------- storage ----------------------------- */
const DB_KEY = 'iuova-cashflow-v2';
let STORAGE_OK = true;
const Store = {
  data: null,
  load() {
    try { const raw = localStorage.getItem(DB_KEY); if (raw) { this.data = JSON.parse(raw); return true; } }
    catch (e) { STORAGE_OK = false; }
    return false;
  },
  persist() {
    if (!STORAGE_OK) return;
    try { 
      localStorage.setItem(DB_KEY, JSON.stringify(this.data)); 
      if (typeof window !== 'undefined' && window.__onCashflowDataChanged) {
        window.__onCashflowDataChanged(this.data);
      }
    }
    catch (e) { STORAGE_OK = false; Hooks.notify('Browser storage is full or blocked. Changes are kept only until this tab closes.', 'error'); }
  },
  bytes() { try { return (localStorage.getItem(DB_KEY) || '').length * 2; } catch (e) { return 0; } },
};

const FileStore = {
  db: null, mem: new Map(), tried: false,
  async open() {
    if (this.db || this.tried) return this.db;
    this.tried = true;
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('iuova-cashflow-files', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' });
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    } catch (e) { this.db = null; }
    return this.db;
  },
  _req(mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction('files', mode); const r = fn(t.objectStore('files'));
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
    });
  },
  async put(rec) { if (!await this.open()) { this.mem.set(rec.id, rec); return; } return this._req('readwrite', s => s.put(rec)); },
  async get(id) { if (!await this.open()) return this.mem.get(id); return this._req('readonly', s => s.get(id)); },
  async del(id) { if (!await this.open()) { this.mem.delete(id); return; } return this._req('readwrite', s => s.delete(id)); },
  async clear() { if (!await this.open()) { this.mem.clear(); return; } return this._req('readwrite', s => s.clear()); },
  async count() { if (!await this.open()) return this.mem.size; return this._req('readonly', s => s.count()); },
};

/* ----------------------------- calc helpers ----------------------------- */
function entryNet(e) {
  if (e.type === 'transfer') return r2(e.amount);
  return r2((+e.taxable || 0) + (+e.gstAmount || 0) - (+e.tdsAmount || 0));
}

/** Periods of a recurring template whose due date is <= until. */
function recurringPeriods(r, until) {
  const out = []; const step = FREQ_STEP[r.frequency] || 1;
  let ym = ymOf(r.startDate);
  for (let i = 0; i < 400; i++) {
    const due = ymDate(ym, r.dayOfMonth);
    if (due > until || (r.endDate && due > r.endDate)) break;
    if (due >= r.startDate) out.push({ period: ym, dueDate: due });
    ym = addMonths(ym, step);
  }
  return out;
}

/* ----------------------------- API layer ----------------------------- */
const PREFIX = { creditNotes: 'cn', gstBills: 'gb', gst2b: 'g2b', bankLines: 'bl', bankImports: 'bi', tds26: 't26', tdsCerts: 'tc', emails: 'em', orders: 'or', pis: 'pi', entries: 'e', parties: 'p', projects: 'pr', recurring: 'rc', accounts: 'acc', departments: 'dep', categories: 'cat' };
const META_KEYS = new Set(['id', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'deleted', 'deletedBy', 'deletedAt']);

function nameOf(col, id) { const r = id && (Store.data[col] || []).find(x => x.id === id); return r ? (r.piNo || r.orderNo || (r.code ? r.code + ' · ' + r.name : r.name)) : ''; }
function displayValue(field, v) {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.map(x => x && x.name ? x.name : x).join(', ') || '—';
  if (/Id$/.test(field)) {
    const col = { categoryId: 'categories', departmentId: 'departments', partyId: 'parties', projectId: 'projects', accountId: 'accounts', toAccountId: 'accounts', clientId: 'parties', recurringId: 'recurring', orderId: 'orders', piId: 'pis' }[field];
    return col ? (nameOf(col, v) || v) : v;
  }
  if (typeof v === 'number' && /amount|taxable|balance|salary|value/i.test(field)) return money(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}
function describe(col, r) {
  if (col === 'entries') {
    if (r.type === 'transfer') return `Transfer ${money(r.amount)} · ${nameOf('accounts', r.accountId)} → ${nameOf('accounts', r.toAccountId)}`;
    return `${TYPE_LABEL[r.type]} ${money(r.amount)} · ${nameOf('categories', r.categoryId)} · ${nameOf('parties', r.partyId) || nameOf('projects', r.projectId)}`;
  }
  if (col === 'emails') return `${EMAIL_KINDS[r.kind] || 'Email'} → ${(r.to || []).join(', ')}`;
  if (col === 'orders') return `Order ${r.orderNo} · ${nameOf('parties', r.clientId)} · ${money(r.taxable)}`;
  if (col === 'pis') return `PI ${r.piNo} · ${nameOf('parties', r.clientId)} · ${money(r.total)}`;
  return `${ENTITY_LABEL[col] || col}: ${r.code ? r.code + ' · ' : ''}${r.name || r.id}`;
}
function diffRecords(before, after) {
  const changes = [];
  for (const k of Object.keys(after)) {
    if (META_KEYS.has(k)) continue;
    const a = before[k], b = after[k];
    const sa = JSON.stringify(a ?? null), sb = JSON.stringify(b ?? null);
    if (sa !== sb) changes.push({ field: k, from: displayValue(k, a), to: displayValue(k, b) });
  }
  return changes;
}

const api = {
  /** Base users plus one Manager login per department that has a manager named (prototype only). */
  users() {
    const d = Store.data;
    return [...d.users, ...d.departments.filter(x => x.managerName && x.active && !x.deleted).map(x => ({ id: 'u_mgr_' + x.id, name: x.managerName, role: 'manager', departmentId: x.id }))];
  },
  me() { const d = Store.data, us = api.users(); return us.find(u => u.id === d.settings.currentUserId) || us[0]; },
  can(action) { const r = api.me().role; if (r === 'manager') return action === 'scorecard.view'; return r === 'owner' || ACCOUNTANT_ALLOWED.has(action); },
  list(col) { return Store.data[col].filter(r => !r.deleted); },
  all(col) { return Store.data[col]; },
  get(col, id) { return id ? Store.data[col].find(r => r.id === id) || null : null; },
  isLocked(date) { return !!date && Store.data.settings.lockedMonths.includes(ymOf(date)); },
  log(action, entity, entityId, summary, changes) {
    Store.data.audit.push({ id: uid('log'), ts: nowISO(), userId: api.me().id, action, entity, entityId, summary, changes: changes || [] });
  },
  guard(action) { if (!api.can(action)) throw new Error('Your role (' + ROLES[api.me().role] + ') is not allowed to do this.'); },

  async create(col, rec, opts = {}) {
    rec.id = rec.id || uid(PREFIX[col] || col);
    rec.createdBy = api.me().id; rec.createdAt = nowISO();
    Store.data[col].push(rec);
    api.log('create', col, rec.id, opts.summary || describe(col, rec));
    Store.persist(); return rec;
  },
  async update(col, id, patch, opts = {}) {
    const rec = api.get(col, id); if (!rec) throw new Error('Record not found');
    const changes = diffRecords(rec, patch);
    if (!changes.length) return rec;
    Object.assign(rec, patch, { updatedBy: api.me().id, updatedAt: nowISO() });
    api.log(opts.action || 'update', col, id, opts.summary || describe(col, rec), changes);
    Store.persist(); return rec;
  },

  /* ---- entries ---- */
  validateEntry(e) {
    const errs = {};
    if (!e.date) errs.date = 'Date is required';
    else if (api.isLocked(e.date)) errs.date = monthLabel(ymOf(e.date), true) + ' is locked. Ask the Owner to unlock it in Settings.';
    if (!e.accountId) errs.accountId = 'Choose an account';
    if (!e.paymentMode) errs.paymentMode = 'Choose a payment mode';
    if (e.type === 'transfer') {
      if (!(+e.amount > 0)) errs.amount = 'Enter an amount greater than zero';
      if (!e.toAccountId) errs.toAccountId = 'Choose the destination account';
      else if (e.toAccountId === e.accountId) errs.toAccountId = 'From and To accounts must differ';
    } else {
      if (!e.categoryId) errs.categoryId = 'Choose a category';
      if (!e.departmentId) errs.departmentId = 'Choose a department';
      if (!e.partyId && !e.projectId) errs.partyId = 'Link a client, vendor, employee or project';
      if (!(+e.taxable > 0)) errs.taxable = 'Enter an amount greater than zero';
      else if (+e.tdsAmount < 0 || +e.gstAmount < 0) errs.taxable = 'GST and TDS cannot be negative';
      else if (entryNet(e) <= 0) errs.taxable = 'Net cash must be greater than zero';
    }
    return errs;
  },
  normaliseEntry(e) {
    const out = { ...e };
    if (out.type === 'transfer') {
      Object.assign(out, { piId: null, categoryId: null, departmentId: null, partyKind: null, partyId: null, projectId: null, taxable: r2(out.amount), gstType: 'none', gstRate: 0, gstAmount: 0, itc: false, tdsRate: 0, tdsAmount: 0, refNo: out.refNo || '' });
    } else {
      out.toAccountId = null;
      if (out.type !== 'inflow') out.piId = null;
      out.taxable = r2(out.taxable); out.gstAmount = r2(out.gstAmount); out.tdsAmount = r2(out.tdsAmount);
      out.gstRate = +out.gstRate || 0; out.tdsRate = +out.tdsRate || 0;
      if (!out.gstAmount) { out.gstType = 'none'; }
      out.itc = out.type === 'outflow' && out.gstAmount > 0 ? !!out.itc : false;
      if (!(out.tdsAmount > 0) && out.categoryId !== 'cat_tdsdep') out.tdsSection = null;
      const p = api.get('parties', out.partyId); out.partyKind = p ? p.kind : null;
    }
    out.amount = entryNet(out);
    return out;
  },
  async saveEntry(input, id) {
    const e = api.normaliseEntry(input);
    const errs = api.validateEntry(e);
    if (Object.keys(errs).length) { const err = new Error(Object.values(errs)[0]); err.fields = errs; throw err; }
    let savedEntry;
    if (id) {
      api.guard('entry.edit');
      const old = api.get('entries', id);
      if (api.isLocked(old.date)) throw new Error(monthLabel(ymOf(old.date), true) + ' is locked.');
      savedEntry = await api.update('entries', id, e);
    } else {
      api.guard('entry.create');
      savedEntry = await api.create('entries', { deleted: false, attachments: [], ...e });
    }

    if (savedEntry && typeof window !== 'undefined' && typeof (window as any).__supabaseSaveTransaction === 'function') {
      try {
        const sbTxn = await (window as any).__supabaseSaveTransaction(savedEntry);
        if (sbTxn && sbTxn.id) {
          savedEntry.supabase_id = sbTxn.id;
          Store.persist();
        }
      } catch (sbErr) {
        console.warn('Could not sync transaction to Supabase:', sbErr);
      }
    }
    return savedEntry;
  },
  async softDelete(id) {
    api.guard('entry.delete');
    const e = api.get('entries', id);
    if (api.isLocked(e.date)) throw new Error(monthLabel(ymOf(e.date), true) + ' is locked.');
    Object.assign(e, { deleted: true, deletedBy: api.me().id, deletedAt: nowISO() });
    api.log('delete', 'entries', id, describe('entries', e)); Store.persist();
    if (typeof window !== 'undefined' && typeof (window as any).__supabaseCancelTransaction === 'function') {
      (window as any).__supabaseCancelTransaction(e.supabase_id || e.id).catch(console.warn);
    }
  },
  async restore(id) {
    api.guard('entry.restore');
    const e = api.get('entries', id);
    if (api.isLocked(e.date)) throw new Error(monthLabel(ymOf(e.date), true) + ' is locked. Unlock it before restoring.');
    Object.assign(e, { deleted: false, deletedBy: null, deletedAt: null });
    api.log('restore', 'entries', id, describe('entries', e)); Store.persist();
    if (typeof window !== 'undefined' && typeof (window as any).__supabaseSaveTransaction === 'function') {
      (window as any).__supabaseSaveTransaction(e).catch(console.warn);
    }
  },
  async purge(id) {
    api.guard('entry.purge');
    const e = api.get('entries', id);
    for (const a of e.attachments || []) await FileStore.del(a.id).catch(() => {});
    Store.data.entries = Store.data.entries.filter(x => x.id !== id);
    api.log('purge', 'entries', id, describe('entries', e)); Store.persist();
    if (typeof window !== 'undefined' && typeof (window as any).__supabaseDeleteTransaction === 'function') {
      (window as any).__supabaseDeleteTransaction(e.supabase_id || e.id).catch(console.warn);
    }
  },

  /* ---- recurring ---- */
  async skipPeriod(recId, period) {
    api.guard('recurring.skip');
    const r = api.get('recurring', recId);
    r.skipped = [...new Set([...(r.skipped || []), period])];
    api.log('skip', 'recurring', recId, `${r.name} · skipped ${monthLabel(period, true)}`); Store.persist();
  },

  /* ---- orders & PIs ---- */
  async saveOrder(input, id, reason, newProject) {
    const o = { ...input };
    o.taxable = r2(o.taxable); o.gstRate = +o.gstRate || 0; o.gstAmount = r2(o.gstAmount); o.total = r2(o.taxable + o.gstAmount);
    if (!o.gstAmount) o.gstType = 'none';
    // Department credit: the UI sends amounts per department; percentages are derived from them (order value = sum of amounts).
    if ((o.split || []).some(x => x.amount !== undefined)) {
      const rows = o.split.filter(x => x.departmentId && +x.amount > 0);
      const merged = []; rows.forEach(x => { const m = merged.find(y => y.departmentId === x.departmentId); if (m) m.amount += +x.amount; else merged.push({ departmentId: x.departmentId, amount: +x.amount }); });
      const tot = r2(sum(merged, x => x.amount));
      if (merged.length) { o.taxable = tot; o.departmentId = merged.slice().sort((p, q) => q.amount - p.amount)[0].departmentId; }
      o.split = merged.length > 1 ? merged.map(x => ({ departmentId: x.departmentId, amount: r2(x.amount), pct: x.amount / tot * 100 })) : [];
      if (o.gstRate) o.gstAmount = r2(o.taxable * o.gstRate / 100);
      o.total = r2(o.taxable + o.gstAmount);
    } else o.split = (o.split || []).filter(x => x.departmentId && +x.pct > 0).map(x => ({ departmentId: x.departmentId, pct: +x.pct, amount: r2(o.taxable * x.pct / 100) }));
    if (o.split.length === 1) { o.departmentId = o.split[0].departmentId; o.split = []; }
    o.terms = (o.terms || []).filter(t => t.label || +t.pct).map(t => ({ label: t.label || 'Milestone', pct: +t.pct || 0 }));
    const errs = {};
    if (!o.orderNo) errs.orderNo = 'Order / reference no. is required';
    if (!o.date) errs.date = 'Date is required';
    if (!o.clientId) errs.clientId = 'Choose a client';
    if (newProject) {
      if (!newProject.code || !newProject.name) errs.projectId = 'Enter a code and name for the new project';
      else if (api.list('projects').some(p => p.code.toLowerCase() === newProject.code.toLowerCase())) errs.projectId = 'Project code ' + newProject.code + ' already exists';
    } else if (!o.projectId) errs.projectId = 'Choose or create a project';
    if (!o.departmentId) errs.split = errs.departmentId = 'Choose a department';
    if (!(o.taxable > 0)) errs.split = errs.taxable = 'Enter the amount for at least one department';
    if (o.split.length && Math.abs(sum(o.split, x => x.pct) - 100) > 0.01) errs.split = 'Department split must add up to 100%';
    if (o.terms.length && Math.abs(sum(o.terms, t => t.pct) - 100) > 0.5) errs.terms = 'Payment terms must add up to 100%';
    if (api.list('orders').some(x => x.id !== id && x.clientId === o.clientId && x.orderNo.trim().toLowerCase() === String(o.orderNo).trim().toLowerCase())) errs.orderNo = 'This client already has an order with that number';
    const old = id ? api.get('orders', id) : null;
    if (old && Math.abs(old.taxable - o.taxable) > 0.004 && !reason) errs.reason = 'Give a reason for the value change';
    if (Object.keys(errs).length) { const e = new Error(Object.values(errs)[0]); e.fields = errs; throw e; }
    if (newProject) { api.guard('project.create'); const pr = await api.create('projects', { code: newProject.code, name: newProject.name, clientId: o.clientId, departmentId: o.departmentId, contractValue: 0, startDate: o.date, status: 'active', active: true }); o.projectId = pr.id; }
    let savedOrder;
    if (old) {
      api.guard('order.edit');
      if (Math.abs(old.taxable - o.taxable) > 0.004 || reason) o.amendments = [...(old.amendments || []), { date: TODAY, by: api.me().id, from: old.taxable, to: o.taxable, note: reason || '' }];
      savedOrder = await api.update('orders', id, o);
    } else {
      api.guard('order.create');
      savedOrder = await api.create('orders', { status: 'active', amendments: [], attachments: [], deleted: false, ...o });
    }

    if (savedOrder) {
      const clientParty = api.get('parties', savedOrder.clientId) || api.list('parties').find((p: any) => p.id === savedOrder.clientId || p.supabase_id === savedOrder.clientId);
      if (clientParty) {
        savedOrder.clientName = clientParty.name;
        savedOrder.client_name = clientParty.name;
        if (clientParty.supabase_id) savedOrder.client_supabase_id = clientParty.supabase_id;
      }
      const projectObj = api.get('projects', savedOrder.projectId) || api.list('projects').find((p: any) => p.id === savedOrder.projectId || p.supabase_id === savedOrder.projectId);
      if (projectObj) {
        savedOrder.projectName = projectObj.name || projectObj.code || '';
        savedOrder.project_name = projectObj.name || projectObj.code || '';
        if (projectObj.supabase_id) savedOrder.project_supabase_id = projectObj.supabase_id;
      }
    }

    if (savedOrder && typeof window !== 'undefined' && typeof (window as any).__supabaseSaveOrder === 'function') {
      try {
        const sbOrder = await (window as any).__supabaseSaveOrder(savedOrder);
        if (sbOrder && sbOrder.id) {
          savedOrder.supabase_id = sbOrder.id;
          Store.persist();
        }
      } catch (sbErr) {
        console.warn('Could not sync order to Supabase:', sbErr);
      }
    }
    return savedOrder;
  },
  async setOrderStatus(id, status) {
    api.guard(status === 'active' ? 'order.edit' : 'order.cancel');
    const updated = await api.update('orders', id, { status }, { action: status === 'cancelled' ? 'cancel' : status === 'closed' ? 'close' : 'reopen' });
    if (updated) {
      const clientParty = api.get('parties', updated.clientId) || api.list('parties').find((p: any) => p.id === updated.clientId || p.supabase_id === updated.clientId);
      if (clientParty) {
        updated.clientName = clientParty.name;
        updated.client_name = clientParty.name;
        if (clientParty.supabase_id) updated.client_supabase_id = clientParty.supabase_id;
      }
      const projectObj = api.get('projects', updated.projectId) || api.list('projects').find((p: any) => p.id === updated.projectId || p.supabase_id === updated.projectId);
      if (projectObj) {
        updated.projectName = projectObj.name || projectObj.code || '';
        updated.project_name = projectObj.name || projectObj.code || '';
        if (projectObj.supabase_id) updated.project_supabase_id = projectObj.supabase_id;
      }
    }
    if (updated && typeof window !== 'undefined' && typeof (window as any).__supabaseSaveOrder === 'function') {
      (window as any).__supabaseSaveOrder(updated).catch(console.warn);
    }
    return updated;
  },
  async savePI(input, id) {
    const p = { ...input };
    p.taxable = r2(p.taxable); p.gstRate = +p.gstRate || 0; p.gstAmount = r2(p.gstAmount); p.tdsRate = +p.tdsRate || 0; p.tdsAmount = r2(p.tdsAmount);
    p.total = r2(p.taxable + p.gstAmount); if (!p.gstAmount) p.gstType = 'none';
    const ord = api.get('orders', p.orderId);
    const errs = {};
    if (!ord) errs.orderId = 'Choose the order this PI is raised against';
    if (!p.piNo) errs.piNo = 'PI number is required';
    else if (api.all('pis').some(x => x.id !== id && x.piNo.trim().toLowerCase() === p.piNo.trim().toLowerCase())) errs.piNo = 'PI number already used';
    if (!p.date) errs.date = 'Date is required';
    if (!p.dueDate) errs.dueDate = 'Due date is required'; else if (p.date && p.dueDate < p.date) errs.dueDate = 'Due date is before the PI date';
    if (!(p.taxable > 0)) errs.taxable = 'Enter the PI value';
    if (Object.keys(errs).length) { const e = new Error(Object.values(errs)[0]); e.fields = errs; throw e; }
    p.clientId = ord.clientId; p.projectId = ord.projectId;
    if (id) { api.guard('pi.edit'); return api.update('pis', id, p); }
    api.guard('pi.create');
    return api.create('pis', { status: 'issued', attachments: [], deleted: false, ...p });
  },
  async setPIStatus(id, status) { api.guard(status === 'cancelled' ? 'pi.cancel' : 'pi.edit'); return api.update('pis', id, { status }, { action: status === 'cancelled' ? 'cancel' : 'reopen' }); },
  async removeRecord(col, id) {
    api.guard(col === 'orders' ? 'order.delete' : 'pi.delete');
    const r = api.get(col, id);
    if (col === 'orders' && api.list('pis').some(p => p.orderId === id)) throw new Error('This order has PIs. Cancel it instead, or delete its PIs first.');
    if (col === 'pis' && Calc.live().some(e => e.piId === id)) throw new Error('Receipts are linked to this PI. Cancel it instead.');
    Object.assign(r, { deleted: true, deletedBy: api.me().id, deletedAt: nowISO() });
    api.log('delete', col, id, describe(col, r)); Store.persist();
    if (col === 'orders' && typeof window !== 'undefined' && typeof (window as any).__supabaseDeleteOrder === 'function') {
      (window as any).__supabaseDeleteOrder(r.supabase_id || r.id || r.orderNo).catch(console.warn);
    }
  },
  async saveTargets(fy, rows) {
    api.guard('targets.edit');
    const before = Store.data.targets[fy] || {}; const changes = [];
    for (const [dep, arr] of Object.entries(rows)) {
      const a = (before[dep] || []).reduce((x, y) => x + (+y || 0), 0), b = arr.reduce((x, y) => x + (+y || 0), 0);
      if (JSON.stringify(before[dep] || []) !== JSON.stringify(arr)) changes.push({ field: nameOf('departments', dep), from: money(a), to: money(b) });
    }
    Store.data.targets[fy] = rows;
    if (changes.length) api.log('update', 'targets', String(fy), 'Revenue targets · ' + fyLabel(fy), changes);
    Store.persist();
  },

  /* ---- settings ---- */
  async setLock(ym, locked) {
    api.guard('month.lock');
    const s = Store.data.settings; const has = s.lockedMonths.includes(ym);
    if (locked && !has) s.lockedMonths.push(ym);
    if (!locked && has) s.lockedMonths = s.lockedMonths.filter(x => x !== ym);
    s.lockedMonths.sort();
    api.log(locked ? 'lock' : 'unlock', 'settings', ym, `${locked ? 'Locked' : 'Unlocked'} ${monthLabel(ym, true)}`); Store.persist();
  },
  /* ---- email outbox ---- */
  async queueEmail(m) {
    api.guard('email.queue');
    const to = (m.to || []).filter(validEmail), cc = (m.cc || []).filter(validEmail);
    if (!to.length) throw new Error('Add at least one valid recipient email');
    const rec = { kind: m.kind, entity: m.entity, entityId: m.entityId, partyId: m.partyId, from: emailSettings().from, to, cc, subject: m.subject, body: m.body, attachments: m.attachments || [], status: 'queued', sentAt: null, error: null, events: [{ ts: nowISO(), status: 'queued', by: api.me().id }] };
    return api.create('emails', rec);
  },
  async setEmailStatus(id, status, note) {
    api.guard(status === 'cancelled' ? 'email.cancel' : 'email.status');
    const m = api.get('emails', id);
    const patch = { status, events: [...(m.events || []), { ts: nowISO(), status, by: api.me().id, note: note || '' }] };
    if (status === 'sent') patch.sentAt = nowISO(); if (status === 'failed') patch.error = note || 'Delivery failed';
    return api.update('emails', id, patch, { action: status === 'cancelled' ? 'cancel' : 'update', summary: describe('emails', m) + ' · ' + EMAIL_STATUS[status] });
  },
  async saveEmailSettings(patch) {
    api.guard('settings.edit'); const cur = emailSettings();
    const changes = diffRecords(cur, patch).map(c => ({ ...c, from: String(c.from).slice(0, 80), to: String(c.to).slice(0, 80) }));
    Object.assign(cur, patch); if (changes.length) api.log('update', 'settings', 'email', 'Email settings', changes); Store.persist();
  },
  async saveSettings(patch) {
    api.guard('settings.edit');
    const s = Store.data.settings; const changes = diffRecords(s, patch);
    if (!changes.length) return;
    Object.assign(s, patch); api.log('update', 'settings', 'settings', 'Company settings', changes); Store.persist();
  },
  switchUser(userId) { Store.data.settings.currentUserId = userId; Store.persist(); },
};

/* ----------------------------- analytics ----------------------------- */
const Calc = {
  live() { return api.list('entries'); },
  inRange(from, to) { return Calc.live().filter(e => e.date >= from && e.date <= to); },
  /** Balance of one account at end of `upto` (inclusive). */
  balance(accId, upto) {
    const a = api.get('accounts', accId); if (!a) return 0;
    const open = Store.data.settings.openingDate;
    let b = +a.openingBalance || 0;
    for (const e of Calc.live()) {
      if (e.date < open || e.date > upto) continue;
      if (e.type === 'inflow' && e.accountId === accId) b += e.amount;
      else if (e.type === 'outflow' && e.accountId === accId) b -= e.amount;
      else if (e.type === 'transfer') { if (e.accountId === accId) b -= e.amount; if (e.toAccountId === accId) b += e.amount; }
    }
    return r2(b);
  },
  cash(upto, { includeFD = true } = {}) {
    return r2(sum(api.list('accounts').filter(a => includeFD || a.type !== 'fd'), a => Calc.balance(a.id, upto)));
  },
  /** Monthly totals of inflow/outflow for a list of months; optional filter fn. */
  monthly(months, filter = () => true) {
    const idx = Object.fromEntries(months.map((m, i) => [m, i]));
    const inflow = months.map(() => 0), outflow = months.map(() => 0);
    for (const e of Calc.live()) {
      const i = idx[ymOf(e.date)]; if (i == null || !filter(e)) continue;
      if (e.type === 'inflow') inflow[i] += e.amount; else if (e.type === 'outflow') outflow[i] += e.amount;
    }
    return { inflow: inflow.map(r2), outflow: outflow.map(r2), net: inflow.map((v, i) => r2(v - outflow[i])) };
  },
  /** Average gross outflow of the last n completed months before TODAY. */
  avgBurn(n = 3) {
    const cur = ymOf(TODAY); const months = Array.from({ length: n }, (_, i) => addMonths(cur, -(i + 1)));
    const m = Calc.monthly(months); return { out: r2(sum(m.outflow) / n), in: r2(sum(m.inflow) / n), months };
  },
  /** Pending recurring items (not posted, not skipped) due up to `until`. */
  pendingRecurring(until) {
    const posted = new Set(Calc.live().filter(e => e.recurringId).map(e => e.recurringId + '|' + e.recurringPeriod));
    const out = [];
    for (const r of api.list('recurring')) {
      if (!r.active) continue;
      for (const p of recurringPeriods(r, until)) {
        if (posted.has(r.id + '|' + p.period) || (r.skipped || []).includes(p.period)) continue;
        const sg = recurringSuggest(r);
        out.push({ rec: r, ...p, taxable: sg.suggested, net: recurringNet(r, sg.suggested), overdue: p.dueDate < TODAY });
      }
    }
    return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  },
  /** Expected recurring items in a month (regardless of posted). */
  recurringInMonth(ym) {
    const out = [];
    for (const r of api.list('recurring')) {
      if (!r.active) continue;
      for (const p of recurringPeriods(r, ymDate(ym, 31))) if (p.period === ym && !(r.skipped || []).includes(ym)) out.push({ rec: r, ...p, net: recurringNet(r, recurringSuggest(r).forecast) });
    }
    return out;
  },
};
function recurringNet(r, taxable) {
  const t = taxable != null ? +taxable || 0 : +r.taxable || 0; return r2(t + Math.round(t * (r.gstRate || 0)) / 100 - Math.round(t * (r.tdsRate || 0)) / 100);
}
/** Amount to pre-fill for a recurring item. Variable-amount templates (r.variable) start from the last recorded actual;
    the forecast uses the average of the last 3 actuals. Fixed templates always use the template amount. */
function recurringSuggest(r) {
  const posted = Calc.live().filter(e => e.recurringId === r.id).sort((a, b) => (b.recurringPeriod || b.date).localeCompare(a.recurringPeriod || a.date));
  const last = posted[0] || null, avg3 = posted.length ? Math.round(sum(posted.slice(0, 3), e => e.taxable) / Math.min(3, posted.length)) : null;
  return { suggested: r.variable && last ? last.taxable : +r.taxable, last: last ? last.taxable : null, lastPeriod: last ? last.recurringPeriod : null, avg3, forecast: r.variable && avg3 != null ? avg3 : +r.taxable };
}
/** Build an entry from a recurring template for a given cycle (used by quick-record and the confirm form). */
function entryFromRecurring(rec, period, dueDate, taxable) {
  const t = taxable != null ? +taxable : recurringSuggest(rec).suggested;
  const v = { type: rec.type, date: dueDate <= TODAY ? dueDate : TODAY, categoryId: rec.categoryId, departmentId: rec.departmentId, partyId: rec.partyId, projectId: rec.projectId || null,
    description: rec.description, refNo: '', taxable: t, gstType: rec.gstType, gstRate: rec.gstRate, gstAmount: r2(t * rec.gstRate / 100), itc: rec.itc !== false, tdsRate: rec.tdsRate, tdsAmount: r2(t * rec.tdsRate / 100),
    paymentMode: rec.paymentMode, accountId: rec.accountId, toAccountId: null, txnRef: '', notes: '', attachments: [], recurringId: rec.id, recurringPeriod: period, piId: null };
  if (rec.categoryId === 'cat_sal' || rec.categoryId === 'cat_ceo') v.description = 'Salary – ' + monthLabel(period, true);
  if (rec.type === 'inflow') { const pi = api.list('pis').find(p => p.clientId === rec.partyId && ymOf(p.date) === period && Sales.piState(p).outstanding > 0); if (pi) { v.piId = pi.id; v.refNo = pi.taxInvoiceNo || pi.piNo; } }
  return v;
}

/* ----------------------------- orders, PIs & targets ----------------------------- */
/* Revenue = PI taxable value (pre-GST). Department credit follows the order's split (default 100% to its department).
   Collected = taxable portion of operating receipts; receipts linked to a PI follow that PI's order split. */
const Sales = {
  shares(order, fallbackDep) {
    if (order && order.split && order.split.length) return order.split;
    if (order) return [{ departmentId: order.departmentId, pct: 100 }];
    return fallbackDep ? [{ departmentId: fallbackDep, pct: 100 }] : [];
  },
  orderOfPI(pi) { return pi ? api.get('orders', pi.orderId) : null; },
  piCollected(pi) {
    const es = Calc.live().filter(e => e.type === 'inflow' && e.piId === pi.id);
    return { gross: r2(sum(es, e => e.taxable + e.gstAmount)), taxable: r2(sum(es, e => e.taxable)), net: r2(sum(es, e => e.amount)), tds: r2(sum(es, e => e.tdsAmount)), entries: es, last: es.map(e => e.date).sort().pop() || null };
  },
  piState(pi) {
    const c = Sales.piCollected(pi);
    if (pi.status === 'cancelled') return { ...c, outstanding: 0, status: 'cancelled', overdueDays: 0 };
    const cns = (Store.data.creditNotes || []).filter(x => !x.deleted && x.piId === pi.id), cn = r2(sum(cns, x => x.taxable + x.gstAmount)), cnTax = r2(sum(cns, x => x.taxable));
    const out = Math.max(0, r2(pi.total - c.gross - cn));
    const status = out <= 1 ? 'paid' : c.gross > 0 ? 'part' : 'issued';
    const overdueDays = status !== 'paid' && pi.dueDate < TODAY ? diffDays(TODAY, pi.dueDate) : 0;
    return { ...c, outstanding: status === 'paid' ? 0 : out, outstandingTaxable: status === 'paid' ? 0 : Math.max(0, r2(pi.taxable - c.taxable - cnTax)), status, overdueDays, creditNotes: cn };
  },
  orderState(o) {
    const pis = api.list('pis').filter(p => p.orderId === o.id && p.status !== 'cancelled');
    const st = pis.map(p => ({ pi: p, ...Sales.piState(p) }));
    const invoiced = r2(sum(pis, p => p.taxable)), received = r2(sum(st, x => x.taxable));
    const status = o.status === 'cancelled' ? 'cancelled' : o.status === 'closed' ? 'closed' : invoiced <= 0 ? 'open' : invoiced < o.taxable - 1 ? 'partly' : 'full';
    return { pis: st, invoiced, received, outstanding: r2(sum(st, x => x.outstanding)), toInvoice: ['cancelled', 'closed'].includes(status) ? 0 : Math.max(0, r2(o.taxable - invoiced)), status, pct: o.taxable ? invoiced / o.taxable * 100 : 0 };
  },
  projectContract(pid) {
    const os = api.list('orders').filter(o => o.projectId === pid && o.status !== 'cancelled');
    return os.length ? sum(os, o => o.taxable) : ((api.get('projects', pid) || {}).contractValue || 0);
  },
  /** Flat revenue facts {m, dep, clientId, projectId, ym, date, v, ref} with department split applied. */
  facts() {
    const out = [];
    const push = (m, shares, base) => shares.forEach(sh => out.push({ ...base, m, dep: sh.departmentId, v: base.amt * sh.pct / 100, share: sh.pct }));
    for (const o of api.list('orders')) if (o.status !== 'cancelled') push('booked', Sales.shares(o), { clientId: o.clientId, projectId: o.projectId, ym: ymOf(o.date), date: o.date, amt: o.taxable, ref: o.id });
    for (const p of api.list('pis')) if (p.status !== 'cancelled') push('billed', Sales.shares(Sales.orderOfPI(p)), { clientId: p.clientId, projectId: p.projectId, ym: ymOf(p.date), date: p.date, amt: p.taxable, ref: p.id });
    for (const e of Calc.live()) {
      if (e.type !== 'inflow' || bucketOf(api.get('categories', e.categoryId)) !== 'op_rec') continue;
      const pi = api.get('pis', e.piId); const ord = pi ? Sales.orderOfPI(pi) : api.list('orders').find(o => o.projectId && o.projectId === e.projectId);
      push('collected', Sales.shares(ord, e.departmentId), { clientId: e.partyId, projectId: e.projectId, ym: ymOf(e.date), date: e.date, amt: e.taxable, ref: e.id });
    }
    return out;
  },
  target(fy, dep, i) { const t = ((Store.data.targets || {})[fy] || {})[dep]; return t ? (+t[i] || 0) : 0; },
  targetForMonth(ym, dep) { const fy = fyOf(ym + '-01'); return Sales.target(fy, dep, fyMonths(fy).indexOf(ym)); },
  nextPiNo(date) {
    const fy = fyOf(date || TODAY); const pre = `IUOVA/PI/${pad2(fy % 100)}-${pad2((fy + 1) % 100)}/`;
    const max = Math.max(0, ...api.all('pis').filter(p => p.piNo.startsWith(pre)).map(p => +p.piNo.slice(pre.length) || 0));
    return pre + String(max + 1).padStart(3, '0');
  },
  ageing() {
    const B = [['notdue', 'Not yet due'], ['d30', '1–30 days'], ['d60', '31–60 days'], ['d90', '61–90 days'], ['d90p', '90+ days']];
    const res = Object.fromEntries(B.map(([k]) => [k, { amt: 0, n: 0 }]));
    for (const p of api.list('pis')) {
      const st = Sales.piState(p); if (!st.outstanding) continue;
      const d = st.overdueDays; const k = d <= 0 ? 'notdue' : d <= 30 ? 'd30' : d <= 60 ? 'd60' : d <= 90 ? 'd90' : 'd90p';
      res[k].amt += st.outstanding; res[k].n++;
    }
    return B.map(([k, l]) => ({ k, l, ...res[k] }));
  },
};

/* ======================================================================
   TEST DATA GENERATOR  — fictional companies & people. Remove in production.
   Covers 1 Apr 2025 → yesterday.
   ====================================================================== */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function buildSeed() {
  const rnd = mulberry32(20250401);
  const rint = (a, b) => Math.floor(a + rnd() * (b - a + 1));
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const r100 = n => Math.round(n / 100) * 100;
  const OPEN = '2025-04-01';
  const D = {
    meta: { schemaVersion: 9, seededAt: nowISO(), testData: true },
    settings: { company: 'IUOVA Design Company', gstin: '27ABCDE1234F1Z5', state: 'Maharashtra', openingDate: OPEN, currentUserId: 'u_owner', lockedMonths: [], email: defaultEmailSettings() },
    users: [{ id: 'u_owner', name: 'Vatsal', role: 'owner' }, { id: 'u_acct', name: 'Accountant', role: 'accountant' }],
    accounts: [
      { id: 'acc_hdfc', name: 'HDFC Bank – Current', type: 'bank', number: '••4521', openingBalance: 2850000, active: true },
      { id: 'acc_icici', name: 'ICICI Bank – Current', type: 'bank', number: '••7783', openingBalance: 640000, active: true },
      { id: 'acc_fd', name: 'HDFC Fixed Deposit', type: 'fd', number: 'FD ••0912', openingBalance: 2500000, active: true },
      { id: 'acc_cash', name: 'Petty Cash', type: 'cash', number: '', openingBalance: 35000, active: true },
    ],
    departments: DEFAULT_DEPARTMENTS.map(([id, name]) => ({ id, name, active: true, managerName: { dep_design: 'Priya Nair', dep_eng: 'Vikram Shah', dep_sales: 'Aditya Bhosale', dep_ops: 'Meera Desai', dep_hr: 'Ritu Saxena', dep_fin: 'Sanjay Patil' }[id] || '', managerEmail: '' })),
    categories: DEFAULT_CATEGORIES.map(([id, type, group, name, partyKind, kind]) => ({ id, type, group, name, partyKind, kind, active: true })),
    parties: [], projects: [], recurring: [], entries: [], audit: [], orders: [], pis: [], targets: {}, emails: [], bankLines: [], bankImports: [], tds26: [], tdsCerts: [], compliance: {}, creditNotes: [], gstBills: [], gst2b: [], gstMonths: {}, tdsMonths: {}, tdsQuarters: {}, tdsOutCerts: [],
  };
  for (const c of [...D.accounts, ...D.departments, ...D.categories]) { c.createdBy = 'u_owner'; c.createdAt = OPEN + 'T09:00:00.000Z'; }
  const P = (id, kind, name, extra = {}) => D.parties.push({ id, kind, name, gstin: '', gstType: 'none', departmentId: null, designation: '', monthlySalary: null, joinDate: null, email: '', phone: '', active: true, createdBy: 'u_owner', createdAt: OPEN + 'T09:00:00.000Z', ...extra });
  [['cl_nw', 'Northwind Appliances Ltd', 'intra', '27AAACN4821K1Z2'], ['cl_vl', 'Veloce Electricals Pvt Ltd', 'inter', '24AABCV7712P1Z8'], ['cl_ar', 'Arcadia Home Products Ltd', 'inter', '29AAFCA3390M1Z1'], ['cl_md', 'Meridian Switchgear Ltd', 'intra', '27AADCM5561Q1Z6'], ['cl_sl', 'Solace Consumer Durables Ltd', 'inter', '07AAGCS2208H1Z3'], ['cl_ks', 'Kestrel Mobility Pvt Ltd', 'intra', '27AAHCK9034D1Z9'], ['cl_zp', 'Zephyr Lighting Co.', 'inter', '33AAJFZ6617B1Z4']]
    .forEach(([id, n, g, gst]) => P(id, 'client', n, { gstType: g, gstin: gst, email: 'accounts@' + n.split(' ')[0].toLowerCase() + '.example, projects@' + n.split(' ')[0].toLowerCase() + '.example' }));
  [['vn_landlord', 'Shreeji Realty LLP', 'intra'], ['vn_power', 'Metro Power Distribution', 'none'], ['vn_net', 'AirLink Fibernet Pvt Ltd', 'intra'], ['vn_soft', 'CloudSuite Software India Pvt Ltd', 'inter'], ['vn_clean', 'CleanPro Facility Services', 'intra'], ['vn_proto', 'ProtoWorks Rapid Prototyping', 'intra'], ['vn_cnc', 'Precision CNC Works', 'intra'], ['vn_lab', 'Lumen Test Labs Pvt Ltd', 'inter'], ['vn_courier', 'Swift Courier Services', 'none'], ['vn_office', 'OfficeMart Supplies', 'none'], ['vn_ca', 'Mehta & Associates (CA)', 'intra'], ['vn_legal', 'Kulkarni Legal LLP', 'intra'], ['vn_travel', 'TravelDesk Pvt Ltd', 'intra'], ['vn_fl_rohan', 'Rohan Desai (Freelance Visualiser)', 'none'], ['vn_fl_ananya', 'Ananya Iyer (Freelance UX)', 'none'], ['vn_hw', 'Techno Hardware Store', 'intra'], ['vn_wood', 'Woodcraft Interiors', 'intra'], ['vn_pantry', 'BrewCo Pantry Services', 'none']]
    .forEach(([id, n, g]) => P(id, 'vendor', n, { gstType: g, gstin: g === 'none' ? '' : (g === 'intra' ? '27' : '29') + 'AAX' + id.slice(3, 5).toUpperCase().replace(/[^A-Z]/g, 'X').padEnd(2, 'X') + '1234A1Z' + rint(1, 9), email: ['vn_power', 'vn_courier', 'vn_office'].includes(id) ? '' : 'accounts@' + n.split(/[\s(]/)[0].toLowerCase().replace(/[^a-z]/g, '') + '.example' }));
  // contacts, address, terms and bank details for clients & vendors
  const CL_INFO = {
    cl_nw: ['Andheri East, Mumbai', '400093', 45, [['Rakesh Kapoor', 'Purchase Manager', 'rakesh.kapoor', '98200 41522', ['projects']], ['Sunita Rao', 'Accounts Payable', 'accounts', '022 6123 4400', ['accounts']], ['Vivek Menon', 'Head – Product', 'vivek.menon', '98191 22870', ['management']]]],
    cl_vl: ['Sanand GIDC, Ahmedabad', '382110', 30, [['Sanjay Patel', 'R&D Head', 'sanjay.patel', '98250 61234', ['projects', 'management']], ['Hetal Shah', 'Finance Executive', 'accounts', '079 2717 5500', ['accounts']]]],
    cl_ar: ['Peenya Industrial Area, Bengaluru', '560058', 60, [['Mohan Rao', 'Sourcing Lead', 'mohan.rao', '98450 33219', ['projects']], ['Accounts desk', '', 'accounts', '080 4122 9000', ['accounts']]]],
    cl_md: ['MIDC Bhosari, Pune', '411026', 45, [['Anil Kulkarni', 'Engineering Manager', 'anil.kulkarni', '98220 18843', ['projects']], ['Pooja Deshpande', 'Accounts', 'accounts', '020 2712 6600', ['accounts']]]],
    cl_sl: ['Okhla Phase II, New Delhi', '110020', 30, [['Neha Gupta', 'Product Manager', 'neha.gupta', '98110 45672', ['projects']], ['Rajiv Bansal', 'CFO', 'rajiv.bansal', '98100 22111', ['management']], ['AP team', '', 'accounts', '011 4055 7700', ['accounts']]]],
    cl_ks: ['Chakan, Pune', '410501', 30, [['Venkat Iyer', 'Program Manager', 'venkat.iyer', '98900 71245', ['projects']], ['Accounts', '', 'accounts', '', ['accounts']]]],
    cl_zp: ['Guindy, Chennai', '600032', 30, [['Karthik Raman', 'Design Head', 'karthik.raman', '98400 66120', ['projects', 'management']], ['Lakshmi S', 'Accounts', 'accounts', '044 2250 3300', ['accounts']]]],
  };
  const CL_TAN = { cl_nw: 'MUMN04821K', cl_vl: 'AHMV07712P', cl_ar: 'BLRA03390M', cl_md: 'PNEM05561Q', cl_sl: 'DELS02208H', cl_ks: 'PNEK09034D', cl_zp: '' };
  const dom = n => n.split(/[\s(]/)[0].toLowerCase().replace(/[^a-z]/g, '');
  const mkC = (dm, [name, des, user, phone, tags], i) => ({ id: 'ct' + i, name, designation: des, email: user ? user + '@' + dm + '.example' : '', phone, whatsapp: /^9/.test(phone), tags });
  D.parties.filter(p => p.kind === 'client').forEach(p => { const x = CL_INFO[p.id]; const gi = gstinInfo(p.gstin) || {}; Object.assign(p, { tan: CL_TAN[p.id] || '', stateCode: gi.stateCode || '', pan: gi.pan || '', address: x ? x[0] : '', pincode: x ? x[1] : '', creditDays: x ? x[2] : 30, bank: null, contacts: x ? x[3].map((c, i) => mkC(dom(p.name), c, i)) : [] }); });
  const BANKS = [['HDFC Bank', 'HDFC0000', 50100], ['ICICI Bank', 'ICIC0000', 6205], ['Kotak Mahindra Bank', 'KKBK0000', 4611], ['State Bank of India', 'SBIN0000', 3987], ['Axis Bank', 'UTIB0000', 9170]];
  const VN_PEOPLE = { vn_landlord: ['Mahesh Agarwal', 'Partner'], vn_net: ['Support desk', ''], vn_soft: ['Billing team', ''], vn_clean: ['Ramesh Yadav', 'Supervisor'], vn_proto: ['Ravi Shetty', 'Owner'], vn_cnc: ['Imran Khan', 'Production Head'], vn_lab: ['Dr. Anjali Mehta', 'Lab Manager'] };
  D.parties.filter(p => p.kind === 'vendor').forEach((p, i) => { const gi = gstinInfo(p.gstin) || {}; const bk = BANKS[i % BANKS.length]; const em = splitEmails(p.email)[0] || ''; const who = VN_PEOPLE[p.id];
    Object.assign(p, { stateCode: gi.stateCode || (p.gstType === 'inter' ? '29' : '27'), pan: gi.pan || '', address: p.gstType === 'inter' ? 'Bengaluru' : 'Mumbai', pincode: '', creditDays: [0, 15, 30][i % 3],
      bank: p.id === 'vn_power' ? null : { accName: p.name, bankName: bk[0], accNo: String(bk[2]) + String(100000 + i * 7919).slice(-6) + '42' + i, ifsc: bk[1].slice(0, 4) + '0' + String(100000 + i * 317).slice(-6), upi: ['vn_proto', 'vn_clean', 'vn_cnc'].includes(p.id) ? dom(p.name) + '@okhdfcbank' : '' },
      contacts: em ? [{ id: 'ct0', name: who ? who[0] : 'Accounts', designation: who ? who[1] : '', email: em, phone: '98' + String(20000000 + i * 1234567).slice(0, 8), whatsapp: true, tags: ['accounts'] }] : [] }); });
  D.parties.filter(p => p.kind === 'client' || p.kind === 'vendor').forEach(p => { p.email = partyEmails(p).join(', '); p.phone = (partyContacts(p).find(c => c.phone) || {}).phone || ''; });
  [['ot_gst', 'GST Department (Govt.)'], ['ot_it', 'Income Tax Department'], ['ot_pt', 'Maharashtra Profession Tax'], ['ot_hdfc', 'HDFC Bank'], ['ot_owner', 'Owner – Capital Account']].forEach(([id, n]) => P(id, 'other', n));
  const EMP = [
    ['em_ceo', 'Founder (CEO)', 'dep_mgmt', 'Founder & MD', 250000, '2016-04-01'],
    ['em_priya', 'Priya Nair', 'dep_design', 'Design Lead', 140000, '2019-07-01'],
    ['em_arjun', 'Arjun Mehta', 'dep_design', 'Senior Industrial Designer', 95000, '2021-02-01'],
    ['em_sneha', 'Sneha Kulkarni', 'dep_design', 'Industrial Designer', 65000, '2023-06-01'],
    ['em_rahul', 'Rahul Verma', 'dep_design', 'Industrial Designer', 58000, '2025-09-01'],
    ['em_kavya', 'Kavya Rao', 'dep_design', 'CMF Designer', 62000, '2022-11-01'],
    ['em_vikram', 'Vikram Shah', 'dep_eng', 'Engineering Lead', 135000, '2018-10-01'],
    ['em_nikhil', 'Nikhil Joshi', 'dep_eng', 'Mechanical Design Engineer', 82000, '2021-08-01'],
    ['em_farhan', 'Farhan Sheikh', 'dep_eng', 'Mechanical Design Engineer', 70000, '2023-01-01'],
    ['em_deepa', 'Deepa Pillai', 'dep_eng', 'Electronics Engineer', 78000, '2026-02-01'],
    ['em_aditya', 'Aditya Bhosale', 'dep_sales', 'BD Manager', 90000, '2022-04-01'],
    ['em_meera', 'Meera Desai', 'dep_ops', 'Operations Manager', 68000, '2020-05-01'],
    ['em_ritu', 'Ritu Saxena', 'dep_hr', 'HR & Admin Executive', 45000, '2024-03-01'],
    ['em_sanjay', 'Sanjay Patil', 'dep_fin', 'Accounts Executive', 42000, '2023-09-01'],
  ];
  const hike = s => Math.round(s * 1.08 / 500) * 500;
  EMP.forEach(([id, n, dep, des, sal, join]) => P(id, 'employee', n, { departmentId: dep, designation: des, monthlySalary: hike(sal), joinDate: join, email: n.split(' ')[0].toLowerCase().replace(/[()]/g, '') + '@iuova.example' }));
  const salaryFor = (emp, ym) => ym >= '2026-04' ? hike(emp[4]) : emp[4];
  const salTds = s => s >= 120000 ? 15 : s >= 80000 ? 10 : 0;

  // projects: [id, code, name, client, dept, fee, [[date,pct]...], category]
  const PRJ = [
    ['pr_2501', 'IU-2501', 'Air Cooler Redesign', 'cl_nw', 'dep_design', 3200000, [['2025-04-18', 30], ['2025-06-10', 40], ['2025-08-05', 30]]],
    ['pr_2502', 'IU-2502', 'Smart Switch Range', 'cl_vl', 'dep_eng', 4100000, [['2025-05-12', 30], ['2025-07-22', 40], ['2025-10-15', 30]]],
    ['pr_2503', 'IU-2503', 'MCB Enclosure Engineering', 'cl_md', 'dep_eng', 2600000, [['2025-06-02', 40], ['2025-08-28', 60]]],
    ['pr_2504', 'IU-2504', 'Kitchen Appliance CMF Study', 'cl_ar', 'dep_design', 1100000, [['2025-07-08', 50], ['2025-08-20', 50]]],
    ['pr_2505', 'IU-2505', 'Ceiling Fan Platform', 'cl_sl', 'dep_design', 4800000, [['2025-08-14', 30], ['2025-11-06', 40], ['2026-02-12', 30]]],
    ['pr_2506', 'IU-2506', 'E-Scooter Charger Housing', 'cl_ks', 'dep_eng', 3600000, [['2025-09-05', 30], ['2025-12-03', 40], ['2026-03-10', 30]]],
    ['pr_2507', 'IU-2507', 'Outdoor Luminaire Family', 'cl_zp', 'dep_design', 2100000, [['2025-10-20', 40], ['2026-01-14', 60]]],
    ['pr_2508', 'IU-2508', 'Water Purifier Gen 2', 'cl_nw', 'dep_eng', 5500000, [['2025-11-25', 25], ['2026-02-25', 35], ['2026-05-20', 40]]],
    ['pr_2509', 'IU-2509', 'Home Automation Hub', 'cl_vl', 'dep_design', 3000000, [['2026-01-08', 30], ['2026-04-09', 40], ['2026-07-07', 30]]],
    ['pr_2510', 'IU-2510', 'Distribution Board Range', 'cl_md', 'dep_eng', 4500000, [['2026-03-18', 30], ['2026-06-16', 40], ['2026-09-22', 30]]],
    ['pr_2601', 'IU-2601', 'BLDC Fan Controller Enclosure', 'cl_sl', 'dep_eng', 3100000, [['2026-04-22', 40], ['2026-07-28', 60]]],
    ['pr_2602', 'IU-2602', 'Mixer Grinder Redesign', 'cl_ar', 'dep_design', 3800000, [['2026-05-14', 30], ['2026-08-11', 40], ['2026-11-18', 30]]],
    ['pr_2603', 'IU-2603', 'Smart Street Light', 'cl_zp', 'dep_eng', 3300000, [['2026-06-24', 30], ['2026-09-15', 40], ['2026-12-15', 30]]],
    ['pr_2604', 'IU-2604', 'Charging Dock UX Study', 'cl_ks', 'dep_design', 1400000, [['2026-08-26', 50], ['2026-10-07', 50]]],
  ];
  PRJ.forEach(([id, code, name, cl, dep, fee, ms]) => {
    const last = ms[ms.length - 1][0];
    D.projects.push({ id, code, name, clientId: cl, departmentId: dep, contractValue: fee, startDate: addDays(ms[0][0], -21), status: last < TODAY ? 'completed' : 'active', active: true, createdBy: 'u_owner', createdAt: addDays(ms[0][0], -21) + 'T10:00:00.000Z' });
  });
  const party = id => D.parties.find(p => p.id === id);
  const PRJX = [ // non-milestone projects: retainers, consulting one-offs, recent orders
    ['pr_ret_nw', 'RET-NW', 'Northwind design retainer', 'cl_nw', 'dep_design', '2025-03-20'],
    ['pr_ret_vl', 'RET-VL', 'Veloce engineering retainer', 'cl_vl', 'dep_eng', '2025-09-20'],
    ['pr_25c1', 'IU-25C1', 'Design audit workshop', 'cl_zp', 'dep_design', '2025-08-25'],
    ['pr_25c2', 'IU-25C2', 'DFM review – switchgear range', 'cl_md', 'dep_eng', '2026-01-12'],
    ['pr_26c1', 'IU-26C1', 'Brand-to-product language workshop', 'cl_sl', 'dep_design', '2026-07-10'],
    ['pr_2605', 'IU-2605', 'Smart Kettle CMF & Form', 'cl_nw', 'dep_design', '2026-07-08'],
    ['pr_2606', 'IU-2606', 'Busbar Trunking Enclosure', 'cl_md', 'dep_eng', '2026-08-25'],
    ['pr_2607', 'IU-2607', 'IoT Sensor Housing', 'cl_vl', 'dep_eng', '2026-10-03'],
  ];
  PRJX.forEach(([id, code, name, cl, dep, start]) => D.projects.push({ id, code, name, clientId: cl, departmentId: dep, contractValue: 0, startDate: start, status: 'active', active: true, createdBy: 'u_owner', createdAt: start + 'T10:00:00.000Z' }));
  const SPLIT = { pr_2505: [['dep_design', 70], ['dep_eng', 30]], pr_2508: [['dep_eng', 60], ['dep_design', 40]], pr_2602: [['dep_design', 80], ['dep_eng', 20]], pr_2607: [['dep_eng', 70], ['dep_design', 30]] };
  const O = o => {
    const pc = party(o.clientId); const gstType = pc.gstType === 'none' ? 'intra' : pc.gstType;
    const rec = { id: o.id, orderNo: o.orderNo, type: o.type || 'PO', date: o.date, clientId: o.clientId, projectId: o.projectId, departmentId: o.departmentId,
      split: (SPLIT[o.projectId] || []).map(([d, pc2]) => ({ departmentId: d, pct: pc2 })), scope: o.scope || '', taxable: o.taxable, gstRate: 18, gstType, gstAmount: Math.round(o.taxable * 0.18), total: 0,
      terms: o.terms, expectedCompletion: o.expectedCompletion || null, contact: o.contact || '', notes: o.notes || '', attachments: [], status: o.status || 'active', amendments: o.amendments || [],
      createdBy: o.createdBy || 'u_acct', createdAt: o.date + 'T06:30:00.000Z', deleted: false };
    rec.total = rec.taxable + rec.gstAmount; D.orders.push(rec); return rec;
  };
  const PI = p => {
    const o = D.orders.find(x => x.id === p.orderId);
    const rec = { id: p.id, piNo: '', date: p.date, dueDate: p.dueDate || addDays(p.date, 30), orderId: o.id, clientId: o.clientId, projectId: o.projectId, milestone: p.milestone, taxable: p.taxable, gstRate: 18, gstType: o.gstType,
      gstAmount: Math.round(p.taxable * 0.18), tdsRate: 10, tdsAmount: Math.round(p.taxable * 0.1), total: 0, taxInvoiceNo: '', status: 'issued', notes: '', attachments: [], createdBy: 'u_acct', createdAt: p.date + 'T07:15:00.000Z', deleted: false };
    rec.total = rec.taxable + rec.gstAmount; D.pis.push(rec); return rec;
  };
  const contacts = { cl_nw: 'R. Kapoor (Purchase)', cl_vl: 'S. Patel (R&D)', cl_ar: 'M. Rao (Sourcing)', cl_md: 'A. Kulkarni (Engineering)', cl_sl: 'N. Gupta (Product)', cl_ks: 'V. Iyer (Programs)', cl_zp: 'K. Raman (Design)' };

  const refGen = mode => {
    const n = () => String(rint(100000, 999999)) + String(rint(100000, 999999));
    return { NEFT: 'N' + n(), RTGS: 'R' + n(), IMPS: 'IMPS' + n().slice(0, 10), UPI: 'UPI' + n(), Cheque: 'CHQ ' + rint(100000, 999999), Cash: '', Card: 'CARD ••3341', 'Auto-debit': 'ACH' + n().slice(0, 10) }[mode] || '';
  };
  let seq = 0;
  function add(e) {
    if (e.date >= TODAY) return null;
    const p = e.partyId ? party(e.partyId) : null;
    const isX = e.type === 'transfer';
    const taxable = isX ? e.amount : e.taxable;
    const gstRate = isX ? 0 : (e.gstRate || 0), tdsRate = isX ? 0 : (e.tdsRate || 0);
    const rec = {
      id: 'e_' + (++seq).toString(36).padStart(4, '0'), type: e.type, date: e.date,
      categoryId: e.categoryId || null, departmentId: e.departmentId || null,
      partyKind: p ? p.kind : null, partyId: e.partyId || null, projectId: e.projectId || null,
      description: e.description || '', refNo: e.refNo || '',
      taxable, gstType: gstRate ? (e.gstType || (p && p.gstType !== 'none' ? p.gstType : 'intra')) : 'none',
      gstRate, gstAmount: e.gstAmount ?? Math.round(taxable * gstRate / 100),
      itc: e.type === 'outflow' && gstRate > 0 && e.itc !== false,
      tdsRate, tdsAmount: e.tdsAmount ?? Math.round(taxable * tdsRate / 100), amount: 0,
      paymentMode: e.paymentMode || 'NEFT', accountId: e.accountId || 'acc_hdfc', toAccountId: e.toAccountId || null,
      txnRef: e.txnRef ?? refGen(e.paymentMode || 'NEFT'), notes: e.notes || '', attachments: [],
      recurringId: e.recurringId || null, recurringPeriod: e.recurringPeriod || null, piId: e.piId || null,
      createdBy: e.createdBy || 'u_acct', createdAt: e.date + 'T' + pad2(rint(4, 12)) + ':' + pad2(rint(0, 59)) + ':00.000Z',
      updatedBy: null, updatedAt: null, deleted: false,
    };
    rec.amount = isX ? r2(e.amount) : entryNet(rec);
    D.entries.push(rec); return rec;
  }

  /* recurring templates */
  const R = (o) => { const r = { projectId: null, gstType: 'none', gstRate: 0, tdsRate: 0, frequency: 'monthly', startDate: OPEN, endDate: null, active: true, skipped: [], createdBy: 'u_owner', createdAt: OPEN + 'T09:00:00.000Z', ...o }; r.itc = r.type === 'outflow' && r.gstRate > 0; if (r.gstRate && r.gstType === 'none') r.gstType = (party(r.partyId).gstType !== 'none' ? party(r.partyId).gstType : 'intra'); D.recurring.push(r); return r; };
  R({ id: 'rc_rent', name: 'Office rent', type: 'outflow', categoryId: 'cat_rent', departmentId: 'dep_ops', partyId: 'vn_landlord', description: 'Office rent – Unit 402, Andheri East', taxable: 185000, gstRate: 18, tdsRate: 10, paymentMode: 'NEFT', accountId: 'acc_hdfc', dayOfMonth: 5 });
  R({ id: 'rc_elec', variable: true, name: 'Electricity bill', type: 'outflow', categoryId: 'cat_elec', departmentId: 'dep_ops', partyId: 'vn_power', description: 'Electricity bill', taxable: 27000, paymentMode: 'Auto-debit', accountId: 'acc_hdfc', dayOfMonth: 12 });
  R({ id: 'rc_net', name: 'Internet – 1 Gbps leased line', type: 'outflow', categoryId: 'cat_net', departmentId: 'dep_ops', partyId: 'vn_net', description: 'Leased line + phones', taxable: 5999, gstRate: 18, paymentMode: 'Auto-debit', accountId: 'acc_icici', dayOfMonth: 15 });
  R({ id: 'rc_soft', name: 'Design software seats', type: 'outflow', categoryId: 'cat_soft', departmentId: 'dep_design', partyId: 'vn_soft', description: 'CAD / rendering / Office seats', taxable: 54000, gstRate: 18, paymentMode: 'Card', accountId: 'acc_hdfc', dayOfMonth: 10 });
  R({ id: 'rc_house', name: 'Housekeeping & security', type: 'outflow', categoryId: 'cat_house', departmentId: 'dep_ops', partyId: 'vn_clean', description: 'Housekeeping & security contract', taxable: 18500, gstRate: 18, tdsRate: 2, paymentMode: 'NEFT', accountId: 'acc_icici', dayOfMonth: 7 });
  R({ id: 'rc_ptax', name: 'Professional tax (employees)', type: 'outflow', categoryId: 'cat_ptax', departmentId: 'dep_fin', partyId: 'ot_pt', description: 'PT deposit', taxable: 2800, paymentMode: 'NEFT', accountId: 'acc_hdfc', dayOfMonth: 28 });
  R({ id: 'rc_emi', name: 'Vehicle loan EMI', type: 'outflow', categoryId: 'cat_emi', departmentId: 'dep_mgmt', partyId: 'ot_hdfc', description: 'Vehicle loan EMI', taxable: 42500, paymentMode: 'Auto-debit', accountId: 'acc_hdfc', dayOfMonth: 3, endDate: '2026-12-31' });
  R({ id: 'rc_pantry', variable: true, name: 'Pantry services', type: 'outflow', categoryId: 'cat_welfare', departmentId: 'dep_hr', partyId: 'vn_pantry', description: 'Tea / coffee / snacks', taxable: 11000, paymentMode: 'UPI', accountId: 'acc_icici', dayOfMonth: 8 });
  R({ id: 'rc_ca', name: 'CA retainer (quarterly)', type: 'outflow', categoryId: 'cat_ca', departmentId: 'dep_fin', partyId: 'vn_ca', description: 'Accounting & compliance retainer', taxable: 45000, gstRate: 18, tdsRate: 10, paymentMode: 'NEFT', accountId: 'acc_hdfc', dayOfMonth: 18, frequency: 'quarterly', startDate: '2025-06-01' });
  R({ id: 'rc_ret_nw', name: 'Northwind design retainer', type: 'inflow', categoryId: 'cat_retain', departmentId: 'dep_design', partyId: 'cl_nw', projectId: 'pr_ret_nw', description: 'Monthly design support retainer', taxable: 150000, gstRate: 18, tdsRate: 10, paymentMode: 'NEFT', accountId: 'acc_hdfc', dayOfMonth: 10 });
  R({ id: 'rc_ret_vl', name: 'Veloce engineering retainer', type: 'inflow', categoryId: 'cat_retain', departmentId: 'dep_eng', partyId: 'cl_vl', projectId: 'pr_ret_vl', description: 'Monthly engineering support retainer', taxable: 120000, gstRate: 18, tdsRate: 10, paymentMode: 'RTGS', accountId: 'acc_icici', dayOfMonth: 12, startDate: '2025-10-01' });
  EMP.forEach(emp => {
    const [id, n, dep, , , join] = emp; const sal = hike(emp[4]);
    R({ id: 'rc_' + id, name: 'Salary – ' + n, type: 'outflow', categoryId: id === 'em_ceo' ? 'cat_ceo' : 'cat_sal', departmentId: dep, partyId: id, description: 'Monthly salary', taxable: sal, tdsRate: salTds(sal), paymentMode: 'NEFT', accountId: 'acc_hdfc', dayOfMonth: 31, startDate: join > OPEN ? join : OPEN });
  });

  /* post recurring history */
  const yesterday = addDays(TODAY, -1);
  const curYm = ymOf(TODAY);
  for (const r of D.recurring) {
    for (const p of recurringPeriods(r, yesterday)) {
      if (r.id === 'rc_house' && p.period === curYm) continue; // left overdue on purpose
      const o = { type: r.type, date: p.dueDate, categoryId: r.categoryId, departmentId: r.departmentId, partyId: r.partyId, projectId: r.projectId, description: r.description, taxable: r.taxable, gstRate: r.gstRate, gstType: r.gstType, tdsRate: r.tdsRate, paymentMode: r.paymentMode, accountId: r.accountId, recurringId: r.id, recurringPeriod: p.period };
      const m = +p.period.slice(5);
      if (r.id === 'rc_elec') o.taxable = r100(m >= 4 && m <= 6 ? rint(32000, 38500) : rint(21000, 28500));
      if (r.id === 'rc_soft' && p.period < '2026-04') o.taxable = 48000;
      if (r.id === 'rc_pantry') o.taxable = r100(rint(9000, 14000));
      if (r.id.startsWith('rc_em_')) {
        const emp = EMP.find(x => 'rc_' + x[0] === r.id); o.taxable = salaryFor(emp, p.period); o.tdsRate = salTds(o.taxable);
        o.description = 'Salary – ' + monthLabel(p.period, true);
      }
      if (r.id === 'rc_rent') o.refNo = 'SR/' + p.period.replace('-', '') + '/402';
      if (r.type === 'inflow') o.refNo = 'INV/' + (fyOf(p.dueDate) % 100) + '-' + ((fyOf(p.dueDate) + 1) % 100) + '/R' + p.period.replace('-', '');
      add(o);
    }
  }

  /* project milestone receipts */
  let invNo = { 2025: 40, 2026: 30 };
  for (const [id, code, name, cl, dep, fee, ms] of PRJ) {
    const ord = O({ id: 'or_' + id.slice(3), orderNo: '4500' + rint(100000, 999999), date: addDays(ms[0][0], -21), clientId: cl, projectId: id, departmentId: dep, taxable: fee,
      scope: name + ' – concept to production-ready design', terms: ms.map(([, pc], i) => ({ label: ['Concept sign-off', 'Detailed design', 'Production release'][i] || 'Milestone ' + (i + 1), pct: pc })),
      expectedCompletion: addDays(ms[ms.length - 1][0], 10), contact: contacts[cl], status: ms[ms.length - 1][0] < addDays(TODAY, -60) ? 'closed' : 'active' });
    ms.forEach(([date, pct], i) => {
      const fy = fyOf(date); invNo[fy] = (invNo[fy] || 0) + 1;
      const piDate = addDays(date, -rint(14, 26));
      const pi = piDate < TODAY ? PI({ id: 'pi_' + id.slice(3) + '_' + i, orderId: ord.id, date: piDate, milestone: ord.terms[i].label + ` (${pct}%)`, taxable: Math.round(fee * pct / 100) }) : null;
      if (pi && date < TODAY) pi.taxInvoiceNo = `TI/${fy % 100}-${(fy + 1) % 100}/${String(invNo[fy]).padStart(3, '0')}`;
      add({ piId: pi ? pi.id : null, type: 'inflow', date, categoryId: id === 'pr_2604' ? 'cat_consult' : (dep === 'dep_eng' ? 'cat_reng' : 'cat_rdesign'), departmentId: dep, partyId: cl, projectId: id,
        description: `${code} milestone ${i + 1} of ${ms.length} (${pct}%)`, refNo: `INV/${fy % 100}-${(fy + 1) % 100}/${pad2(invNo[fy]).padStart(3, '0')}`,
        taxable: Math.round(fee * pct / 100), gstRate: 18, tdsRate: 10, paymentMode: pick(['NEFT', 'RTGS']), accountId: ['cl_ar', 'cl_zp', 'cl_ks'].includes(cl) ? 'acc_icici' : 'acc_hdfc' });
    });
    // direct project costs
    const start = addDays(ms[0][0], -14), end = ms[ms.length - 1][0], span = Math.max(20, diffDays(end, start));
    const costs = dep === 'dep_eng'
      ? [['vn_cnc', 'cat_vserv', 'CNC machining – prototype parts', 90000, 320000, 18, 2], ['vn_proto', 'cat_proto', 'SLA / FDM prototypes', 60000, 220000, 18, 2], ['vn_lab', 'cat_test', 'IP / thermal testing', 85000, 210000, 18, 2]]
      : [['vn_fl_rohan', 'cat_free', 'Product visualisation renders', 35000, 120000, 0, 10], ['vn_proto', 'cat_proto', 'Appearance model', 70000, 260000, 18, 2], ['vn_fl_ananya', 'cat_free', 'User research sessions', 40000, 110000, 0, 10]];
    costs.forEach(([v, cat, desc, lo, hi, g, t]) => {
      const n = rnd() < 0.4 ? 2 : 1;
      for (let k = 0; k < n; k++) add({ type: 'outflow', date: addDays(start, rint(10, span)), categoryId: cat, departmentId: dep, partyId: v, projectId: id, description: `${code} · ${desc}`, refNo: 'BILL-' + rint(1000, 9999), taxable: r100(rint(lo, hi) / n), gstRate: g, tdsRate: t, paymentMode: 'NEFT', accountId: rnd() < 0.7 ? 'acc_hdfc' : 'acc_icici' });
    });
  }
  const activeProjects = date => D.projects.filter(p => { const x = PRJ.find(y => y[0] === p.id); if (!x) return false; const m = x[6]; return addDays(m[0][0], -21) <= date && date <= m[m.length - 1][0]; });

  /* monthly non-recurring activity */
  const months = []; for (let ym = '2025-04'; ym <= curYm; ym = addMonths(ym, 1)) months.push(ym);
  const travelDesc = ['Flight – Mumbai ⇄ Delhi (client review)', 'Hotel – Pune factory visit', 'Flight – Mumbai ⇄ Bengaluru', 'Train + cab – Nashik plant visit', 'Hotel – Ahmedabad vendor audit', 'Flight – Mumbai ⇄ Chennai'];
  const reimbDesc = ['Local conveyance – client meeting', 'Cab fare – late-night delivery', 'Urgent material purchase', 'Client lunch', 'Mobile bill reimbursement'];
  const supplies = [['Stationery', 'dep_ops'], ['Printer toner', 'dep_ops'], ['Pantry groceries', 'dep_hr'], ['Cleaning supplies', 'dep_ops'], ['Model-making consumables', 'dep_design'], ['Batteries & cables', 'dep_eng']];
  const employees = EMP.filter(e => e[0] !== 'em_ceo');
  for (const ym of months) {
    add({ type: 'transfer', date: ymDate(ym, 2), amount: 15000, accountId: 'acc_hdfc', toAccountId: 'acc_cash', paymentMode: 'Cheque', description: 'Petty cash top-up' });
    for (let k = rint(3, 5); k > 0; k--) { const [d, dep] = pick(supplies); add({ type: 'outflow', date: ymDate(ym, rint(3, 27)), categoryId: 'cat_supplies', departmentId: dep, partyId: 'vn_office', description: d, taxable: r100(rint(600, 5200)), paymentMode: 'Cash', accountId: 'acc_cash', txnRef: '' }); }
    for (let k = rint(2, 3); k > 0; k--) { const pr = pick(activeProjects(ymDate(ym, 15))); add({ type: 'outflow', date: ymDate(ym, rint(3, 27)), categoryId: 'cat_print', departmentId: pr ? pr.departmentId : 'dep_ops', partyId: 'vn_courier', projectId: pr ? pr.id : null, description: pick(['Prototype dispatch to client', 'Documents courier', 'Sample return courier']), taxable: r100(rint(350, 2400)), paymentMode: 'Cash', accountId: 'acc_cash', txnRef: '' }); }
    for (let k = rint(2, 4); k > 0; k--) {
      const dep = pick(['dep_sales', 'dep_sales', 'dep_design', 'dep_eng', 'dep_mgmt']); const pr = rnd() < 0.5 ? pick(activeProjects(ymDate(ym, 15))) : null;
      add({ type: 'outflow', date: ymDate(ym, rint(2, 27)), categoryId: 'cat_travel', departmentId: pr ? pr.departmentId : dep, partyId: 'vn_travel', projectId: pr ? pr.id : null, description: pick(travelDesc), refNo: 'TD' + rint(100000, 999999), taxable: r100(rint(6000, 42000)), gstRate: 5, paymentMode: 'Card', accountId: 'acc_hdfc' });
    }
    for (let k = rint(1, 3); k > 0; k--) {
      const emp = pick(employees); if (emp[5] > ymDate(ym, 1)) continue;
      add({ type: 'outflow', date: ymDate(ym, rint(5, 26)), categoryId: 'cat_reimb', departmentId: emp[2], partyId: emp[0], description: pick(reimbDesc), taxable: r100(rint(1200, 8500)), paymentMode: 'UPI', accountId: 'acc_icici' });
    }
    add({ type: 'outflow', date: ymDate(ym, 28), categoryId: 'cat_bank', departmentId: 'dep_fin', partyId: 'ot_hdfc', description: 'Bank charges (NEFT / RTGS / SMS)', taxable: rint(35, 110) * 10, gstRate: 18, paymentMode: 'Auto-debit', accountId: 'acc_hdfc', txnRef: '' });
  }

  /* consulting one-offs: email-confirmed orders */
  [['pr_25c1', 'cl_zp', 'dep_design', 250000, '2025-08-25', '2025-09-02'], ['pr_25c2', 'cl_md', 'dep_eng', 180000, '2026-01-12', '2026-01-20'], ['pr_26c1', 'cl_sl', 'dep_design', 220000, '2026-07-10', '2026-07-18']]
    .forEach(([pid, cl, dep, v, od, pd]) => { const o = O({ id: 'or_' + pid.slice(3), orderNo: 'EMAIL ' + fmtDate(od), type: 'Email', date: od, clientId: cl, projectId: pid, departmentId: dep, taxable: v, scope: D.projects.find(x => x.id === pid).name, terms: [{ label: '100% on completion', pct: 100 }], contact: contacts[cl], status: 'closed' });
      PI({ id: 'pi_' + pid.slice(3), orderId: o.id, date: pd, dueDate: addDays(pd, 21), milestone: '100% on completion', taxable: v }); });
  /* retainer contracts — one order per contract year, a PI on the 1st of every month */
  const retOrders = { cl_nw: [O({ id: 'or_ret_nw_25', orderNo: 'NW/RET/2025-26', type: 'Contract', date: '2025-03-20', clientId: 'cl_nw', projectId: 'pr_ret_nw', departmentId: 'dep_design', taxable: 1800000, scope: 'Design support retainer, Apr 2025 – Mar 2026', terms: [{ label: 'Monthly in advance × 12', pct: 100 }], contact: contacts.cl_nw, status: 'closed' }),
                                O({ id: 'or_ret_nw_26', orderNo: 'NW/RET/2026-27', type: 'Contract', date: '2026-03-18', clientId: 'cl_nw', projectId: 'pr_ret_nw', departmentId: 'dep_design', taxable: 1800000, scope: 'Design support retainer, Apr 2026 – Mar 2027', terms: [{ label: 'Monthly in advance × 12', pct: 100 }], contact: contacts.cl_nw })],
                    cl_vl: [O({ id: 'or_ret_vl_25', orderNo: 'VEL-SA-0925', type: 'Contract', date: '2025-09-20', clientId: 'cl_vl', projectId: 'pr_ret_vl', departmentId: 'dep_eng', taxable: 1440000, scope: 'Engineering support, Oct 2025 – Sep 2026', terms: [{ label: 'Monthly × 12', pct: 100 }], contact: contacts.cl_vl, status: 'closed' }),
                            O({ id: 'or_ret_vl_26', orderNo: 'VEL-SA-1026', type: 'Contract', date: '2026-09-24', clientId: 'cl_vl', projectId: 'pr_ret_vl', departmentId: 'dep_eng', taxable: 1440000, scope: 'Engineering support renewal, Oct 2026 – Sep 2027', terms: [{ label: 'Monthly × 12', pct: 100 }], contact: contacts.cl_vl })] };
  for (const r of D.recurring.filter(x => x.id === 'rc_ret_nw' || x.id === 'rc_ret_vl')) {
    for (const per of recurringPeriods(r, addDays(TODAY, 40))) {
      const d1 = per.period + '-01'; if (d1 > TODAY) continue;
      const ords = retOrders[r.partyId]; const ord = r.partyId === 'cl_nw' ? ords[fyOf(d1) === 2025 ? 0 : 1] : ords[d1 >= '2026-10-01' ? 1 : 0];
      const pi = PI({ id: 'pi_' + r.id.slice(3) + '_' + per.period, orderId: ord.id, date: d1, dueDate: per.dueDate, milestone: 'Retainer – ' + monthLabel(per.period, true), taxable: r.taxable });
      const rcpt = D.entries.find(e => e.recurringId === r.id && e.recurringPeriod === per.period);
      if (rcpt) { rcpt.piId = pi.id; pi.taxInvoiceNo = rcpt.refNo; }
    }
  }
  /* recent orders: unpaid / part-paid / not yet invoiced */
  const o5 = O({ id: 'or_2605', orderNo: '4500' + rint(100000, 999999), date: '2026-07-08', clientId: 'cl_nw', projectId: 'pr_2605', departmentId: 'dep_design', taxable: 1800000, scope: 'Smart kettle – CMF strategy and form development', terms: [{ label: 'Kick-off advance', pct: 30 }, { label: 'Design freeze', pct: 40 }, { label: 'Handover', pct: 30 }], expectedCompletion: '2026-12-20', contact: contacts.cl_nw });
  PI({ id: 'pi_2605_0', orderId: o5.id, date: '2026-07-20', dueDate: '2026-08-19', milestone: 'Kick-off advance (30%)', taxable: 540000 });
  const o6 = O({ id: 'or_2606', orderNo: '4500' + rint(100000, 999999), date: '2026-08-25', clientId: 'cl_md', projectId: 'pr_2606', departmentId: 'dep_eng', taxable: 2200000, scope: 'Busbar trunking enclosure – engineering & DFM', terms: [{ label: 'Advance', pct: 40 }, { label: 'Prototype approval', pct: 40 }, { label: 'Release', pct: 20 }], expectedCompletion: '2027-02-28', contact: contacts.cl_md });
  PI({ id: 'pi_2606_0', orderId: o6.id, date: '2026-09-01', dueDate: '2026-10-01', milestone: 'Advance (40%)', taxable: 880000 });
  O({ id: 'or_2607', orderNo: 'LOI-VEL-2026-14', type: 'LOI', date: '2026-10-03', clientId: 'cl_vl', projectId: 'pr_2607', departmentId: 'dep_eng', taxable: 2600000, scope: 'IoT sensor housing – industrial design + mechanical engineering', terms: [{ label: 'Advance', pct: 30 }, { label: 'Design freeze', pct: 40 }, { label: 'Production release', pct: 30 }], expectedCompletion: '2027-03-31', contact: contacts.cl_vl });
  // amendment example
  const am = D.orders.find(o => o.id === 'or_2508'); if (am) { am.amendments.push({ date: addDays(am.date, 40), by: 'u_owner', from: 5000000, to: 5500000, note: 'Scope extended: second variant (under-sink model)' }); }

  /* one-offs */
  const once = [
    { type: 'outflow', date: '2025-05-20', categoryId: 'cat_equip', departmentId: 'dep_design', partyId: 'vn_hw', description: '3 × CAD workstations (RTX 4070)', refNo: 'THS/2526/118', taxable: 420000, gstRate: 18, paymentMode: 'RTGS', createdBy: 'u_owner' },
    { type: 'outflow', date: '2025-11-10', categoryId: 'cat_furn', departmentId: 'dep_ops', partyId: 'vn_wood', description: 'Studio fit-out – model shop benches', refNo: 'WI/882', taxable: 360000, gstRate: 18, tdsRate: 2, paymentMode: 'NEFT', createdBy: 'u_owner' },
    { type: 'outflow', date: '2026-01-20', categoryId: 'cat_lic', departmentId: 'dep_eng', partyId: 'vn_soft', description: 'Simulation software – perpetual licence', refNo: 'CS/INV/7781', taxable: 180000, gstRate: 18, paymentMode: 'NEFT', createdBy: 'u_owner' },
    { type: 'outflow', date: '2026-06-12', categoryId: 'cat_equip', departmentId: 'dep_eng', partyId: 'vn_hw', description: 'Resin 3D printer + curing station', refNo: 'THS/2627/041', taxable: 285000, gstRate: 18, paymentMode: 'RTGS', createdBy: 'u_owner' },
    { type: 'outflow', date: '2025-07-15', categoryId: 'cat_legal', departmentId: 'dep_mgmt', partyId: 'vn_legal', description: 'MSA review – Veloce', taxable: 38000, gstRate: 18, tdsRate: 10, createdBy: 'u_owner' },
    { type: 'outflow', date: '2025-12-09', categoryId: 'cat_legal', departmentId: 'dep_mgmt', partyId: 'vn_legal', description: 'NDA set + IP assignment templates', taxable: 52000, gstRate: 18, tdsRate: 10, createdBy: 'u_owner' },
    { type: 'outflow', date: '2026-05-21', categoryId: 'cat_legal', departmentId: 'dep_mgmt', partyId: 'vn_legal', description: 'Employee agreement revision', taxable: 45000, gstRate: 18, tdsRate: 10, createdBy: 'u_owner' },
    { type: 'outflow', date: '2026-08-19', categoryId: 'cat_legal', departmentId: 'dep_mgmt', partyId: 'vn_legal', description: 'Contract negotiation support – Arcadia', taxable: 28000, gstRate: 18, tdsRate: 10, createdBy: 'u_owner' },
    { type: 'outflow', date: '2025-12-20', categoryId: 'cat_welfare', departmentId: 'dep_hr', partyId: 'vn_travel', description: 'Team offsite – Lonavala', taxable: 120000, gstRate: 18, paymentMode: 'Card' },
    { type: 'outflow', date: '2025-08-11', categoryId: 'cat_repair', departmentId: 'dep_ops', partyId: 'vn_hw', description: 'AC servicing (4 units)', taxable: 9800, gstRate: 18, accountId: 'acc_icici' },
    { type: 'outflow', date: '2025-12-02', categoryId: 'cat_repair', departmentId: 'dep_ops', partyId: 'vn_hw', description: 'UPS battery replacement', taxable: 14200, gstRate: 18, accountId: 'acc_icici' },
    { type: 'outflow', date: '2026-04-15', categoryId: 'cat_repair', departmentId: 'dep_ops', partyId: 'vn_hw', description: 'AC servicing (4 units)', taxable: 10400, gstRate: 18, accountId: 'acc_icici' },
    { type: 'outflow', date: '2026-08-22', categoryId: 'cat_repair', departmentId: 'dep_ops', partyId: 'vn_hw', description: 'Plotter repair', taxable: 6500, gstRate: 18, accountId: 'acc_icici' },
    { type: 'outflow', date: '2025-10-28', categoryId: 'cat_draw', departmentId: 'dep_mgmt', partyId: 'ot_owner', description: 'Owner drawings', taxable: 200000, createdBy: 'u_owner' },
    { type: 'outflow', date: '2026-03-30', categoryId: 'cat_draw', departmentId: 'dep_mgmt', partyId: 'ot_owner', description: 'Owner drawings', taxable: 300000, createdBy: 'u_owner' },
    { type: 'outflow', date: '2026-09-29', categoryId: 'cat_draw', departmentId: 'dep_mgmt', partyId: 'ot_owner', description: 'Owner drawings', taxable: 150000, createdBy: 'u_owner' },
    { type: 'inflow', date: '2025-09-18', categoryId: 'cat_consult', departmentId: 'dep_design', partyId: 'cl_zp', projectId: 'pr_25c1', piId: 'pi_25c1', description: 'Design audit workshop', refNo: 'INV/25-26/C01', taxable: 250000, gstRate: 18, tdsRate: 10, accountId: 'acc_icici' },
    { type: 'inflow', date: '2026-02-05', categoryId: 'cat_consult', departmentId: 'dep_eng', partyId: 'cl_md', projectId: 'pr_25c2', piId: 'pi_25c2', description: 'DFM review – switchgear range', refNo: 'INV/25-26/C02', taxable: 180000, gstRate: 18, tdsRate: 10 },
    { type: 'inflow', date: '2026-08-04', categoryId: 'cat_consult', departmentId: 'dep_design', partyId: 'cl_sl', projectId: 'pr_26c1', piId: 'pi_26c1', description: 'Brand-to-product language workshop', refNo: 'INV/26-27/C01', taxable: 220000, gstRate: 18, tdsRate: 10 },
    { type: 'inflow', date: '2026-03-25', categoryId: 'cat_othinc', departmentId: 'dep_ops', partyId: 'ot_owner', description: 'Sale of old laptops (scrap)', taxable: 45000, paymentMode: 'UPI', accountId: 'acc_icici' },
    { type: 'inflow', date: '2025-12-15', categoryId: 'cat_capital', departmentId: 'dep_mgmt', partyId: 'ot_owner', description: 'Owner capital infusion', taxable: 500000, paymentMode: 'RTGS', createdBy: 'u_owner' },
    { type: 'transfer', date: '2026-01-28', amount: 1000000, accountId: 'acc_hdfc', toAccountId: 'acc_fd', paymentMode: 'NEFT', description: 'New FD – 12 months @ 7.1%', createdBy: 'u_owner' },
  ];
  once.forEach(o => add({ accountId: 'acc_hdfc', ...o }));
  add({ type: 'inflow', date: '2026-09-10', categoryId: 'cat_rdesign', departmentId: 'dep_design', partyId: 'cl_nw', projectId: 'pr_2605', piId: 'pi_2605_0', description: 'IU-2605 advance – part payment', refNo: 'TI/26-27/061', taxable: 270000, gstRate: 18, tdsRate: 10, paymentMode: 'NEFT' });
  // Diwali bonus Oct 2025
  employees.forEach(emp => { if (emp[5] <= '2025-10-01') add({ type: 'outflow', date: '2025-10-17', categoryId: 'cat_bonus', departmentId: emp[2], partyId: emp[0], description: 'Diwali bonus 2025', taxable: Math.round(emp[4] * 0.5), tdsRate: salTds(emp[4]), paymentMode: 'NEFT', accountId: 'acc_hdfc', createdBy: 'u_owner' }); });
  // Advance tax
  [['2025-06-13', 150000], ['2025-09-12', 300000], ['2025-12-12', 300000], ['2026-03-13', 250000], ['2026-06-12', 175000], ['2026-09-14', 325000]]
    .forEach(([d, a], i) => add({ type: 'outflow', date: d, categoryId: 'cat_advtax', departmentId: 'dep_fin', partyId: 'ot_it', description: `Advance tax – instalment ${(i % 4) + 1}`, refNo: 'CHALLAN-280', taxable: a, paymentMode: 'NEFT' }));
  // FD interest (quarter-ends)
  ['2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30'].forEach(d => {
    const principal = d >= '2026-03-31' ? 3500000 : 2500000; const amt = Math.round(principal * 0.071 / 4);
    add({ type: 'inflow', date: d, categoryId: 'cat_fdint', departmentId: 'dep_fin', partyId: 'ot_hdfc', description: 'FD interest – quarter', taxable: amt, tdsRate: 10, paymentMode: 'NEFT', accountId: 'acc_hdfc', txnRef: '' });
  });

  /* statutory: TDS (7th) & GST (20th) for previous month */
  const monthEntries = ym => D.entries.filter(e => ymOf(e.date) === ym);
  for (const ym of months) {
    const prev = addMonths(ym, -1); const pe = monthEntries(prev);
    const tds = ym === '2025-04' ? 112400 : sum(pe.filter(e => e.type === 'outflow'), e => e.tdsAmount);
    if (tds > 0) add({ type: 'outflow', date: ymDate(ym, 7), categoryId: 'cat_tdsdep', departmentId: 'dep_fin', partyId: 'ot_it', description: 'TDS deposit for ' + monthLabel(prev, true), taxPeriod: prev, refNo: 'CHALLAN-281', taxable: Math.round(tds), paymentMode: 'NEFT' });
    const gst = ym === '2025-04' ? 286500 : sum(pe.filter(e => e.type === 'inflow'), e => e.gstAmount) - sum(pe.filter(e => e.type === 'outflow' && e.itc), e => e.gstAmount);
    if (gst > 0) add({ type: 'outflow', date: ymDate(ym, 20), categoryId: 'cat_gstpay', departmentId: 'dep_fin', partyId: 'ot_gst', description: 'GSTR-3B liability for ' + monthLabel(prev, true), taxPeriod: prev, refNo: 'GST-PMT-06', taxable: Math.round(gst), paymentMode: 'NEFT' });
  }

  /* ICICI → HDFC sweeps when ICICI runs high */
  for (const ym of months) {
    const end = ymDate(ym, 26); if (end >= TODAY) break;
    let b = 640000;
    for (const e of D.entries) { if (e.date > end) continue; if (e.type === 'inflow' && e.accountId === 'acc_icici') b += e.amount; if (e.type === 'outflow' && e.accountId === 'acc_icici') b -= e.amount; if (e.type === 'transfer') { if (e.accountId === 'acc_icici') b -= e.amount; if (e.toAccountId === 'acc_icici') b += e.amount; } }
    if (b > 1200000) add({ type: 'transfer', date: end, amount: Math.round((b - 500000) / 10000) * 10000, accountId: 'acc_icici', toAccountId: 'acc_hdfc', paymentMode: 'NEFT', description: 'Sweep to operating account' });
  }

  D.entries.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  /* audit trail, edits, deletions, locks */
  const A = (ts, userId, action, entity, entityId, summary, changes = []) => D.audit.push({ id: 'log_' + (D.audit.length + 1).toString(36), ts, userId, action, entity, entityId, summary, changes });
  Store.data = D; // describe() reads names from Store
  for (const e of D.entries) A(e.createdAt, e.createdBy, 'create', 'entries', e.id, describe('entries', e));
  const recentElec = D.entries.filter(e => e.recurringId === 'rc_elec').slice(-5);
  recentElec.forEach(e => {
    const ts = addDays(e.date, 2) + 'T06:10:00.000Z'; if (ts.slice(0, 10) >= TODAY) return;
    e.updatedBy = 'u_acct'; e.updatedAt = ts;
    A(ts, 'u_acct', 'update', 'entries', e.id, describe('entries', e), [{ field: 'taxable', from: money(27000), to: money(e.taxable) }, { field: 'amount', from: money(27000), to: money(e.amount) }]);
  });
  D.entries.filter(e => e.categoryId === 'cat_travel').slice(-3).forEach(e => {
    const ts = addDays(e.date, 1) + 'T08:30:00.000Z'; if (ts.slice(0, 10) >= TODAY) return;
    e.updatedBy = 'u_owner'; e.updatedAt = ts; e.notes = 'Re-tagged to correct department';
    A(ts, 'u_owner', 'update', 'entries', e.id, describe('entries', e), [{ field: 'notes', from: '—', to: e.notes }]);
  });
  D.entries.filter(e => e.categoryId === 'cat_print').slice(-2).forEach(e => {
    const dup = { ...e, id: e.id + 'd', createdAt: e.createdAt.replace(/T\d\d/, 'T13'), deleted: true, deletedBy: 'u_owner', deletedAt: addDays(e.date, 1) + 'T05:00:00.000Z' };
    D.entries.push(dup);
    A(dup.createdAt, 'u_acct', 'create', 'entries', dup.id, describe('entries', dup));
    A(dup.deletedAt, 'u_owner', 'delete', 'entries', dup.id, describe('entries', dup) + ' (duplicate)');
  });
  fyMonths(2025).forEach(ym => { D.settings.lockedMonths.push(ym); A('2026-05-10T05:30:00.000Z', 'u_owner', 'lock', 'settings', ym, 'Locked ' + monthLabel(ym, true)); });
  // PI numbers in date order, per FY
  const seqs = {};
  D.pis.sort((a, b) => a.date.localeCompare(b.date)).forEach(p => { const fy = fyOf(p.date); seqs[fy] = (seqs[fy] || 0) + 1; p.piNo = `IUOVA/PI/${pad2(fy % 100)}-${pad2((fy + 1) % 100)}/${String(seqs[fy]).padStart(3, '0')}`; });
  D.orders.sort((a, b) => a.date.localeCompare(b.date));
  for (const o of D.orders) { A(o.createdAt, o.createdBy, 'create', 'orders', o.id, describe('orders', o)); for (const m of o.amendments) A(m.date + 'T09:00:00.000Z', m.by, 'update', 'orders', o.id, describe('orders', o), [{ field: 'taxable', from: money(m.from), to: money(m.to) }]); }
  for (const p of D.pis) A(p.createdAt, p.createdBy, 'create', 'pis', p.id, describe('pis', p));
  D.targets = { 2025: { dep_design: Array(12).fill(1200000), dep_eng: Array(12).fill(1400000) }, 2026: { dep_design: Array(12).fill(1200000), dep_eng: Array(12).fill(1800000) } };
  A('2026-03-25T05:00:00.000Z', 'u_owner', 'update', 'targets', '2026', 'Revenue targets · FY 2026-27', [{ field: 'Design', from: money(0), to: money(14400000) }, { field: 'Engineering', from: money(0), to: money(21600000) }]);
  // sample email outbox: recent vendor payments & client receipts sent, a few still queued, one bounced
  const ES = D.settings.email; const recentE = D.entries.filter(e => !e.deleted && e.date >= addDays(TODAY, -45)).map(e => ({ e, k: entryEmailKind(e) })).filter(x => x.k && partyEmails(party(x.e.partyId)).length);
  recentE.forEach(({ e, k }, i) => {
    const vars = entryEmailVars(e), t = ES.templates[k]; const ts = e.createdAt; const st = e.date >= addDays(TODAY, -3) ? 'queued' : i === 3 ? 'failed' : 'sent';
    const m = { id: 'em_' + e.id, kind: k, entity: 'entries', entityId: e.id, partyId: e.partyId, from: ES.from, to: partyEmails(party(e.partyId)).slice(0, 1), cc: [], subject: fillTemplate(t.subject, vars), body: fillTemplate(t.body, vars), attachments: [], status: st,
      sentAt: st === 'sent' ? addDays(ts.slice(0, 10), 0) + 'T' + ts.slice(11, 16) + ':30.000Z' : null, error: st === 'failed' ? '550 Mailbox unavailable (test data)' : null, events: [{ ts, status: 'queued', by: e.createdBy }], createdBy: e.createdBy, createdAt: ts, deleted: false };
    if (st !== 'queued') m.events.push({ ts: ts.slice(0, 17) + '45.000Z', status: st, by: 'system', note: st === 'failed' ? m.error : 'Delivered by mail server (test data)' });
    D.emails.push(m); A(ts, e.createdBy, 'create', 'emails', m.id, describe('emails', m));
  });
  D.pis.filter(p => p.date >= addDays(TODAY, -45)).forEach(p => {
    const vars = piEmailVars(p), t = ES.templates.pi_issued;
    const m = { id: 'em_' + p.id, kind: 'pi_issued', entity: 'pis', entityId: p.id, partyId: p.clientId, from: ES.from, to: partyEmails(party(p.clientId)), cc: [], subject: fillTemplate(t.subject, vars), body: fillTemplate(t.body, vars), attachments: [], status: 'sent', sentAt: p.createdAt, error: null, events: [{ ts: p.createdAt, status: 'queued', by: p.createdBy }, { ts: p.createdAt, status: 'sent', by: 'system', note: 'Delivered (test data)' }], createdBy: p.createdBy, createdAt: p.createdAt, deleted: false };
    D.emails.push(m); A(p.createdAt, p.createdBy, 'create', 'emails', m.id, describe('emails', m));
  });
  /* compliance filings already done, TDS certificates received, advance-tax estimate */
  {
    const C = D.compliance, mark = (k, at, ref) => { C[k] = { done: true, at: at + 'T11:00:00.000Z', by: 'u_acct', ref }; };
    for (let ym = '2025-04'; ym < '2026-09'; ym = addMonths(ym, 1)) { const nx = addMonths(ym, 1); mark('gstr1:' + ym, ymDate(nx, 10), 'ARN-G1-' + ym.replace('-', '')); mark('gstr3b:' + ym, ymDate(nx, 19), 'ARN-3B-' + ym.replace('-', '')); }
    [[2025, 0], [2025, 1], [2025, 2], [2025, 3], [2026, 0]].forEach(([fy, q]) => { const due = ['07-31', '10-31', '01-31', '05-31'][q], y = q === 3 ? fy + 1 : q === 2 ? fy + 1 : fy; ['24Q', '26Q'].forEach(f => mark('tdsret' + f + ':' + fy + 'Q' + (q + 1), y + '-' + due.replace(/31$/, '28'), 'PRN-' + f + '-' + fy + q)); mark('f16a:' + fy + 'Q' + (q + 1), (q === 3 ? fy + 1 : q === 2 ? fy + 1 : fy) + '-' + ['08-12', '11-12', '02-12', '06-12'][q], ''); });
    mark('gstr9:2024', '2025-12-20', 'ARN-G9-2425'); mark('itr:2024', '2025-10-25', 'ACK-ITR-2425'); mark('audit:2024', '2025-09-26', 'UDIN-3CD-2425'); mark('audit:2025', '2026-09-24', 'UDIN-3CD-2526');
    const qOf = d => { const m = +d.slice(5, 7); return m >= 4 && m <= 6 ? 0 : m >= 7 && m <= 9 ? 1 : m >= 10 ? 2 : 3; };
    const seen = new Set();
    D.entries.filter(e => !e.deleted && e.type === 'inflow' && +e.tdsAmount > 0 && party(e.partyId) && party(e.partyId).kind === 'client').forEach(e => {
      const fy = fyOf(e.date), q = qOf(e.date), k = e.partyId + '|' + fy + '|' + q; if (seen.has(k)) return; seen.add(k);
      const qEnd = fyMonths(fy)[q * 3 + 2]; const issueBy = addDays(ymDate(addMonths(qEnd, 1), 1), q === 3 ? 75 : 45);
      if (issueBy > TODAY) return;
      if (fy === 2026 && ['cl_vl', 'cl_sl'].includes(e.partyId)) return;
      D.tdsCerts.push({ id: 'tc_' + k.replace(/\|/g, '_'), clientId: e.partyId, fy, q, received: true, receivedAt: addDays(issueBy, rint(-6, 6)), certNo: 'TRACES-' + (e.partyId.slice(3).toUpperCase()) + fy + 'Q' + (q + 1), note: '', createdBy: 'u_acct', createdAt: issueBy + 'T10:00:00.000Z' });
    });
    const adv = sum(D.entries.filter(e => !e.deleted && e.categoryId === 'cat_advtax' && fyOf(e.date) === 2025), e => e.amount);
    D.settings.compliance = { gstFreq: 'monthly', ptMonthly: true, advTaxEstimate: Math.round(adv * 1.1 / 1000) * 1000, items: { tds: true, gstr1: true, gstr3b: true, pt: true, adv: true, tdsret: true, f16a: true, gstr9: true, itr: true } };
    D.settings.udyamNo = 'UDYAM-MH-19-0012345';
  }
  /* GST: tax invoice issued on the day the client pays; bill no. / bill date on vendor bills; blocked ITC; one export client */
  {
    const recByPi = {}; D.entries.filter(e => !e.deleted && e.piId).sort((a, b) => a.date.localeCompare(b.date)).forEach(e => { (recByPi[e.piId] = recByPi[e.piId] || []).push(e); });
    D.pis.forEach(pi => { const r = recByPi[pi.id]; if (r && r.length) pi.taxInvoiceDate = r[0].date; else { pi.taxInvoiceNo = ''; pi.taxInvoiceDate = null; } });
    const invSeq = {}; D.pis.filter(pi => pi.taxInvoiceDate).sort((a, b) => a.taxInvoiceDate.localeCompare(b.taxInvoiceDate) || a.id.localeCompare(b.id)).forEach(pi => { const fy = fyOf(pi.taxInvoiceDate); invSeq[fy] = (invSeq[fy] || 0) + 1; pi.taxInvoiceNo = `INV/${String(fy % 100).padStart(2, '0')}-${String((fy + 1) % 100).padStart(2, '0')}/${String(invSeq[fy]).padStart(3, '0')}`; recByPi[pi.id].forEach(e => { e.refNo = pi.taxInvoiceNo; }); });
    { const hb = party('ot_hdfc'); if (hb) { hb.gstin = '27AAACH2702H1ZX'; hb.gstType = 'intra'; hb.stateCode = '27'; } }
    const ABBR = {}; const billSeq = {};
    D.entries.filter(e => !e.deleted && e.type === 'outflow' && +e.gstAmount > 0).forEach(e => {
      const p = party(e.partyId); const ab = ABBR[e.partyId] || (ABBR[e.partyId] = (p ? p.name : 'BILL').replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase() || 'BL');
      const fy = fyOf(e.date); billSeq[e.partyId + fy] = (billSeq[e.partyId + fy] || rint(20, 300)) + 1;
      if (!e.refNo) e.refNo = `${ab}/${String(fy % 100).padStart(2, '0')}-${String((fy + 1) % 100).padStart(2, '0')}/${billSeq[e.partyId + fy]}`;
      const day = +e.date.slice(8); e.billDate = addDays(e.date, -Math.min(day - 1, e.recurringId ? rint(0, 4) : rint(0, 9)));
      if (e.categoryId === 'cat_welfare') e.itc = false;
    });
    D.categories.forEach(c => { c.sac = CAT_GST[c.id] ? CAT_GST[c.id][0] : ''; c.itcBlocked = !!(CAT_GST[c.id] && CAT_GST[c.id][1]); });
    // export client under LUT
    P('cl_bl', 'client', 'Brightline Studio Inc.', { gstType: 'none', gstin: '', stateCode: '99', pan: '', address: '1450 Market St, San Francisco, CA, USA', pincode: '', creditDays: 30, tan: '', bank: null, contacts: [{ id: 'ct0', name: 'Emily Carter', designation: 'Head of Product', email: 'emily@brightline.example', phone: '', whatsapp: false, tags: ['projects', 'management'] }, { id: 'ct1', name: 'Payables', designation: '', email: 'ap@brightline.example', phone: '', whatsapp: false, tags: ['accounts'] }], email: 'emily@brightline.example, ap@brightline.example' });
    D.projects.push({ id: 'pr_2609', code: 'IU-2609', name: 'Espresso Machine CMF (US)', clientId: 'cl_bl', departmentId: 'dep_design', contractValue: 0, startDate: '2026-06-10', status: 'active', active: true, createdBy: 'u_owner', createdAt: '2026-06-10T10:00:00.000Z' });
    const ob = O({ id: 'or_2609', orderNo: 'BL-PO-1182', type: 'Email', date: '2026-06-10', clientId: 'cl_bl', projectId: 'pr_2609', departmentId: 'dep_design', taxable: 1200000, scope: 'CMF and finish strategy for US espresso range', terms: [{ label: 'Advance', pct: 50 }, { label: 'Final CMF book', pct: 50 }], expectedCompletion: '2026-11-30', contact: 'Emily Carter (Head of Product)' });
    Object.assign(ob, { gstRate: 0, gstType: 'none', gstAmount: 0, total: ob.taxable });
    const pb = PI({ id: 'pi_2609_0', orderId: ob.id, date: '2026-06-15', dueDate: '2026-07-15', milestone: 'Advance (50%)', taxable: 600000 });
    Object.assign(pb, { gstRate: 0, gstType: 'none', gstAmount: 0, tdsRate: 0, tdsAmount: 0, total: 600000 });
    const rb = add({ piId: pb.id, type: 'inflow', date: '2026-07-08', categoryId: 'cat_rdesign', departmentId: 'dep_design', partyId: 'cl_bl', projectId: 'pr_2609', description: 'IU-2609 advance (50%) · USD 7,150 @ 83.92', refNo: 'EXP/26-27/004', taxable: 600000, gstRate: 0, tdsRate: 0, paymentMode: 'SWIFT', accountId: 'acc_hdfc' });
    if (rb) { pb.taxInvoiceNo = 'EXP/26-27/004'; pb.taxInvoiceDate = '2026-07-08'; }
    D.settings.gst = { caName: 'CA', caEmails: ['accounts@iuova.in'], invPrefix: 'INV/', cnPrefix: 'CN/', lut: 'AD270326012345X', openingCredit: { igst: 0, cgst: 0, sgst: 0 } };
    const gm = {}; for (let ym = '2025-04'; ym <= '2026-08'; ym = addMonths(ym, 1)) gm[ym] = { status: 'confirmed', sentAt: addMonths(ym, 1) + '-08T10:00:00.000Z', confirmedAt: addMonths(ym, 1) + '-10T16:00:00.000Z', by: 'u_acct', note: 'Confirmed by CA on email' };
    D.gstMonths = gm;
  }
  /* TDS payable: PANs, sections, one challan per section for each deduction month (earlier of bill / payment date) */
  {
    const L = 'ABCDEFGHJKLMNPRSTUVWXYZ'; let k = 0;
    const kindOfName = n => /pvt|ltd|limited/i.test(n) ? 'C' : /\(freelance/i.test(n) ? 'P' : 'F';
    const genPan = (t, n) => { k++; const nm = n.replace(/\(.*\)/, '').trim().split(/\s+/); const ini = ((t === 'P' ? nm[nm.length - 1] : nm[0]) || 'X')[0].toUpperCase(); return L[(k * 7) % 23] + L[(k * 11 + 3) % 23] + L[(k * 5 + 1) % 23] + t + ini + String(1000 + (k * 379) % 9000) + L[(k * 13) % 23]; };
    D.parties.filter(p => p.kind === 'vendor').forEach(p => { const t = kindOfName(p.name); let pan = p.pan || genPan(t, p.name); pan = pan.slice(0, 3) + t + p.name.replace(/\(.*\)/, '').trim().split(/\s+/)[t === 'P' ? 1 : 0][0].toUpperCase() + pan.slice(5); p.pan = pan; if (p.gstin) p.gstin = p.gstin.slice(0, 2) + pan + p.gstin.slice(12); });
    D.parties.filter(p => p.kind === 'employee').forEach(p => { p.pan = genPan('P', p.name); });
    const tdsE = D.entries.filter(e => !e.deleted && e.type === 'outflow' && e.categoryId !== 'cat_tdsdep' && +e.tdsAmount > 0);
    tdsE.forEach(e => { const p = party(e.partyId); e.tdsSection = p && p.kind === 'employee' ? '192' : (CAT_TDS[e.categoryId] || '194J'); if (!e.billDate && p && p.kind === 'vendor') e.billDate = addDays(e.date, -rint(0, 12)); });
    // one late freelancer payment with no TDS (aggregate already above the 194J limit) → shows up in Checks
    const fl = D.entries.filter(e => !e.deleted && e.partyId === 'vn_fl_ananya' && e.date >= '2026-08-01' && e.date < '2026-10-01')[0] || D.entries.filter(e => !e.deleted && e.partyId === 'vn_fl_rohan' && e.date >= '2026-07-01' && e.date < '2026-10-01')[0];
    if (fl) { fl.tdsRate = 0; fl.tdsAmount = 0; fl.amount = entryNet(fl); delete fl.tdsSection; }
    const tDate = e => e.billDate && e.billDate < e.date ? e.billDate : e.date;
    let serial = 20410;
    D.entries.filter(e => e.categoryId === 'cat_tdsdep' && !e.deleted).forEach(d0 => {
      const m = /for (\w+) (\d{4})/.exec(d0.description || ''); const P = m ? (m[2] + '-' + pad2(MONTH_LONG.indexOf(m[1]) + 1)) : addMonths(ymOf(d0.date), -1); d0.taxPeriod = P;
      if (P < '2025-04') return;
      const bySec = {}; D.entries.filter(e => !e.deleted && e.type === 'outflow' && e.categoryId !== 'cat_tdsdep' && +e.tdsAmount > 0 && ymOf(tDate(e)) === P).forEach(e => { bySec[e.tdsSection] = (bySec[e.tdsSection] || 0) + e.tdsAmount; });
      const secs = Object.keys(bySec).sort(); if (!secs.length) { d0.deleted = true; return; }
      secs.forEach((sec, i) => {
        let date = d0.date, interest = 0; const tax = Math.round(bySec[sec]);
        if (P === '2026-06' && sec === '194J') { date = '2026-07-12'; interest = Math.round(tax * 0.03); }
        const ch = { bsr: '0510308', serial: String(++serial).padStart(5, '0'), tax, interest, fee: 0 };
        const desc = `TDS ${sec} for ${monthLabel(P, true)}`;
        if (i === 0) Object.assign(d0, { date, taxable: tax + interest, amount: tax + interest, tdsSection: sec, refNo: ch.serial, challan: ch, description: desc, createdAt: date + 'T11:00:00.000Z' });
        else { const n = add({ type: 'outflow', date, categoryId: 'cat_tdsdep', departmentId: 'dep_fin', partyId: 'ot_it', description: desc, refNo: ch.serial, taxable: tax + interest, paymentMode: 'NEFT', accountId: d0.accountId }); if (n) Object.assign(n, { taxPeriod: P, tdsSection: sec, challan: ch }); }
      });
    });
    D.categories.forEach(c => { c.tdsSection = CAT_TDS[c.id] || ''; });
    const tm = {}; for (let ym = '2025-04'; ym <= '2026-08'; ym = addMonths(ym, 1)) tm[ym] = { status: 'confirmed', sentAt: addMonths(ym, 1) + '-03T10:00:00.000Z', confirmedAt: addMonths(ym, 1) + '-05T16:00:00.000Z', by: 'u_acct', note: 'Confirmed by CA' };
    D.tdsMonths = tm; D.tdsQuarters = {}; D.tdsOutCerts = [];
  }
  D.audit.sort((a, b) => a.ts.localeCompare(b.ts));

  /* sample attachments (SVG "documents") for the most recent bills/receipts */
  const attach = [];
  const targets = [
    ...D.entries.filter(e => !e.deleted && e.recurringId === 'rc_rent').slice(-3),
    ...D.entries.filter(e => !e.deleted && e.projectId && e.type === 'inflow').slice(-4),
    ...D.entries.filter(e => !e.deleted && ['cat_equip', 'cat_lic', 'cat_furn'].includes(e.categoryId)),
    ...D.entries.filter(e => !e.deleted && e.categoryId === 'cat_travel').slice(-3),
  ];
  targets.forEach((e, i) => {
    const isIn = e.type === 'inflow';
    const name = (isIn ? 'Payment-advice' : 'Bill') + '-' + (e.refNo || e.id).replace(/[^\w-]+/g, '-') + '.svg';
    const svg = sampleDocSVG(e, isIn);
    const meta = { id: 'f_' + e.id + '_' + i, name, type: 'image/svg+xml', size: svg.length };
    e.attachments.push(meta); attach.push({ meta, svg });
  });
  return { data: D, attachments: attach };
}

function sampleDocSVG(e, isIn) {
  const p = nameOf('parties', e.partyId), c = nameOf('categories', e.categoryId);
  const row = (y, k, v) => `<text x="40" y="${y}" font-size="15" fill="#5B6478">${esc(k)}</text><text x="560" y="${y}" font-size="15" text-anchor="end" fill="#1B2A4A">${esc(v)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="760" viewBox="0 0 600 760" font-family="Inter, Arial, sans-serif">
<rect width="600" height="760" fill="#fff"/><rect width="600" height="90" fill="#1B2A4A"/>
<text x="40" y="54" font-size="24" font-weight="700" fill="#fff">${isIn ? 'PAYMENT ADVICE' : 'TAX INVOICE'}</text>
<text x="560" y="54" font-size="14" text-anchor="end" fill="#EBA937">SAMPLE · TEST DATA</text>
<text x="40" y="140" font-size="13" fill="#7B8396">${isIn ? 'FROM' : 'VENDOR'}</text><text x="40" y="164" font-size="18" font-weight="600" fill="#1B2A4A">${esc(p)}</text>
<text x="40" y="200" font-size="13" fill="#7B8396">${isIn ? 'TO' : 'BILLED TO'}</text><text x="40" y="224" font-size="16" fill="#1B2A4A">IUOVA Design Company, Mumbai</text>
<line x1="40" y1="260" x2="560" y2="260" stroke="#E5E2D8"/>
${row(300, 'Reference', e.refNo || '—')}${row(332, 'Date', fmtDate(e.date))}${row(364, 'Category', c)}${row(396, 'Description', (e.description || '').slice(0, 42))}
<line x1="40" y1="430" x2="560" y2="430" stroke="#E5E2D8"/>
${row(470, 'Taxable value', money(e.taxable))}${row(502, 'GST @ ' + e.gstRate + '%', money(e.gstAmount))}${row(534, 'TDS @ ' + e.tdsRate + '%', '−' + money(e.tdsAmount))}
<rect x="40" y="560" width="520" height="64" rx="8" fill="#FBF0D9"/><text x="60" y="600" font-size="16" fill="#1B2A4A">Net ${isIn ? 'received' : 'payable'}</text><text x="540" y="600" font-size="22" font-weight="700" text-anchor="end" fill="#1B2A4A">${money(e.amount)}</text>
<text x="40" y="700" font-size="12" fill="#7B8396">Generated sample document for demo purposes only.</text></svg>`;
}

function emptyData() {
  return {
    meta: { schemaVersion: 9, seededAt: nowISO(), testData: false },
    settings: { company: 'IUOVA Design Company', gstin: '', state: 'Maharashtra', openingDate: fyOf(TODAY) + '-04-01', currentUserId: 'u_owner', lockedMonths: [], email: defaultEmailSettings() },
    users: [{ id: 'u_owner', name: 'Vatsal', role: 'owner' }, { id: 'u_acct', name: 'Accountant', role: 'accountant' }],
    accounts: [{ id: 'acc_main', name: 'Main Bank Account', type: 'bank', number: '', openingBalance: 0, active: true }],
    departments: DEFAULT_DEPARTMENTS.map(([id, name]) => ({ id, name, active: true })),
    categories: DEFAULT_CATEGORIES.map(([id, type, group, name, partyKind, kind]) => ({ id, type, group, name, partyKind, kind, active: true })),
    parties: [], projects: [], recurring: [], entries: [], audit: [], orders: [], pis: [], targets: {}, emails: [], bankLines: [], bankImports: [], tds26: [], tdsCerts: [], compliance: {}, creditNotes: [], gstBills: [], gst2b: [], gstMonths: {}, tdsMonths: {}, tdsQuarters: {}, tdsOutCerts: [],
  };
}

if (typeof module !== 'undefined') module.exports = { Sales, fyOf, buildSeed, Store, api, Calc, money, fyMonths, monthLabel, TODAY, ymOf, addMonths, recurringPeriods };

/* ============================ UI: helpers ============================ */
const IC = {
  dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16V11M12 16V7M17 16v-3"/>',
  repeat: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
  building: '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9h.01M9 13h.01M9 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M18 6L6 18M6 6l12 12"/>', menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  in: '<path d="M17 7L7 17M7 9v8h8"/>', out: '<path d="M7 17L17 7M9 7h8v8"/>', transfer: '<path d="M4 8h14l-4-4M20 16H6l4 4"/>',
  clip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>', unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.9-1"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  check: '<path d="M20 6L9 17l-5-5"/>', edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
  restore: '<path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>', file: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  skip: '<path d="M5 4l10 8-10 8z"/><path d="M19 5v14"/>', pause: '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>', play: '<path d="M6 4l14 8-14 8z"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><path d="M9 7h7M9 11h5"/>',
  receipt: '<path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  ext: '<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>',
};
const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[n] || ''}</svg>`;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function toast(msg, kind = 'ok') {
  const t = document.createElement('div'); t.className = 'toast' + (kind === 'error' ? ' error' : '');
  t.innerHTML = icon(kind === 'error' ? 'alert' : 'check') + '<span>' + esc(msg) + '</span>';
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), kind === 'error' ? 5200 : 2800);
}
function opts(list, sel, empty) {
  return (empty != null ? `<option value="">${esc(empty)}</option>` : '') + list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
}
function catOptions(type, sel, empty = 'Select category') {
  const cats = api.list('categories').filter(c => (!type || c.type === type) && (c.active || c.id === sel));
  const groups = [...new Set(cats.map(c => c.group))];
  return `<option value="">${esc(empty)}</option>` + groups.map(g => `<optgroup label="${esc(g)}">` + cats.filter(c => c.group === g).map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}</option>`).join('') + '</optgroup>').join('');
}
const deptOptions = (sel, empty = 'Select department') => opts(api.list('departments').filter(d => d.active || d.id === sel).map(d => [d.id, d.name]), sel, empty);
const accOptions = (sel, empty = 'Select account') => opts(api.list('accounts').filter(a => a.active || a.id === sel).map(a => [a.id, a.name + (a.number ? ' ' + a.number : '')]), sel, empty);
const partyOptions = (kind, sel, empty = 'Select') => opts(api.list('parties').filter(p => (!kind || p.kind === kind) && (p.active || p.id === sel)).sort((a, b) => a.name.localeCompare(b.name)).map(p => [p.id, p.name]), sel, empty);
const projOptions = (clientId, sel, empty = 'No project') => opts(api.list('projects').filter(p => (!clientId || p.clientId === clientId) && (p.active || p.id === sel)).map(p => [p.id, p.code + ' · ' + p.name]), sel, empty);
const userName = id => (Store.data.users.find(u => u.id === id) || {}).name || '—';
const typeChip = t => `<span class="chip ${t}">${TYPE_LABEL[t]}</span>`;
const amtClass = e => e.type === 'inflow' ? 'in' : e.type === 'outflow' ? 'out' : 'xfer';
const signedAmt = e => (e.type === 'inflow' ? '+' : e.type === 'outflow' ? '−' : '') + money(e.amount);
function entryTitle(e) { return e.type === 'transfer' ? 'Transfer' : nameOf('categories', e.categoryId); }
function entryParty(e) {
  if (e.type === 'transfer') return nameOf('accounts', e.accountId) + ' → ' + nameOf('accounts', e.toAccountId);
  return [nameOf('parties', e.partyId), e.projectId ? api.get('projects', e.projectId).code : ''].filter(Boolean).join(' · ');
}
function sparkline(vals, w = 90, h = 24, color = 'var(--navy-3)') {
  const max = Math.max(...vals, 1); const step = vals.length > 1 ? w / (vals.length - 1) : w;
  const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
function bar(pct, cls = '') { return `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i></div>`; }
function pct(a, b) { return b ? (a / b * 100) : 0; }
const fmtPct = v => (isFinite(v) ? v.toFixed(1) : '0.0') + '%';

/* ============================ state & routing ============================ */
const S = {
  page: 'dashboard', fy: fyOf(TODAY), dashDept: '',
  ledger: { q: '', bucket: '', group: '', from: '', to: '', type: '', categoryId: '', departmentId: '', partyId: '', projectId: '', accountId: '', paymentMode: '', page: 0, sort: 'date', dir: -1, open: window.innerWidth > 900 },
  cf: { by: 'category', period: window.innerWidth < 900 ? 'quarterly' : 'monthly' },
  report: 'parties', reportKind: 'client', projScope: 'all',
  master: 'client', audit: { userId: '', action: '', entity: '', q: '', page: 0 },
};
const PAGES = {};
/** Sidebar: pinned items, then accordion groups [key, label, icon, items]. */
const NAV_PINNED = [['dashboard', 'Dashboard', 'dash'], ['ledger', 'Transactions', 'list']];
const NAV = [
  ['overview', 'Overview', 'chart', [['cashflow', 'Cashflow statement', 'table'], ['reports', 'Reports', 'chart']]],
  ['sales', 'Sales', 'book', [['sales', 'Order book', 'book'], ['orders', 'Orders (POs)', 'file'], ['pis', 'Proforma invoices', 'receipt'], ['targets', 'Targets & scorecards', 'target']]],
  ['banking', 'Banking', 'bank', [['bank', 'Bank reconciliation', 'bank'], ['recurring', 'Recurring', 'repeat']]],
  ['tax', 'Tax & filing', 'cal', [['compliance', 'Compliance', 'cal'], ['gst', 'GST returns', 'gst'], ['tdsp', 'TDS payable', 'tdsp'], ['tdsr', 'TDS receivable', 'receipt']]],
  ['admin', 'Admin', 'gear', [['masters', 'Masters', 'building'], ['outbox', 'Email outbox', 'mail'], ['audit', 'Audit log', 'clock'], ['trash', 'Trash', 'trash'], ['settings', 'Settings', 'gear']]],
];
const navGroupOf = page => (NAV.find(g => g[3].some(it => it[0] === page)) || [null])[0];
let _navCountKey = '', _navCounts = {};
/** Counts shown as badges: work waiting on that page. Cached per data change. */
function navCounts() {
  const key = Store.data.audit.length + '|' + TODAY + '|' + (Store.data.emails || []).length;
  if (key === _navCountKey) return _navCounts;
  const c = {};
  try { c.recurring = Calc.pendingRecurring(TODAY).length; } catch (e) { }
  c.outbox = (Store.data.emails || []).filter(m => !m.deleted && ['queued', 'failed'].includes(m.status)).length;
  c.trash = Store.data.entries.filter(e => e.deleted).length;
  try { if (typeof complianceItems === 'function') c.compliance = complianceItems({ fromYm: ymOf(Store.data.settings.openingDate || '2025-04-01'), toYm: ymOf(TODAY) }).filter(o => o.status === 'overdue').length; } catch (e) { }
  c.bank = (Store.data.bankLines || []).filter(l => l.status === 'open').length;
  _navCountKey = key; _navCounts = c; return c;
}
function go(page, patch) { if (patch) Object.assign(S.ledger, patch); if (location.hash === '#/' + page) route(); else location.hash = '#/' + page; }
function route() {
  const p = (location.hash.replace(/^#\//, '') || 'dashboard').split('?')[0];
  S.page = PAGES[p] ? p : 'dashboard';
  if (Store.data && api.me().role === 'manager' && S.page !== 'targets') { S.page = 'targets'; if (location.hash !== '#/targets') history.replaceState(null, '', '#/targets'); }
  $('#sidebar').classList.remove('open'); $('.drawer-ov.side')?.remove();
  if (S.page !== 'sales') { S.salesEdit = false; S.salesDraft = null; }
  render();
}
function render(opts = {}) {
  const keep = opts.keepScroll ? { y: window.scrollY, w: $$('#view .tbl-wrap').map(w => [w.scrollTop, w.scrollLeft]) } : null;
  const P = PAGES[S.page];
  $('#pageTitle').textContent = P.title;
  renderChrome();
  try { $('#view').innerHTML = P.render(); P.after && P.after(); mobileTables($('#view')); }
  catch (err) { console.error(err); $('#view').innerHTML = `<div class="card"><div class="empty"><b>Something went wrong rendering this page</b>${esc(err.message)}</div></div>`; }
  if (keep) { window.scrollTo(0, keep.y); $$('#view .tbl-wrap').forEach((w, i) => { if (keep.w[i]) { w.scrollTop = keep.w[i][0]; w.scrollLeft = keep.w[i][1]; } }); }
  else window.scrollTo(0, 0);
}
function navHTML() {
  const c = navCounts(), cur = navGroupOf(S.page);
  if (!S.openNavs) {
    S.openNavs = new Set(['overview', 'sales', 'banking', 'tax', 'admin']);
  }
  if (cur) S.openNavs.add(cur);
  const badge = (id, n) => !n ? '' : id === 'trash' ? `<span class="badge muted">${n}</span>` : `<span class="badge${id === 'compliance' ? ' warn' : ''}" title="${id === 'outbox' ? 'Queued or failed' : id === 'compliance' ? 'Overdue' : id === 'recurring' ? 'Due to record' : ''}">${n}</span>`;
  const link = ([id, label, ic], cls = '') => `<a href="#/${id}" class="${cls} ${S.page === id ? 'active' : ''}">${icon(ic)}<span>${label}</span>${badge(id, c[id])}</a>`;
  return `<div class="nav-pins">${NAV_PINNED.map(it => link(it, 'nav-pin')).join('')}</div>` + NAV.map(([k, label, ic, items]) => {
    const open = S.openNavs.has(k), has = k === cur, sumN = sum(items.filter(it => it[0] !== 'trash'), it => c[it[0]] || 0), warn = items.some(it => it[0] === 'compliance' && c.compliance);
    return `<div class="nav-sec ${open ? 'open' : ''} ${has ? 'has' : ''}" data-nav="${k}"><button type="button" class="nav-h" data-act="nav-toggle" data-v="${k}" aria-expanded="${open}">${icon(ic)}<span>${label}</span>${sumN ? `<span class="badge ${warn ? 'warn' : ''} nav-sum">${sumN}</span>` : ''}<svg class="nav-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button><div class="nav-items"><div>${items.map(it => link(it, 'nav-sub')).join('')}</div></div></div>`;
  }).join('');
}
/* ---- phones: list tables become stacked cards (labels from the header); matrices keep a sticky first column ---- */
const MATRIX_SEL = '.sticky-first,.td-tbl,.sc-tbl,.perm,.tree,.mx,.gst-3b:not(.tdsp-sum)';
function mobileTables(root) {
  if (!root) return;
  root.querySelectorAll('table.tbl').forEach(t => {
    if (t.dataset.ml) return; t.dataset.ml = '1';
    if (t.matches(MATRIX_SEL)) { t.classList.add('mx'); return; }
    const hr = t.tHead && t.tHead.rows[t.tHead.rows.length - 1]; if (!hr) return;
    const heads = []; [...hr.cells].forEach(c => { for (let k = 0; k < (c.colSpan || 1); k++) heads.push(k ? '' : c.innerText.replace(/\s+/g, ' ').trim()); });
    t.classList.add('mcard');
    [...t.tBodies, ...(t.tFoot ? [t.tFoot] : [])].forEach(sec => [...sec.rows].forEach(tr => {
      let i = 0; const cells = [...tr.cells];
      if (cells.length === 1 || cells.some(c => (c.colSpan || 1) >= heads.length - 1)) tr.classList.add('m-full');
      cells.forEach(c => { const h = heads[i] || ''; if (h && !c.dataset.label) c.dataset.label = h; else if (!h) { c.classList.add('m-wide'); if (!c.innerText.trim() && c.querySelector('button,a')) { c.classList.add('m-act'); tr.classList.add('has-act'); } } i += c.colSpan || 1; });
    }));
  });
}
(() => { let q = 0; new MutationObserver(() => { if (q) return; q = requestAnimationFrame(() => { q = 0; document.querySelectorAll('.overlay, .drawer').forEach(mobileTables); }); }).observe(document.documentElement, { childList: true, subtree: true }); })();
function renderChrome() {
  $('#nav').innerHTML = navHTML();
  const me = api.me();
  $('#sideFoot').innerHTML = `<div class="who"><div class="avatar ${me.role === 'accountant' ? 'acct' : ''}">${esc(me.name.slice(0, 2).toUpperCase())}</div><div><div style="color:#fff;font-weight:600">${esc(me.name)}</div><div>${ROLES[me.role]} · <a href="#/settings" style="color:var(--gold)">switch</a></div></div></div>`;
  const isMgr = me.role === 'manager';
  if (isMgr) $('#nav').innerHTML = `<div class="nav-group">Manager</div><a href="#/targets" class="nav-pin active">${icon('target')}<span>My scorecard</span></a>`;
  $('#addBtn').classList.toggle('hide', !api.can('entry.create')); $('#fab').classList.toggle('hide', !api.can('entry.create')); $('#bottomNav').classList.toggle('hide', isMgr);
  $('#userSelect').innerHTML = api.users().map(u => `<option value="${u.id}"${u.id === me.id ? ' selected' : ''}>${esc(u.name)} (${ROLES[u.role]})</option>`).join('');
  const fys = []; for (let y = fyOf(Store.data.settings.openingDate); y <= fyOf(TODAY); y++) fys.push(y);
  if (!fys.includes(S.fy)) S.fy = fys[fys.length - 1];
  $('#fySelect').innerHTML = fys.map(y => `<option value="${y}"${y === S.fy ? ' selected' : ''}>${fyLabel(y)}</option>`).join('');
  $('#fySelect').style.visibility = ['dashboard', 'cashflow', 'reports', 'ledger', 'settings', 'sales', 'orders', 'pis', 'targets'].includes(S.page) ? 'visible' : 'hidden';
  $$('#bottomNav a').forEach(a => a.classList.toggle('active', a.dataset.p === S.page));
}

/* ============================ chart ============================ */
function niceMax(v) { const mag = Math.pow(10, Math.floor(Math.log10(v))); for (const s of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (s * mag >= v) return s * mag; return 10 * mag; }
function barChart(id, labels, a, b, opts = {}) {
  const W = 960, H = 290, pl = 104, pr = 12, pt = 12, pb = 30, iw = W - pl - pr, ih = H - pt - pb;
  const max = niceMax(Math.max(1, ...a, ...b)); const n = labels.length, gw = iw / n, bw = Math.min(24, gw * 0.3);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = max * i / 4, y = pt + ih - ih * i / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="${i ? '#EEECE5' : '#CFCBBE'}"/><text x="${pl - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#7B8396" font-family="IBM Plex Mono, monospace">${money(v)}</text>`; }
  labels.forEach((l, i) => {
    const x = pl + gw * i + gw / 2;
    if (opts.current === i) g += `<rect x="${x - gw / 2 + 2}" y="${pt}" width="${gw - 4}" height="${ih}" fill="rgba(235,169,55,.10)" rx="4"/>`;
    const ha = ih * a[i] / max, hb = ih * b[i] / max;
    g += `<rect x="${x - bw - 1.5}" y="${pt + ih - ha}" width="${bw}" height="${ha}" rx="2.5" fill="#1B2A4A"/>`;
    g += `<rect x="${x + 1.5}" y="${pt + ih - hb}" width="${bw}" height="${hb}" rx="2.5" fill="#EBA937"/>`;
    g += `<text x="${x}" y="${H - 9}" text-anchor="middle" font-size="11.5" fill="${opts.current === i ? '#1B2A4A' : '#7B8396'}" font-weight="${opts.current === i ? 600 : 400}">${esc(l)}</text>`;
    g += `<rect data-i="${i}" x="${x - gw / 2}" y="${pt}" width="${gw}" height="${ih + pb}" fill="transparent"/>`;
  });
  return `<div class="chart-wrap" id="${id}"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Monthly inflow versus outflow">${g}</svg><div class="tip"></div></div>`;
}
function bindChartTip(id, rows) {
  const wrap = document.getElementById(id); if (!wrap) return; const tip = $('.tip', wrap);
  const show = ev => {
    const r = ev.target.closest('[data-i]'); if (!r) { tip.style.opacity = 0; return; }
    const i = +r.dataset.i, d = rows[i];
    tip.innerHTML = `<b>${esc(d.label)}</b>` + d.items.map(([k, v, c]) => `<div class="tr"><span>${k}</span><span style="${c ? 'color:' + c : ''}">${v}</span></div>`).join('');
    const box = wrap.getBoundingClientRect(), rb = r.getBoundingClientRect();
    let x = rb.left - box.left + rb.width / 2 + 12; if (x + 210 > box.width) x = rb.left - box.left + rb.width / 2 - 222;
    tip.style.left = Math.max(4, x) + 'px'; tip.style.top = '18px'; tip.style.opacity = 1;
  };
  wrap.addEventListener('mousemove', show); wrap.addEventListener('mouseleave', () => tip.style.opacity = 0);
  wrap.addEventListener('click', show);
}
function lineChart(id, labels, series) {
  const W = 960, H = 240, pl = 104, pr = 12, pt = 12, pb = 28, iw = W - pl - pr, ih = H - pt - pb;
  const all = series.flatMap(s => s.values.filter(v => v != null)); const max = niceMax(Math.max(1, ...all));
  const n = labels.length, step = iw / Math.max(1, n - 1);
  let g = '';
  for (let i = 0; i <= 4; i++) { const y = pt + ih - ih * i / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="${i ? '#EEECE5' : '#CFCBBE'}"/><text x="${pl - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#7B8396" font-family="IBM Plex Mono, monospace">${money(max * i / 4)}</text>`; }
  labels.forEach((l, i) => g += `<text x="${pl + i * step}" y="${H - 8}" text-anchor="middle" font-size="11.5" fill="#7B8396">${esc(l)}</text>`);
  series.forEach(s => {
    const pts = s.values.map((v, i) => v == null ? null : [pl + i * step, pt + ih - ih * Math.max(0, v) / max]).filter(Boolean);
    g += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="6 5"' : ''}/>`;
    pts.forEach(p => g += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#fff" stroke="${s.color}" stroke-width="2"/>`);
  });
  labels.forEach((l, i) => g += `<rect data-i="${i}" x="${pl + i * step - step / 2}" y="${pt}" width="${step}" height="${ih}" fill="transparent"/>`);
  return `<div class="chart-wrap" id="${id}"><svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg><div class="tip"></div></div>`;
}

/* ============================ DASHBOARD ============================ */
PAGES.dashboard = {
  title: 'Dashboard',
  render() {
    const fy = S.fy, months = fyMonths(fy), dept = S.dashDept;
    const filt = e => !dept || e.departmentId === dept;
    const m = Calc.monthly(months, filt);
    const fin = sum(m.inflow), fout = sum(m.outflow), net = fin - fout;
    const cashLiquid = Calc.cash(TODAY, { includeFD: false }), cashAll = Calc.cash(TODAY);
    const burn = Calc.avgBurn(3);
    const runway = burn.out > 0 ? cashLiquid / burn.out : null, runwayFD = burn.out > 0 ? cashAll / burn.out : null;
    const cur = months.indexOf(ymOf(TODAY));
    const deptName = dept ? nameOf('departments', dept) : '';
    const scope = fyLabel(fy) + (dept ? ' · ' + deptName : '');

    const kpis = `<div class="grid g-kpi">
      <div class="card kpi accent"><div class="k-l">Cash & bank today</div><div class="k-v">${money(cashLiquid)}</div><div class="k-s">Incl. FD ${money(cashAll)}</div></div>
      <div class="card kpi"><div class="k-l">Inflow · ${esc(fyLabel(fy))}</div><div class="k-v in">${money(fin)}</div><div class="k-s">${dept ? esc(deptName) : 'All departments'}</div></div>
      <div class="card kpi"><div class="k-l">Outflow · ${esc(fyLabel(fy))}</div><div class="k-v out">${money(fout)}</div><div class="k-s">${dept ? esc(deptName) : 'All departments'}</div></div>
      <div class="card kpi"><div class="k-l">Net cashflow</div><div class="k-v ${net >= 0 ? 'in' : 'out'}">${money(net, { sign: true })}</div><div class="k-s">${fin ? fmtPct(pct(net, fin)) + ' of inflow' : '—'}</div></div>
      <div class="card kpi"><div class="k-l">Avg monthly outflow</div><div class="k-v">${money(burn.out)}</div><div class="k-s">${monthLabel(burn.months[2])} – ${monthLabel(burn.months[0])}</div></div>
      <div class="card kpi"><div class="k-l">Runway</div><div class="k-v">${runway == null ? '—' : runway.toFixed(1) + ' months'}</div><div class="k-s">If collections stop${runwayFD != null ? ' · ' + runwayFD.toFixed(1) + ' incl. FD' : ''}</div></div>
    </div>`;

    const chart = `<div class="card"><div class="card-h"><div class="grow"><h2>Monthly inflow vs outflow</h2><div class="sub">${esc(scope)} · net cash, after GST & TDS</div></div>
      <div class="chart-legend"><span><i style="background:#1B2A4A"></i>Inflow</span><span><i style="background:#EBA937"></i>Outflow</span></div>
      <select class="select sel-sm" data-chg="dashDept" style="max-width:190px">${deptOptions(dept, 'All departments')}</select></div>
      ${barChart('dashChart', months.map(x => monthLabel(x)), m.inflow, m.outflow, { current: cur >= 0 ? cur : null })}</div>`;

    // upcoming
    const pend = Calc.pendingRecurring(addDays(TODAY, 30));
    const upcoming = `<div class="card"><div class="card-h"><div class="grow"><h3>Due in the next 30 days</h3><div class="sub">Recurring items awaiting confirmation</div></div><a class="btn btn-sm" href="#/recurring">View all</a></div>
      ${pend.length ? pend.slice(0, 7).map(p => dueRow(p)).join('') + (pend.length > 7 ? `<div class="list-row"><span class="muted">+ ${pend.length - 7} more · <a href="#/recurring">open Recurring</a></span></div>` : '') : '<div class="empty"><b>Nothing due</b>All recurring items are posted.</div>'}</div>`;

    // accounts
    const accs = api.list('accounts');
    const accounts = `<div class="card"><div class="card-h"><div class="grow"><h3>Account balances</h3><div class="sub">As of ${fmtDate(TODAY)}</div></div></div>
      ${accs.map(a => { const b = Calc.balance(a.id, TODAY); return `<div class="list-row click" data-act="ledger-acc" data-id="${a.id}" style="cursor:pointer"><div class="grow"><div class="t">${esc(a.name)}</div><div class="s">${ACCOUNT_TYPES[a.type]}${a.number ? ' · ' + esc(a.number) : ''}</div></div><div class="num ${b < 0 ? 'out' : ''}" style="font-weight:600">${money(b)}</div></div>`; }).join('')}
      <div class="list-row" style="background:var(--surface-2)"><div class="grow"><b>Total</b></div><div class="num" style="font-weight:700">${money(cashAll)}</div></div></div>`;

    // department table — departments, expandable to buckets
    const [from, to] = fyRange(fy);
    const ents = Calc.inRange(from, to).filter(e => e.type !== 'transfer');
    const dIn = aggregate(ents.filter(e => e.type === 'inflow'), [{ months: months }], e => e.departmentId + '|' + bucketOf(api.get('categories', e.categoryId)));
    const dOut = aggregate(ents.filter(e => e.type === 'outflow'), [{ months: months }], e => e.departmentId + '|' + bucketOf(api.get('categories', e.categoryId)));
    const v1 = (m, k) => (m[k] || [0])[0];
    const depNodes = api.list('departments').map(d => ({
      key: 'dash:d:' + d.id, label: d.name, id: d.id,
      children: [...BUCKETS.inflow.map(([b, l]) => ({ key: 'dash:d:' + d.id + ':' + b, label: l, t: 'inflow', ins: v1(dIn, d.id + '|' + b), outs: 0, id: d.id, b })),
                 ...BUCKETS.outflow.map(([b, l]) => ({ key: 'dash:d:' + d.id + ':' + b, label: l, t: 'outflow', ins: 0, outs: v1(dOut, d.id + '|' + b), id: d.id, b }))].filter(x => x.ins || x.outs),
    })).map(n => ({ ...n, ins: sum(n.children, c => c.ins), outs: sum(n.children, c => c.outs) })).filter(n => n.ins || n.outs).sort((a, b) => b.outs - a.outs);
    const totOut = sum(depNodes, x => x.outs);
    const depCells = (n, depth) => `<td class="num in">${n.ins ? money(n.ins) : '<span class="faint">—</span>'}</td><td class="num out">${n.outs ? money(n.outs) : '<span class="faint">—</span>'}</td><td class="num ${n.ins - n.outs >= 0 ? 'in' : 'out'}">${depth ? '' : money(n.ins - n.outs, { sign: true })}</td><td>${n.outs ? `<div class="row" style="gap:8px;flex-wrap:nowrap">${depth ? '<span style="width:60px;flex:none"></span>' : bar(pct(n.outs, totOut), 'gold')}<span class="muted num" style="font-size:12px;min-width:44px;text-align:right">${fmtPct(pct(n.outs, totOut))}</span></div>` : ''}</td><td class="nowrap" style="width:40px"><button class="icon-btn xs" title="Open in Transactions" data-act="ledger-drill" data-drill="${esc(JSON.stringify(n.b ? { departmentId: n.id, bucket: n.b } : { departmentId: n.id }))}">${icon('ext')}</button></td>`;
    prepareTree('dash:d:', depNodes);
    const deptTbl = `<div class="card"><div class="card-h"><div class="grow"><h3>Department-wise cashflow</h3><div class="sub">${esc(fyLabel(fy))} · expand a department to see where its money goes</div></div>${levelSeg('dash:d:', depNodes, [['summary', 'Collapse'], ['all', 'Expand all']])}<a class="btn btn-sm" href="#/reports" data-act="report-tab" data-tab="departments">Monthly detail</a></div>
      <div class="tbl-wrap"><table class="tbl tree"><thead><tr><th>Department</th><th class="num">Inflow</th><th class="num">Outflow</th><th class="num">Net</th><th style="width:22%">Share of outflow</th><th></th></tr></thead><tbody>
      ${treeRowsHTML(depNodes, depCells)}
      </tbody><tfoot><tr><td>Total</td><td class="num in">${money(sum(depNodes, n => n.ins))}</td><td class="num out">${money(totOut)}</td><td class="num">${money(sum(depNodes, n => n.ins) - totOut, { sign: true })}</td><td></td><td></td></tr></tfoot></table></div></div>`;

    // outflow by bucket — expandable to categories
    const catTotals = aggregate(ents.filter(e => e.type === 'outflow' && filt(e)), [{ months: months }], e => e.categoryId);
    const bNodes = finishTree(categoryTree('outflow', c => catTotals[c.id] || [0], 'dash:b:'), 1);
    bNodes.forEach(n => (n.children || []).forEach(g => g.children && g.children.sort((a, b) => b.vals[0] - a.vals[0])));
    const bTot = sum(bNodes, n => n.vals[0]);
    prepareTree('dash:b:', bNodes);
    const bucketRows = (nodes, depth) => nodes.map(n => {
      const has = n.children && n.children.length, open = has && OPEN.has(n.key), v = n.vals[0];
      return `<div class="brow d${depth}">${has ? `<button class="tw ${open ? 'open' : ''}" data-act="tree" data-k="${esc(n.key)}">${icon('chev')}<span>${esc(n.label)}</span></button>` : `<button class="tw-leaf link" data-act="ledger-drill" data-drill="${esc(JSON.stringify({ ...n.drill, departmentId: dept || '' }))}">${esc(n.label)}</button>`}
        <span class="num bv">${money(v)}</span><span class="num bp">${fmtPct(pct(v, bTot))}</span>${depth === 0 ? `<div class="bb">${bar(pct(v, bTot), 'out')}</div>` : ''}</div>` + (open ? bucketRows(n.children, depth + 1) : '');
    }).join('');
    const catCard = `<div class="card"><div class="card-h"><div class="grow"><h3>Where the money goes</h3><div class="sub">${esc(scope)} · outflow by bucket</div></div>${levelSeg('dash:b:', bNodes, [['summary', 'Summary'], ['all', 'Detail']])}</div>
      <div class="buckets">${bucketRows(bNodes, 0) || '<div class="empty">No outflows in this period.</div>'}</div></div>`;

    // recent
    const recent = Calc.live().slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 8);
    const recentCard = `<div class="card"><div class="card-h"><div class="grow"><h3>Recently recorded</h3><div class="sub">Latest entries by entry time</div></div><a class="btn btn-sm" href="#/ledger">All transactions</a></div>
      ${recent.map(e => entryListRow(e)).join('') || '<div class="empty">No entries yet.</div>'}</div>`;

    // orders & billing strip
    const facts = Sales.facts(); const fyMs = months.filter(m => m <= ymOf(TODAY));
    const fv = (m, ms) => sum(facts.filter(f => f.m === m && ms.includes(f.ym) && (!dept || f.dep === dept)), f => f.v);
    const lm = fyMs.includes(addMonths(ymOf(TODAY), -1)) ? addMonths(ymOf(TODAY), -1) : fyMs[fyMs.length - 1];
    const tFY = targetFor(fyMs, dept || null), tLM = lm ? targetFor([lm], dept || null) : 0;
    const bookAmt = sum(api.list('orders').filter(o => !dept || Sales.shares(o).some(x => x.departmentId === dept)), o => { const st = Sales.orderState(o); const sh = dept ? Sales.shares(o).find(x => x.departmentId === dept).pct / 100 : 1; return st.toInvoice * sh; });
    const unp = api.list('pis').map(p => ({ p, ...Sales.piState(p) })).filter(x => x.outstanding > 0 && (!dept || Sales.shares(Sales.orderOfPI(x.p)).some(y => y.departmentId === dept)));
    const sales = `<div class="card"><div class="card-h"><div class="grow"><h3>Orders & billing</h3><div class="sub">${esc(scope)} · pre-GST · targets on PIs issued</div></div><a class="btn btn-sm" href="#/sales">Order book</a><a class="btn btn-sm" href="#/targets">Scorecards</a></div>
      <div class="sales-strip">
        <div><span>Orders booked · FY</span><b>${money(fv('booked', fyMs))}</b></div>
        <div><span>PIs issued · FY</span><b>${money(fv('billed', fyMs))}</b><em class="${achClass(fv('billed', fyMs), tFY)}">${tFY ? pctTxt(fv('billed', fyMs), tFY) + ' of ' + money(tFY) : 'No target'}</em></div>
        <div><span>PIs issued · ${lm ? monthLabel(lm, true) : '—'}</span><b>${money(lm ? fv('billed', [lm]) : 0)}</b><em class="${achClass(lm ? fv('billed', [lm]) : 0, tLM)}">${tLM ? pctTxt(fv('billed', [lm]), tLM) + ' of target' : 'No target'}</em></div>
        <div><span>Order book (to invoice)</span><b>${money(bookAmt)}</b></div>
        <div><span>Unpaid PIs</span><b class="${unp.some(x => x.overdueDays) ? 'out' : ''}">${money(sum(unp, x => x.outstanding))}</b><em>${unp.filter(x => x.overdueDays).length} overdue</em></div>
      </div></div>`;
    return `<div class="stack">${kpis}${sales}${chart}<div class="grid g-12">${upcoming}${accounts}</div>${typeof dashActionCards === 'function' ? dashActionCards() : `<div class="grid g-2">${complianceCard()}</div>`}${deptTbl}<div class="grid g-2">${catCard}${recentCard}</div></div>`;
  },
  after() {
    const months = fyMonths(S.fy); const dept = S.dashDept;
    const m = Calc.monthly(months, e => !dept || e.departmentId === dept);
    bindChartTip('dashChart', months.map((x, i) => ({ label: monthLabel(x, true), items: [['Inflow', money(m.inflow[i]), '#9FD8B9'], ['Outflow', money(m.outflow[i]), '#F5C977'], ['Net', money(m.net[i], { sign: true })]] })));
  },
};
function entryListRow(e) {
  return `<div class="list-row" data-act="open-entry" data-id="${e.id}" style="cursor:pointer"><div class="type-ic ${e.type}">${icon(e.type === 'inflow' ? 'in' : e.type === 'outflow' ? 'out' : 'transfer')}</div><div class="grow"><div class="t">${esc(entryTitle(e))}</div><div class="s">${fmtDate(e.date)} · ${esc(entryParty(e))}</div></div><div class="num ${amtClass(e)}" style="font-weight:600">${signedAmt(e)}</div></div>`;
}
const QAMT = {};   // amounts typed into due rows, kept across re-renders: 'recId|period' → taxable
function dueRow(p, opts = {}) {
  const r = p.rec; const days = diffDays(p.dueDate, TODAY);
  if (opts.inline && api.can('recurring.confirm')) return dueRowInline(p, days);
  const when = p.overdue ? `<span class="chip overdue">${-days}d overdue</span>` : days === 0 ? '<span class="chip gold">Due today</span>' : `<span class="muted" style="font-size:12px">in ${days}d</span>`;
  return `<div class="list-row"><div class="type-ic ${r.type}">${icon(r.type === 'inflow' ? 'in' : 'out')}</div><div class="grow"><div class="t">${esc(r.name)}</div><div class="s">${fmtDate(p.dueDate)} · ${esc(nameOf('parties', r.partyId))}</div></div>
    <div style="text-align:right"><div class="num ${r.type === 'inflow' ? 'in' : 'out'}" style="font-weight:600">${r.type === 'inflow' ? '+' : '−'}${money(p.net)}</div><div>${when}</div></div>
    <div class="row" style="gap:4px;flex-wrap:nowrap"><button class="icon-btn" title="Confirm & record" data-act="confirm-due" data-id="${r.id}" data-p="${p.period}" data-d="${p.dueDate}">${icon('check')}</button><button class="icon-btn" title="Skip this cycle" data-act="skip-due" data-id="${r.id}" data-p="${p.period}">${icon('skip')}</button></div></div>`;
}

function dueRowInline(p, days) {
  const r = p.rec, key = r.id + '|' + p.period, sg = recurringSuggest(r);
  const val = QAMT[key] != null ? QAMT[key] : p.taxable; const net = recurringNet(r, val);
  const when = p.overdue ? `<span class="chip overdue">${-days}d overdue</span>` : days === 0 ? '<span class="chip gold">Due today</span>' : `<span class="muted" style="font-size:12px">in ${days}d</span>`;
  const changed = Math.abs((+val || 0) - (+r.taxable || 0)) > 0.004;
  const hint = r.variable ? `Varies${sg.last != null ? ' · last ' + money(sg.last) + (sg.lastPeriod ? ' (' + monthLabel(sg.lastPeriod) + ')' : '') : ''}${sg.avg3 != null ? ' · 3-mo avg ' + money(sg.avg3) : ''}` : changed ? 'Template ' + money(r.taxable) : '';
  const taxNote = (r.gstRate || r.tdsRate) ? `${r.gstRate ? '+' + r.gstRate + '% GST' : ''}${r.gstRate && r.tdsRate ? ' ' : ''}${r.tdsRate ? '−' + r.tdsRate + '% TDS' : ''}` : '';
  return `<div class="list-row due-row ${r.variable ? 'is-var' : ''}"><div class="type-ic ${r.type}">${icon(r.type === 'inflow' ? 'in' : 'out')}</div>
    <div class="grow"><div class="t">${esc(r.name)} ${r.variable ? '<span class="chip gold" style="height:19px;font-size:10.5px">Varies</span>' : ''}</div><div class="s">${fmtDate(p.dueDate)} · ${esc(nameOf('parties', r.partyId))}</div></div>
    <div class="due-when">${when}</div>
    <div class="due-amt"><label class="qamt ${changed ? 'edited' : ''}"><span>₹</span><input type="number" inputmode="decimal" step="0.01" min="0" data-qamt="${key}" data-rec="${r.id}" value="${val}" aria-label="Amount for ${esc(r.name)}"></label>
      <div class="due-hint">${esc(hint)}</div></div>
    <div class="due-net"><div class="num ${r.type === 'inflow' ? 'in' : 'out'}" data-qnet="${key}">${r.type === 'inflow' ? '+' : '−'}${money(net)}</div><div class="due-hint">${taxNote ? 'net ' + taxNote : 'net cash'}</div></div>
    <div class="row due-acts" style="gap:4px;flex-wrap:nowrap"><button class="btn btn-sm btn-navy" title="Record with this amount" data-act="quick-record" data-id="${r.id}" data-p="${p.period}" data-d="${p.dueDate}">${icon('check')} Record</button>
      <button class="icon-btn" title="Open full form (date, account, notes, bill…)" data-act="confirm-due" data-id="${r.id}" data-p="${p.period}" data-d="${p.dueDate}">${icon('edit')}</button>
      <button class="icon-btn" title="Skip this cycle" data-act="skip-due" data-id="${r.id}" data-p="${p.period}">${icon('skip')}</button></div></div>`;
}

/* ============================ LEDGER ============================ */
function ledgerFiltered() {
  const L = S.ledger; const [fyF, fyT] = fyRange(S.fy);
  const from = L.from || fyF, to = L.to || fyT; const q = L.q.trim().toLowerCase();
  let rows = Calc.live().filter(e => e.date >= from && e.date <= to
    && (!L.type || e.type === L.type) && (!L.categoryId || e.categoryId === L.categoryId) && (!L.departmentId || e.departmentId === L.departmentId)
    && (!L.partyId || e.partyId === L.partyId) && (!L.projectId || e.projectId === L.projectId)
    && (!L.accountId || e.accountId === L.accountId || e.toAccountId === L.accountId) && (!L.paymentMode || e.paymentMode === L.paymentMode)
    && (!L.bucket || bucketOf(api.get('categories', e.categoryId)) === L.bucket) && (!L.group || (api.get('categories', e.categoryId) || {}).group === L.group));
  if (q) rows = rows.filter(e => [e.description, e.refNo, e.txnRef, e.notes, nameOf('parties', e.partyId), nameOf('projects', e.projectId), nameOf('categories', e.categoryId), String(e.amount)].join(' ').toLowerCase().includes(q));
  const k = L.sort; rows.sort((a, b) => (k === 'amount' ? a.amount - b.amount : a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || '')) * L.dir);
  return { rows, from, to };
}
PAGES.ledger = {
  title: 'Transactions',
  render() {
    const L = S.ledger; const [fyF, fyT] = fyRange(S.fy);
    const activeCount = ['type', 'categoryId', 'departmentId', 'partyId', 'projectId', 'accountId', 'paymentMode', 'from', 'to'].filter(k => L[k]).length;
    return `<div class="toolbar">
      <div class="field" style="flex:2;min-width:220px"><label>Search</label><input class="input" data-inp="lq" value="${esc(L.q)}" placeholder="Description, ref no., party, amount…"></div>
      <div class="field"><label>From</label><input class="input" type="date" data-lf="from" value="${L.from || fyF}"></div>
      <div class="field"><label>To</label><input class="input" type="date" data-lf="to" value="${L.to || fyT}"></div>
      <button class="btn" data-act="toggle-filters">${icon('list')} Filters${activeCount ? ` <span class="chip navy">${activeCount}</span>` : ''}</button>
      ${activeCount || L.q || L.bucket || L.group ? '<button class="btn btn-ghost" data-act="clear-filters">Clear</button>' : ''}
      ${L.bucket || L.group ? `<span class="chip gold" style="height:30px;align-self:flex-end">${esc([BUCKET_LABEL[L.bucket], L.group].filter(Boolean).join(' › '))}<button data-act="clear-bucket" title="Remove" style="display:inline-flex;width:14px">${icon('x')}</button></span>` : ''}
      </div>
      <div class="toolbar ${L.open ? '' : 'hide'}" id="moreFilters">
      <div class="field"><label>Type</label><select class="select" data-lf="type">${opts(Object.entries(TYPE_LABEL), L.type, 'All types')}</select></div>
      <div class="field" style="min-width:190px"><label>Category</label><select class="select" data-lf="categoryId">${catOptions(null, L.categoryId, 'All categories')}</select></div>
      <div class="field"><label>Department</label><select class="select" data-lf="departmentId">${deptOptions(L.departmentId, 'All departments')}</select></div>
      <div class="field" style="min-width:190px"><label>Party</label><select class="select" data-lf="partyId">${partyOptions(null, L.partyId, 'All parties')}</select></div>
      <div class="field" style="min-width:190px"><label>Project</label><select class="select" data-lf="projectId">${projOptions(null, L.projectId, 'All projects')}</select></div>
      <div class="field"><label>Account</label><select class="select" data-lf="accountId">${accOptions(L.accountId, 'All accounts')}</select></div>
      <div class="field"><label>Mode</label><select class="select" data-lf="paymentMode">${opts(PAYMENT_MODES.map(m => [m, m]), L.paymentMode, 'All modes')}</select></div>
      </div>
      <div class="card" id="ledgerResults">${ledgerResults()}</div>`;
  },
};
function ledgerResults() {
  const L = S.ledger; const { rows, from, to } = ledgerFiltered();
  const ins = rows.filter(e => e.type === 'inflow'), outs = rows.filter(e => e.type === 'outflow');
  const per = 50, pages = Math.max(1, Math.ceil(rows.length / per)); if (L.page >= pages) L.page = pages - 1;
  const slice = rows.slice(L.page * per, L.page * per + per);
  const sortI = k => L.sort === k ? (L.dir < 0 ? ' ↓' : ' ↑') : '';
  const strip = `<div class="summary-strip">
    <div><div class="l">Entries</div><div class="v">${rows.length}</div></div>
    <div><div class="l">Inflow</div><div class="v in">${money(sum(ins, e => e.amount))}</div></div>
    <div><div class="l">Outflow</div><div class="v out">${money(sum(outs, e => e.amount))}</div></div>
    <div><div class="l">Net</div><div class="v">${money(sum(ins, e => e.amount) - sum(outs, e => e.amount), { sign: true })}</div></div>
    <div><div class="l">GST in / out</div><div class="v">${money(sum(ins, e => e.gstAmount))} / ${money(sum(outs, e => e.gstAmount))}</div></div>
    <div><div class="l">TDS in / out</div><div class="v">${money(sum(ins, e => e.tdsAmount))} / ${money(sum(outs, e => e.tdsAmount))}</div></div></div>`;
  if (!rows.length) return strip + `<div class="empty"><b>No transactions match</b>${fmtDate(from)} – ${fmtDate(to)}. Adjust the filters or add an entry.</div>`;
  const table = `<div class="tbl-wrap ledger-table"><table class="tbl"><thead><tr>
    <th class="sort" data-act="sort" data-k="date">Date${sortI('date')}</th><th>Type</th><th>Category / description</th><th>Party · project</th><th>Dept</th>
    <th class="num">Taxable</th><th class="num">GST</th><th class="num">TDS</th><th class="num sort" data-act="sort" data-k="amount">Net cash${sortI('amount')}</th><th>Account · mode</th><th></th></tr></thead><tbody>
    ${slice.map(e => `<tr class="click" data-act="open-entry" data-id="${e.id}">
      <td class="nowrap">${fmtDate(e.date)}</td><td>${typeChip(e.type)}</td>
      <td style="max-width:260px"><div class="cell-main">${esc(entryTitle(e))}</div><div class="cell-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.description || '')}${e.refNo ? ' · ' + esc(e.refNo) : ''}</div></td>
      <td style="max-width:220px"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.type === 'transfer' ? entryParty(e) : nameOf('parties', e.partyId) || '—')}</div>${e.projectId ? `<div class="cell-sub">${esc(api.get('projects', e.projectId).code)}</div>` : ''}</td>
      <td class="nowrap">${esc(nameOf('departments', e.departmentId) || '—')}</td>
      <td class="num">${e.type === 'transfer' ? '' : money(e.taxable)}</td><td class="num muted">${e.gstAmount ? money(e.gstAmount) : ''}</td><td class="num muted">${e.tdsAmount ? money(e.tdsAmount) : ''}</td>
      <td class="num ${amtClass(e)}" style="font-weight:600">${signedAmt(e)}</td>
      <td class="nowrap"><div>${esc(nameOf('accounts', e.accountId))}</div><div class="cell-sub">${esc(e.paymentMode)}</div></td>
      <td class="nowrap faint">${e.attachments && e.attachments.length ? `<span title="${e.attachments.length} attachment(s)" style="display:inline-block;width:15px">${icon('clip')}</span>` : ''}${api.isLocked(e.date) ? `<span title="Month locked" style="display:inline-block;width:15px;margin-left:4px">${icon('lock')}</span>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
  const cards = `<div class="lcards">${slice.map(e => `<div class="lcard" data-act="open-entry" data-id="${e.id}"><div class="type-ic ${e.type}">${icon(e.type === 'inflow' ? 'in' : e.type === 'outflow' ? 'out' : 'transfer')}</div><div class="grow"><div class="t">${esc(entryTitle(e))}</div><div class="s">${esc(entryParty(e))}</div><div class="s">${fmtDate(e.date)} · ${esc(nameOf('departments', e.departmentId) || e.paymentMode)}</div></div><div><div class="amt ${amtClass(e)}">${signedAmt(e)}</div>${e.attachments && e.attachments.length ? `<div class="faint" style="width:14px;margin:4px 0 0 auto">${icon('clip')}</div>` : ''}</div></div>`).join('')}</div>`;
  const pager = `<div class="pager"><span>Showing ${L.page * per + 1}–${Math.min(rows.length, L.page * per + per)} of ${rows.length}</span><span class="spacer"></span>
    <button class="btn btn-sm" data-act="lpage" data-d="-1" ${L.page ? '' : 'disabled'}>Previous</button><span>Page ${L.page + 1} / ${pages}</span><button class="btn btn-sm" data-act="lpage" data-d="1" ${L.page < pages - 1 ? '' : 'disabled'}>Next</button></div>`;
  return strip + table + cards + pager;
}
function refreshLedger() { const el = $('#ledgerResults'); if (el) el.innerHTML = ledgerResults(); }

/* ============================ summary-first tree tables ============================ */
/* Rows are nodes {key, label, sub?, vals:number[], children?, drill?}. Expanded keys live in OPEN.
   Each tree has a scope prefix (e.g. 'cf:') so level presets only touch their own rows. */
const OPEN = new Set();
const LEVEL_REQ = {};   // scope → pending preset to apply on next render
function sumTree(nodes, len) {
  for (const n of nodes) if (n.children) { sumTree(n.children, len); n.vals = Array.from({ length: len }, (_, i) => sum(n.children, c => c.vals[i])); }
  return nodes;
}
function pruneTree(nodes) {
  return nodes.filter(n => { if (n.children) n.children = pruneTree(n.children); return n.vals.some(v => Math.abs(v) > 0.004) || (n.children && n.children.length); });
}
/** Collapse a node whose only child is a single group: bucket → categories directly. */
function flattenSingle(nodes) {
  for (const n of nodes) if (n.children) { if (n.children.length === 1 && n.children[0].children) n.children = n.children[0].children; flattenSingle(n.children); }
  return nodes;
}
function expandableKeys(nodes, maxDepth = 99, depth = 0, out = []) {
  for (const n of nodes) if (n.children && n.children.length && depth < maxDepth) { out.push(n.key); expandableKeys(n.children, maxDepth, depth + 1, out); }
  return out;
}
function applyLevel(scope, nodes, level) {
  for (const k of [...OPEN]) if (k.startsWith(scope)) OPEN.delete(k);
  const depth = level === 'summary' ? 0 : level === 'all' ? 99 : +level;
  expandableKeys(nodes, depth).forEach(k => OPEN.add(k));
}
function levelOf(scope, nodes, levels) {
  for (const [lv] of levels) {
    const depth = lv === 'summary' ? 0 : lv === 'all' ? 99 : +lv;
    const want = new Set(expandableKeys(nodes, depth)); const have = [...OPEN].filter(k => k.startsWith(scope) && expandableKeys(nodes).includes(k));
    if (have.length === want.size && have.every(k => want.has(k))) return lv;
  }
  return 'custom';
}
/** Apply a pending preset (or the default the first time a scope is seen). */
const SEEN_SCOPES = new Set();
function prepareTree(scope, nodes, def = 'summary') {
  if (LEVEL_REQ[scope]) { applyLevel(scope, nodes, LEVEL_REQ[scope]); delete LEVEL_REQ[scope]; }
  else if (!SEEN_SCOPES.has(scope)) applyLevel(scope, nodes, def);
  SEEN_SCOPES.add(scope);
}
function levelSeg(scope, nodes, levels) {
  const cur = levelOf(scope, nodes, levels);
  return `<div class="seg">${levels.map(([lv, l]) => `<button class="${cur === lv ? 'on' : ''}" data-act="tree-level" data-scope="${scope}" data-lv="${lv}">${l}</button>`).join('')}</div>`;
}
function treeRowsHTML(nodes, cellsFn, depth = 0) {
  return nodes.map(n => {
    const has = n.children && n.children.length; const open = has && OPEN.has(n.key);
    const label = has
      ? `<button class="tw ${open ? 'open' : ''}" data-act="tree" data-k="${esc(n.key)}" aria-expanded="${open}">${icon('chev')}<span>${esc(n.label)}</span>${n.count ? `<span class="tw-n">${n.count}</span>` : ''}</button>`
      : `<span class="tw-leaf">${esc(n.label)}</span>`;
    return `<tr class="d${depth} ${has ? 'node' : 'leaf'} ${open ? 'is-open' : ''}"><td>${label}${n.sub ? `<div class="cell-sub tw-sub">${n.sub}</div>` : ''}</td>${cellsFn(n, depth)}</tr>` + (open ? treeRowsHTML(n.children, cellsFn, depth + 1) : '');
  }).join('');
}
function countLeaves(n) { return n.children ? sum(n.children, countLeaves) : 1; }
const drillAttr = (type, drill, from, to) => `data-act="cf-drill" data-type="${type}" data-drill="${esc(JSON.stringify(drill))}" data-from="${from}" data-to="${to}"`;

/** Periods for a FY, hiding months that haven't started. */
function fyPeriods(fy, mode) {
  const months = fyMonths(fy).filter(m => m <= ymOf(TODAY));
  const cur = ymOf(TODAY);
  let periods = mode === 'quarterly'
    ? [0, 1, 2, 3].map(q => fyMonths(fy).slice(q * 3, q * 3 + 3)).filter(ms => ms[0] <= cur).map((ms, q) => ({ label: 'Q' + (q + 1) + ' · ' + MON[+ms[0].slice(5) - 1] + '–' + MON[+ms[2].slice(5) - 1], months: ms.filter(m => m <= cur) }))
    : months.map(m => ({ label: monthLabel(m), months: [m] }));
  periods.forEach(p => { p.from = p.months[0] + '-01'; p.to = ymDate(p.months[p.months.length - 1], 31); p.cur = p.from <= TODAY && TODAY <= p.to; if (p.cur) p.label += ' · to date'; });
  return periods;
}
/** Build per-period sums of entries keyed by keyFn → { key: number[] }. */
function aggregate(entries, periods, keyFn) {
  const idx = {}; periods.forEach((p, i) => p.months.forEach(m => idx[m] = i));
  const out = {};
  for (const e of entries) { const i = idx[ymOf(e.date)]; if (i == null) continue; const k = keyFn(e); if (k == null) continue; (out[k] = out[k] || periods.map(() => 0))[i] += e.amount; }
  return out;
}
/** Category tree: bucket → group → category. valsOf(cat) returns per-period values. */
function categoryTree(type, valsOf, scope, drillBase = {}) {
  const cats = api.list('categories').filter(c => c.type === type);
  const nodes = BUCKETS[type].map(([bid, bl]) => {
    const bc = cats.filter(c => bucketOf(c) === bid);
    return {
      key: scope + type + ':' + bid, label: bl, drill: { ...drillBase, bucket: bid },
      children: [...new Set(bc.map(c => c.group))].map(g => ({
        key: scope + type + ':' + bid + ':' + g, label: g, drill: { ...drillBase, bucket: bid, group: g },
        children: bc.filter(c => c.group === g).map(c => ({ key: scope + 'c:' + c.id, label: c.name, vals: valsOf(c), drill: { ...drillBase, categoryId: c.id } })),
      })),
    };
  });
  return nodes;
}
function finishTree(nodes, len) { flattenSingle(nodes); sumTree(nodes, len); const p = pruneTree(nodes); p.forEach(n => n.count = countLeaves(n) > 1 ? countLeaves(n) : 0); return p; }



/* shared helpers: share-of-total %, heat shading, best/lowest among completed periods */
const rpPc = (a, b) => b > 0 ? a / b * 100 : null;
const rpF1 = x => x == null ? '–' : (Math.round(x * 10) / 10).toFixed(1) + '%';
function rpRank(vals, periods) { const done = vals.map((v, i) => ({ v, i })).filter(x => !periods[x.i].cur && !periods[x.i].future); if (done.length < 2) return {}; const mx = done.reduce((a, b) => b.v > a.v ? b : a), mn = done.reduce((a, b) => b.v < a.v ? b : a); return mx.v === mn.v ? {} : { best: mx.i, low: mn.i }; }
const rpHeat = (v, max) => max > 0 && v > 0 ? `style="--h:${(0.08 + 0.5 * v / max).toFixed(3)}"` : '';
const rpTag = (R, i) => R.best === i ? '<span class="rp-tag best">Best</span>' : R.low === i ? '<span class="rp-tag low">Lowest</span>' : '';
/* Revenue performance: client receipts (pre-GST) per period as % of FY revenue, vs target, by department. */
function revenuePerfHTML(fy, periods, fyF, lastTo) {
  const C = S.cf, len = periods.length;
  const rev = Calc.inRange(fyF, lastTo).filter(e => e.type === 'inflow' && bucketOf(api.get('categories', e.categoryId)) === 'op_rec');
  const idx = {}; periods.forEach((p, i) => p.months.forEach(m => idx[m] = i));
  const tot = periods.map(() => 0), byDep = {};
  for (const e of rev) { const i = idx[ymOf(e.date)]; if (i == null) continue; const v = +e.taxable || 0; tot[i] += v; const d = e.departmentId || '_none'; (byDep[d] = byDep[d] || periods.map(() => 0))[i] += v; }
  const T = sum(tot);
  const deps = [...api.list('departments'), { id: '_none', name: 'No department' }].filter(d => byDep[d.id] && sum(byDep[d.id]) > 0).sort((a, b) => sum(byDep[b.id]) - sum(byDep[a.id]));
  const tgtOf = (p, dep) => sum(p.months, m => dep ? Sales.targetForMonth(m, dep) : sum(api.list('departments'), d => Sales.targetForMonth(m, d.id)));
  const tg = periods.map(p => tgtOf(p)), TG = sum(tg);
  const pc = rpPc, f1 = rpF1, rank = vals => rpRank(vals, periods), heat = rpHeat, tag = rpTag;
  const R = rank(tot), mx = Math.max(0, ...tot);
  const unit = C.period === 'quarterly' ? 'quarter' : 'month';
  const open = S.rpDeps !== false;
  const cells = periods.map((p, i) => `<td class="num rp-h ${p.cur ? 'cur' : ''}" ${heat(tot[i], mx)}><b>${f1(pc(tot[i], T))}</b>${tag(R, i)}</td>`).join('');
  const depRows = deps.map(d => { const vals = byDep[d.id], DT = sum(vals), dm = Math.max(0, ...vals), DR = rank(vals); const dtg = periods.map(p => d.id === '_none' ? 0 : tgtOf(p, d.id)), DTG = sum(dtg);
    return `<tr class="rp-dep"><td><div class="cell-main">${esc(d.name)}</div><div class="cell-sub">${money(DT)}${DTG ? ' · ' + f1(pc(DT, DTG)) + ' of target' : ''}</div></td>${periods.map((p, i) => `<td class="num rp-h ${p.cur ? 'cur' : ''}" ${heat(vals[i], dm)} title="${esc(d.name)} · ${esc(p.label)}: ${money(vals[i])}${dtg[i] ? ' · target ' + money(dtg[i]) : ''}">${vals[i] ? `<b>${f1(pc(vals[i], DT))}</b>${tag(DR, i)}<div class="rp-amt">${money(vals[i])}</div>` : '<span class="faint">–</span>'}</td>`).join('')}<td class="num tot-c"><b>100%</b><div class="rp-amt">${money(DT)}</div></td><td class="num share"><span class="muted">${f1(pc(DT, T))}</span></td></tr>`; }).join('');
  if (!T && !TG) return '';
  const lbl = i => esc(periods[i].label.replace(' · to date', ''));
  const shown = !!S.rpOpen;
  const summary = `<div class="rp-sum">${R.best != null ? `<span><i class="rp-dot best"></i>Best <b>${lbl(R.best)}</b> ${f1(pc(tot[R.best], T))}</span><span><i class="rp-dot low"></i>Lowest <b>${lbl(R.low)}</b> ${f1(pc(tot[R.low], T))}</span>` : ''}${TG ? `<span>Target achieved <b class="${T >= TG ? 'in' : 'out'}">${f1(pc(T, TG))}</b></span>` : ''}<span class="faint">${money(T)} client revenue</span></div>`;
  if (!shown) return `<div class="card rp-card rp-mini"><button class="rp-bar" data-act="rp-open">${icon('chev')}<b>Revenue performance</b>${summary}<span class="rp-cta">Show by ${unit}</span></button></div>`;
  return `<div class="card rp-card"><div class="card-h"><div class="grow"><button class="rp-bar open" data-act="rp-open" style="padding:0;width:auto">${icon('chev')}<b>Revenue performance</b></button><div class="sub" style="margin:4px 0 0 25px">Client receipts before GST, by ${unit}, as a share of ${esc(fyLabel(fy))} revenue so far. Darker = stronger ${unit}; best and lowest compare completed ${unit}s only.</div></div>
    <button class="btn btn-sm" data-act="rp-deps">${open ? 'Hide' : 'Show'} departments</button><button class="btn btn-sm" data-act="rp-open">Hide</button></div>
    <div class="tbl-wrap cf-wrap"><table class="tbl sticky-first cf rp"><thead><tr><th class="first">${esc(fyLabel(fy))}</th>${periods.map(p => `<th class="num ${p.cur ? 'cur' : ''}">${esc(p.label)}</th>`).join('')}<th class="num tot-c">FY to date</th><th class="num share">Share</th></tr></thead><tbody>
    <tr class="rp-rev"><td>Client revenue</td>${periods.map((p, i) => `<td class="num ${p.cur ? 'cur' : ''}">${tot[i] ? money(tot[i]) : '–'}</td>`).join('')}<td class="num tot-c">${money(T)}</td><td class="num share">100%</td></tr>
    <tr class="rp-pct"><td>% of FY revenue</td>${cells}<td class="num tot-c"><b>100%</b></td><td></td></tr>
    <tr class="rp-tg"><td>Revenue target<div class="cell-sub">achieved</div></td>${periods.map((p, i) => `<td class="num ${p.cur ? 'cur' : ''}">${tg[i] ? `<div class="rp-amt">${money(tg[i])}</div><b class="${tot[i] >= tg[i] ? 'in' : 'out'}">${f1(pc(tot[i], tg[i]))}</b>` : '<span class="faint">No target</span>'}</td>`).join('')}<td class="num tot-c">${TG ? `<div class="rp-amt">${money(TG)}</div><b class="${T >= TG ? 'in' : 'out'}">${f1(pc(T, TG))}</b>` : '–'}</td><td></td></tr>
    ${open && deps.length ? `<tr class="rp-sub"><td colspan="${len + 3}">By department · each ${unit} as % of that department's FY revenue</td></tr>${depRows}` : ''}
    </tbody></table></div></div>`;
}
/* ============================ CASHFLOW STATEMENT ============================ */
PAGES.cashflow = {
  title: 'Cashflow statement',
  render() {
    const fy = S.fy, C = S.cf;
    const periods = fyPeriods(fy, C.period); const len = periods.length;
    const [fyF] = fyRange(fy); const lastTo = periods.length ? periods[len - 1].to : fyF;
    const ents = Calc.inRange(fyF, lastTo).filter(e => e.type !== 'transfer');
    const scope = 'cf:' + C.by + ':';
    let tree = {};
    for (const type of ['inflow', 'outflow']) {
      const te = ents.filter(e => e.type === type);
      if (C.by === 'category') {
        const agg = aggregate(te, periods, e => e.categoryId);
        tree[type] = finishTree(categoryTree(type, c => agg[c.id] || periods.map(() => 0), scope), len);
      } else {
        const agg = aggregate(te, periods, e => (e.departmentId || '_none') + '|' + bucketOf(api.get('categories', e.categoryId)));
        const deps = [...api.list('departments'), { id: '_none', name: 'No department' }];
        tree[type] = finishTree(deps.map(d => ({ key: scope + type + ':' + d.id, label: d.name, drill: d.id === '_none' ? {} : { departmentId: d.id },
          children: BUCKETS[type].map(([bid, bl]) => ({ key: scope + type + ':' + d.id + ':' + bid, label: bl, vals: agg[d.id + '|' + bid] || periods.map(() => 0), drill: { ...(d.id === '_none' ? {} : { departmentId: d.id }), bucket: bid } })) })), len);
        tree[type].sort((a, b) => sum(b.vals) - sum(a.vals));
      }
    }
    const accNode = { key: scope + 'acc', label: 'Closing balance by account', vals: periods.map(() => 0), children: api.list('accounts').map(a => ({ key: scope + 'acc:' + a.id, label: a.name, vals: periods.map(p => Calc.balance(a.id, p.to < TODAY ? p.to : TODAY)), bal: true })) };
    const allNodes = [...tree.inflow, ...tree.outflow];
    prepareTree(scope, allNodes);
    const levels = C.by === 'category' ? [['summary', 'Summary'], ['1', 'Groups'], ['all', 'All lines']] : [['summary', 'Departments'], ['all', 'With buckets']];
    const tin = periods.map((_, i) => sum(tree.inflow, n => n.vals[i])), tout = periods.map((_, i) => sum(tree.outflow, n => n.vals[i]));
    const TIN = sum(tin), TOUT = sum(tout);
    const cellsFor = (type, base) => (n, depth) => periods.map((p, i) => { const v = n.vals[i]; return `<td class="num ${v ? 'hit' : 'zero'} ${p.cur ? 'cur' : ''}" ${v && n.drill ? drillAttr(type, n.drill, p.from, p.to) : ''}>${v ? money(v) : '–'}</td>`; }).join('')
      + `<td class="num tot-c" ${n.drill ? drillAttr(type, n.drill, fyF, lastTo) : ''}>${money(sum(n.vals))}</td><td class="num share"><span class="${depth ? 'faint' : 'muted'}">${fmtPct(pct(sum(n.vals), base))}</span></td>`;
    const balCells = vals => periods.map((p, i) => `<td class="num ${p.cur ? 'cur' : ''} ${vals[i] < 0 ? 'out' : ''}">${money(vals[i])}</td>`).join('') + '<td class="num tot-c"></td><td></td>';
    const opening = periods.map(p => Calc.cash(addDays(p.from, -1))), closing = periods.map(p => Calc.cash(p.to < TODAY ? p.to : TODAY));
    const secRow = (label, vals, total, cls) => `<tr class="sec ${cls}"><td>${label}</td>${vals.map((v, i) => `<td class="num ${periods[i].cur ? 'cur' : ''}">${money(v)}</td>`).join('')}<td class="num tot-c">${money(total)}</td><td class="num share">100%</td></tr>`;
    const accOpen = OPEN.has(accNode.key);
    if (!len) return `<div class="card"><div class="empty"><b>No months to show yet</b>${esc(fyLabel(fy))} hasn't started.</div></div>`;
    const revCard = revenuePerfHTML(fy, periods, fyF, lastTo);
    return `<div class="cf-bar">
        <div><div class="lbl">Detail</div>${levelSeg(scope, allNodes, levels)}</div>
        <div><div class="lbl">Rows</div><div class="seg">${[['category', 'By category'], ['department', 'By department']].map(([v, l]) => `<button class="${C.by === v ? 'on' : ''}" data-act="cf-set" data-k="by" data-v="${v}">${l}</button>`).join('')}</div></div>
        <div><div class="lbl">Columns</div><div class="seg">${[['monthly', 'Monthly'], ['quarterly', 'Quarterly']].map(([v, l]) => `<button class="${C.period === v ? 'on' : ''}" data-act="cf-set" data-k="period" data-v="${v}">${l}</button>`).join('')}</div></div>
        <span class="spacer"></span>
        <div class="cf-kpis"><div><span>Inflow</span><b class="in">${money(TIN)}</b></div><div><span>Outflow</span><b class="out">${money(TOUT)}</b></div><div><span>Net</span><b class="${TIN - TOUT >= 0 ? 'in' : 'out'}">${money(TIN - TOUT, { sign: true })}</b></div></div>
      </div>
      ${revCard}
      <div class="card"><div class="tbl-wrap cf-wrap"><table class="tbl sticky-first cf"><thead><tr><th class="first">${esc(fyLabel(fy))}<span class="faint" style="font-weight:500;text-transform:none;letter-spacing:0"> · ${len} of 12 months</span></th>${periods.map(p => `<th class="num ${p.cur ? 'cur' : ''}">${esc(p.label)}</th>`).join('')}<th class="num tot-c">FY to date</th><th class="num share">Share</th></tr></thead><tbody>
        <tr class="bal"><td>Opening balance</td>${balCells(opening)}</tr>
        ${secRow('Cash inflow', tin, TIN, 'in-sec')}${treeRowsHTML(tree.inflow, cellsFor('inflow', TIN))}
        ${secRow('Cash outflow', tout, TOUT, 'out-sec')}${treeRowsHTML(tree.outflow, cellsFor('outflow', TOUT))}
        <tr class="net"><td>Net cashflow</td>${periods.map((p, i) => `<td class="num ${p.cur ? 'cur' : ''} ${tin[i] - tout[i] >= 0 ? 'in' : 'out'}">${money(tin[i] - tout[i], { sign: true })}</td>`).join('')}<td class="num tot-c ${TIN - TOUT >= 0 ? 'in' : 'out'}">${money(TIN - TOUT, { sign: true })}</td><td></td></tr>
        <tr class="bal"><td>Closing balance</td>${balCells(closing)}</tr>
        <tr class="d0 node ${accOpen ? 'is-open' : ''}"><td><button class="tw ${accOpen ? 'open' : ''}" data-act="tree" data-k="${accNode.key}">${icon('chev')}<span>By account</span><span class="tw-n">${accNode.children.length}</span></button></td>${periods.map(() => '<td></td>').join('')}<td></td><td></td></tr>
        ${accOpen ? accNode.children.map(a => `<tr class="d1 leaf"><td><span class="tw-leaf">${esc(a.label)}</span></td>${balCells(a.vals)}</tr>`).join('') : ''}
      </tbody></table></div></div>
      <div class="muted" style="font-size:12px;margin-top:10px">Net cash after GST and TDS. Balances include bank, FD and petty cash; transfers between them are excluded. Months that haven't started are hidden. Click a row name to expand it, or any figure to see its entries.</div>`;
  },
};

/* ============================ ENTRY DRAWER ============================ */
async function openEntry(id) {
  const e = api.get('entries', id); if (!e) return;
  closeDrawer();
  const locked = api.isLocked(e.date);
  const rec = e.recurringId ? api.get('recurring', e.recurringId) : null;
  const cat = api.get('categories', e.categoryId);
  const kv = (k, v) => v == null || v === '' ? '' : `<dt>${k}</dt><dd>${v}</dd>`;
  const tdsLabel = e.type === 'inflow' ? 'TDS deducted by client' : 'TDS deducted by IUOVA';
  const history = Store.data.audit.filter(a => a.entityId === id).slice().reverse();
  const canEdit = !e.deleted && !locked && api.can('entry.edit');
  const canDel = !e.deleted && !locked && api.can('entry.delete');
  const html = `<div class="drawer-ov" data-act="close-drawer"></div><aside class="drawer" role="dialog" aria-label="Entry details">
    <div class="drawer-h"><div class="type-ic ${e.type}">${icon(e.type === 'inflow' ? 'in' : e.type === 'outflow' ? 'out' : 'transfer')}</div>
      <div style="flex:1;min-width:0"><div style="font:600 16px var(--f-head)">${esc(entryTitle(e))}</div><div class="muted" style="font-size:12.5px">${fmtDate(e.date)} · ${esc(entryParty(e))}</div>
      <div class="num ${amtClass(e)}" style="font-size:22px;font-weight:600;margin-top:6px">${signedAmt(e)}</div>
      <div class="row" style="gap:6px;margin-top:6px">${typeChip(e.type)}${locked ? `<span class="chip navy">${icon('lock')} Locked month</span>` : ''}${rec ? `<span class="chip gold">${icon('repeat')} Recurring</span>` : ''}${e.deleted ? '<span class="chip outflow">In trash</span>' : ''}</div></div>
      <button class="icon-btn" data-act="close-drawer" aria-label="Close">${icon('x')}</button></div>
    <div class="drawer-b">
      <dl class="kv">
        ${e.type === 'transfer' ? kv('From account', esc(nameOf('accounts', e.accountId))) + kv('To account', esc(nameOf('accounts', e.toAccountId))) + kv('Amount', `<span class="num">${money(e.amount)}</span>`) : `
        ${kv('Category', esc(cat ? cat.name : '—') + (cat ? `<div class="muted" style="font-size:12px">${esc(cat.group)}</div>` : ''))}
        ${kv('Department', esc(nameOf('departments', e.departmentId)))}
        ${kv(PARTY_KINDS_SHORT[e.partyKind] || 'Party', (() => { const pp = api.get('parties', e.partyId); return pp ? ((pp.kind === 'client' || pp.kind === 'vendor') ? `<a href="#" data-act="open-party" data-id="${pp.id}">${esc(pp.name)}</a>` : esc(pp.name)) : '—'; })())}
        ${kv('Project', e.projectId ? esc(nameOf('projects', e.projectId)) : '—')}
        ${e.piId ? kv('Against PI', `<a href="#" data-act="open-pi" data-id="${e.piId}">${esc(nameOf('pis', e.piId))}</a>`) : ''}
        ${kv(e.type === 'inflow' ? 'Invoice no.' : 'Bill no.', esc(e.refNo || '—'))}
        ${kv('Taxable value', `<span class="num">${money(e.taxable)}</span>`)}
        ${kv('GST', `<span class="num">${money(e.gstAmount)}</span> <span class="muted">${e.gstAmount ? '@ ' + e.gstRate + '% · ' + GST_TYPES[e.gstType] : ''}${e.gstAmount && e.gstType === 'intra' ? ' (' + money(e.gstAmount / 2) + ' each)' : ''}</span>`)}
        ${e.type === 'outflow' && e.gstAmount ? kv('Input GST (ITC)', e.itc ? 'Claimable' : 'Not claimable') : ''}
        ${kv(tdsLabel, `<span class="num">${money(e.tdsAmount)}</span> <span class="muted">${e.tdsAmount ? '@ ' + e.tdsRate + '%' : ''}</span>`)}
        ${kv('Net cash', `<b class="num ${amtClass(e)}">${money(e.amount)}</b> <span class="muted num" style="font-size:12px">= ${money(e.taxable)} + ${money(e.gstAmount)} − ${money(e.tdsAmount)}</span>`)}`}
        ${kv('Description', esc(e.description || '—'))}
        ${e.type !== 'transfer' ? kv('Account', esc(nameOf('accounts', e.accountId))) : ''}
        ${kv('Payment mode', esc(e.paymentMode))}
        ${kv('Txn ref / UTR', esc(e.txnRef || '—'))}
        ${e.notes ? kv('Notes', esc(e.notes)) : ''}
        ${rec ? kv('Recurring', esc(rec.name) + ` <span class="muted">· ${monthLabel(e.recurringPeriod, true)}</span>`) : ''}
        ${(() => { const bl = typeof bankLineFor === 'function' ? bankLineFor(e.id) : null; return bl ? kv('Bank', `<span class="chip inflow">Reconciled</span> <span class="muted" style="font-size:12px">${fmtDate(bl.date)} · ${esc(bl.narration.slice(0, 50))}</span>`) : ''; })()}
        ${kv('Recorded', esc(userName(e.createdBy)) + ' · ' + fmtDateTime(e.createdAt))}
        ${e.updatedAt ? kv('Last edited', esc(userName(e.updatedBy)) + ' · ' + fmtDateTime(e.updatedAt)) : ''}
        ${e.deleted ? kv('Deleted', esc(userName(e.deletedBy)) + ' · ' + fmtDateTime(e.deletedAt)) : ''}
      </dl>
      <div class="fsec-h" style="margin-top:22px">Attachments (${(e.attachments || []).length})</div>
      ${(e.attachments || []).length ? `<div class="thumbs" id="thumbs">${e.attachments.map(a => `<div class="thumb" data-act="view-file" data-id="${a.id}"><div class="im" data-im="${a.id}"><span class="faint" style="width:28px">${icon('file')}</span></div><div class="nm" title="${esc(a.name)}">${esc(a.name)}</div></div>`).join('')}</div>` : '<div class="muted" style="font-size:13px">No documents attached.</div>'}
      ${entryEmailKind(e) ? emailSectionHTML('entries', e.id, !e.deleted && api.can('email.queue')) : ''}
      <div class="fsec-h" style="margin-top:22px">History</div>
      <div class="timeline">${history.map(a => auditLine(a)).join('') || '<div class="muted">No history.</div>'}</div>
    </div>
    <div class="drawer-f">
      ${canEdit ? `<button class="btn btn-navy" data-act="edit-entry" data-id="${e.id}">${icon('edit')} Edit</button>` : ''}
      ${!e.deleted && api.can('entry.create') ? `<button class="btn" data-act="dup-entry" data-id="${e.id}">${icon('copy')} Duplicate</button>` : ''}
      <span class="spacer"></span>
      ${canDel ? `<button class="btn btn-danger" data-act="del-entry" data-id="${e.id}">${icon('trash')} Delete</button>` : ''}
      ${!canEdit && !e.deleted && locked ? `<span class="muted" style="font-size:12px;align-self:center">Month is locked${api.can('month.lock') ? ' · unlock in Settings' : ''}</span>` : ''}
      ${!e.deleted && !locked && !api.can('entry.delete') ? '<span class="muted" style="font-size:12px;align-self:center">Only the Owner can delete</span>' : ''}
    </div></aside>`;
  $('#layer').insertAdjacentHTML('beforeend', `<div id="drawer">${html}</div>`);
  for (const a of e.attachments || []) {
    if (!a.type.startsWith('image/')) { const box = $(`[data-im="${a.id}"]`); if (box) box.innerHTML = `<div style="text-align:center"><div class="faint" style="width:30px;margin:auto">${icon('file')}</div><div class="muted" style="font-size:11px;margin-top:4px">PDF</div></div>`; continue; }
    const f = await FileStore.get(a.id).catch(() => null); const box = $(`[data-im="${a.id}"]`);
    if (f && f.blob && box) box.innerHTML = `<img alt="" src="${URL.createObjectURL(f.blob)}">`;
  }
}
function closeDrawer() { $('#drawer')?.remove(); }
async function viewFile(id) {
  const f = await FileStore.get(id).catch(() => null);
  if (!f) { toast('File not found in this browser', 'error'); return; }
  const url = URL.createObjectURL(f.blob);
  if (!f.type.startsWith('image/')) { window.open(url, '_blank'); return; }
  const lb = document.createElement('div'); lb.className = 'lightbox';
  lb.innerHTML = `<img src="${url}" alt="${esc(f.name)}"><div class="row"><a class="btn" href="${url}" download="${esc(f.name)}">Download</a><button class="btn btn-gold">Close</button></div>`;
  lb.addEventListener('click', ev => { if (ev.target === lb || ev.target.closest('.btn-gold')) lb.remove(); });
  document.body.appendChild(lb);
}
function auditLine(a) {
  const verb = { create: 'created', update: 'edited', delete: 'deleted', restore: 'restored', purge: 'permanently deleted', lock: 'locked', unlock: 'unlocked', skip: 'skipped', reset: 'reset' }[a.action] || a.action;
  return `<div class="tl"><div class="avatar ${(Store.data.users.find(u => u.id === a.userId) || {}).role === 'accountant' ? 'acct' : ''}" style="width:24px;height:24px;font-size:10px">${esc(userName(a.userId).slice(0, 2).toUpperCase())}</div><div style="flex:1;min-width:0"><div><b>${esc(userName(a.userId))}</b> ${verb}</div><div class="when">${fmtDateTime(a.ts)}</div>${changesHTML(a)}</div></div>`;
}
const FIELD_LABEL = { taxable: 'Taxable', amount: 'Net cash', gstAmount: 'GST', gstRate: 'GST %', gstType: 'GST type', tdsAmount: 'TDS', tdsRate: 'TDS %', itc: 'ITC', categoryId: 'Category', departmentId: 'Department', partyId: 'Party', partyKind: 'Party type', projectId: 'Project', accountId: 'Account', toAccountId: 'To account', paymentMode: 'Mode', txnRef: 'Txn ref', refNo: 'Ref no.', description: 'Description', notes: 'Notes', date: 'Date', attachments: 'Attachments', type: 'Type', openingBalance: 'Opening balance', contractValue: 'Contract value', monthlySalary: 'Monthly salary', clientId: 'Client', active: 'Active', lockedMonths: 'Locked months', dayOfMonth: 'Day', frequency: 'Frequency' };
function changesHTML(a) {
  if (!a.changes || !a.changes.length) return '';
  return `<div class="changes">${a.changes.slice(0, 8).map(c => `<div><span class="muted">${esc(FIELD_LABEL[c.field] || c.field)}:</span> <s>${esc(c.from)}</s> → <ins>${esc(c.to)}</ins></div>`).join('')}${a.changes.length > 8 ? `<div class="muted">+${a.changes.length - 8} more</div>` : ''}</div>`;
}

/* ============================ modal helpers ============================ */
function openModal(html, cls = '') {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  $('#layer').appendChild(ov);
  ov.addEventListener('mousedown', ev => { if (ev.target === ov) ov.dataset.down = '1'; });
  ov.addEventListener('mouseup', ev => { if (ev.target === ov && ov.dataset.down) ov.remove(); delete ov.dataset.down; });
  return ov;
}
function confirmBox({ title, body, ok = 'Confirm', danger = false, typed }) {
  return new Promise(res => {
    const ov = openModal(`<div class="modal-h"><h2>${esc(title)}</h2></div><div class="modal-b"><div style="font-size:14px;color:var(--ink-2)">${body}</div>${typed ? `<div class="field" style="margin-top:14px"><label>Type <b>${esc(typed)}</b> to confirm</label><input class="input" id="cbType" autocomplete="off"></div>` : ''}</div>
      <div class="modal-f"><button class="btn" data-x="no">Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-navy'}" data-x="yes" ${typed ? 'disabled' : ''}>${esc(ok)}</button></div>`, 'sm');
    const yes = $('[data-x=yes]', ov);
    if (typed) $('#cbType', ov).addEventListener('input', ev => yes.disabled = ev.target.value.trim() !== typed);
    ov.addEventListener('click', ev => { const b = ev.target.closest('[data-x]'); if (!b) return; ov.remove(); res(b.dataset.x === 'yes'); });
    new MutationObserver((_, o) => { if (!ov.isConnected) { o.disconnect(); res(false); } }).observe($('#layer'), { childList: true });
  });
}

/* ============================ ENTRY FORM ============================ */
/* mode: new | edit | dup | confirm | template | template-edit */
/* ============================ ENTRY FORM — intent first ============================ */
/* Step 1: pick what happened (7 tiles). Step 2: only the fields that kind needs; everything that can be
   inferred (category, department, project, GST/TDS, account) is pre-filled from the PI, the employee,
   or the last entry for the same party/category, and shown as a chip that can be changed. */
IC.users = '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>';
IC.bank = '<path d="M3 21h18M4 10h16M5 10v8M9.5 10v8M14.5 10v8M19 10v8M12 3l9 5H3z"/>';
const ENTRY_KINDS = [
  { k: 'vendor', type: 'outflow', pk: 'vendor', label: 'Pay a vendor', sub: 'Bills, rent, software, freelancers', ic: 'out', grp: 'Money out' },
  { k: 'employee', type: 'outflow', pk: 'employee', label: 'Pay an employee', sub: 'Salary, reimbursement, bonus', ic: 'users', grp: 'Money out' },
  { k: 'tax', type: 'outflow', pk: 'other', label: 'Tax & statutory', sub: 'GST, TDS, PT, advance tax', ic: 'receipt', grp: 'Money out' },
  { k: 'other_out', type: 'outflow', pk: 'other', label: 'Other expense', sub: 'Bank charges, EMI, drawings', ic: 'bank', grp: 'Money out' },
  { k: 'client', type: 'inflow', pk: 'client', label: 'Client payment', sub: 'Against a PI, or an advance', ic: 'in', grp: 'Money in' },
  { k: 'other_in', type: 'inflow', pk: 'other', label: 'Other income', sub: 'FD interest, capital, loan', ic: 'bank', grp: 'Money in' },
  { k: 'transfer', type: 'transfer', pk: null, label: 'Transfer', sub: 'Between own accounts', ic: 'transfer', grp: 'Move money' },
];
const KIND = Object.fromEntries(ENTRY_KINDS.map(x => [x.k, x]));
const TAX_SUBS = { gst: ['GST', 'cat_gstpay', 'ot_gst'], tds: ['TDS', 'cat_tdsdep', 'ot_it'], pt: ['Professional tax', 'cat_ptax', 'ot_pt'], adv: ['Advance tax', 'cat_advtax', 'ot_it'] };
const EMP_SUBS = { salary: 'Salary', reimb: 'Reimbursement', bonus: 'Bonus' };

function kindOfEntry(v) {
  if (v.type === 'transfer') return 'transfer';
  const p = api.get('parties', v.partyId), c = api.get('categories', v.categoryId);
  const pk = p ? p.kind : (v.type === 'inflow' && v.projectId ? 'client' : null);
  if (pk === 'client') return 'client'; if (pk === 'vendor') return 'vendor'; if (pk === 'employee') return 'employee';
  if (v.type === 'inflow') return 'other_in';
  if (c && (c.kind === 'tax' || c.id === 'cat_ptax')) return 'tax';
  return 'other_out';
}
function subOfEntry(kind, v) {
  if (kind === 'employee') return v.categoryId === 'cat_bonus' ? 'bonus' : v.categoryId === 'cat_reimb' ? 'reimb' : 'salary';
  if (kind === 'tax') return (Object.entries(TAX_SUBS).find(([, x]) => x[1] === v.categoryId) || ['gst'])[0];
  return null;
}
function lastEntry(pred) { let best = null; for (const e of Calc.live()) if (pred(e) && (!best || e.date > best.date || (e.date === best.date && (e.createdAt || '') > (best.createdAt || '')))) best = e; return best; }
function catsFor(F) {
  const all = api.list('categories').filter(c => c.active || c.id === F.v.categoryId);
  if (F.allCats) return all.filter(c => c.type === F.v.type);
  switch (F.kind) {
    case 'vendor': return all.filter(c => c.type === 'outflow' && c.partyKind === 'vendor');
    case 'other_out': return all.filter(c => c.type === 'outflow' && c.partyKind !== 'vendor' && c.partyKind !== 'employee' && c.kind !== 'tax' && c.id !== 'cat_ptax');
    case 'other_in': return all.filter(c => c.type === 'inflow' && c.partyKind !== 'client');
    case 'client': return all.filter(c => c.type === 'inflow' && c.partyKind === 'client');
    default: return all.filter(c => c.type === F.v.type);
  }
}
const catSelectOptions = (list, sel) => { const groups = [...new Set(list.map(c => c.group))]; return '<option value="">Select category</option>' + groups.map(g => `<optgroup label="${esc(g)}">` + list.filter(c => c.group === g).map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}</option>`).join('') + '</optgroup>').join(''); };
function catForPI(pi) {
  const o = Sales.orderOfPI(pi), pr = api.get('projects', pi.projectId), has = id => !!api.get('categories', id);
  const pick = pr && /^RET/i.test(pr.code) ? 'cat_retain' : o && o.type === 'Email' ? 'cat_consult' : o && o.departmentId === 'dep_eng' ? 'cat_reng' : 'cat_rdesign';
  return has(pick) ? pick : ((api.list('categories').find(c => c.type === 'inflow' && c.partyKind === 'client') || {}).id || '');
}
function taxSuggest(sub, ym) {
  const es = Calc.live().filter(e => ymOf(e.date) === ym);
  if (sub === 'gst') { if (typeof gstMonth === 'function') { const M = gstMonth(ym); return r2(Math.max(0, M.cash.total - M.paid)); } return r2(sum(es.filter(e => e.type === 'inflow'), e => e.gstAmount) - sum(es.filter(e => e.type === 'outflow' && e.itc), e => e.gstAmount)); }
  if (sub === 'tds' && typeof tdsMonth === 'function') { const M = tdsMonth(ym); return r2(Math.max(0, M.tds - M.paid)); }
  if (sub === 'tds') return r2(sum(es.filter(e => e.type === 'outflow' && e.categoryId !== 'cat_tdsdep'), e => e.tdsAmount));
  if (sub === 'pt') { const L = lastEntry(e => e.categoryId === 'cat_ptax'); return L ? L.taxable : 0; }
  return 0;
}

function openEntryForm({ mode = 'new', entry = null, rec = null, period = null, dueDate = null, preset = {}, amount = null, kind = null, onSaved = null, note = '' } = {}) {
  if (!api.can(mode.startsWith('template') ? 'recurring.create' : 'entry.create')) { toast('Not allowed for your role', 'error'); return; }
  closeDrawer();
  const firstBank = (api.list('accounts').find(a => a.type === 'bank' && a.active) || api.list('accounts')[0] || {}).id || '';
  const base = { piId: '', type: 'outflow', date: TODAY, categoryId: '', departmentId: '', partyKind: '', partyId: '', projectId: '', description: '', refNo: '', taxable: '', gstType: 'none', gstRate: 0, gstAmount: 0, itc: true, tdsRate: 0, tdsAmount: 0, amount: '', paymentMode: 'NEFT', accountId: firstBank, toAccountId: '', txnRef: '', notes: '', attachments: [] };
  let v;
  if (entry) { v = JSON.parse(JSON.stringify(entry)); if (mode === 'dup') { delete v.id; v.date = TODAY; v.attachments = []; v.txnRef = ''; v.recurringId = null; v.recurringPeriod = null; } }
  else if (rec) {
    v = { ...base, type: rec.type, categoryId: rec.categoryId, departmentId: rec.departmentId, partyId: rec.partyId, partyKind: (api.get('parties', rec.partyId) || {}).kind || '', projectId: rec.projectId || '', description: rec.description, taxable: rec.taxable, gstType: rec.gstType, gstRate: rec.gstRate, tdsRate: rec.tdsRate, itc: rec.itc !== false, paymentMode: rec.paymentMode, accountId: rec.accountId };
    v.gstAmount = r2(v.taxable * v.gstRate / 100); v.tdsAmount = r2(v.taxable * v.tdsRate / 100);
    if (mode === 'confirm') { const x = entryFromRecurring(rec, period, dueDate, amount); Object.assign(v, x, { partyKind: v.partyKind, projectId: x.projectId || '', piId: x.piId || '' }); }
    if (mode === 'template-edit') Object.assign(v, { name: rec.name, frequency: rec.frequency, dayOfMonth: rec.dayOfMonth, startDate: rec.startDate, endDate: rec.endDate || '', variable: !!rec.variable });
  } else v = { ...base, ...preset };
  if (mode === 'template') Object.assign(v, { name: '', frequency: 'monthly', dayOfMonth: +TODAY.slice(8), startDate: TODAY, endDate: '', variable: false });
  const isTpl = mode.startsWith('template');
  const F = { mode, v, rec, newFiles: [], removed: [], errs: {}, gstAuto: true, tdsAuto: true, deptAuto: !v.departmentId, repeat: false, rFreq: 'monthly', open: {}, more: false, emailOpen: false, allCats: false, auto: {}, billSet: !!(v.billDate && v.billDate !== v.date) };
  F.kind = kind || ((entry || rec || preset.partyId || preset.piId || preset.type === 'transfer') ? kindOfEntry(v) : null);
  F.sub = F.kind ? subOfEntry(F.kind, v) : null;
  F.period = F.kind === 'tax' ? (/for (\w+ \d{4})/.test(v.description || '') ? null : addMonths(ymOf(v.date || TODAY), -1)) : null;
  if (F.kind === 'tax' && !F.period) { const m = (v.description || '').match(/for (\w+) (\d{4})/); F.period = m ? m[2] + '-' + pad2(MONTH_LONG.indexOf(m[1]) + 1) : addMonths(ymOf(v.date || TODAY), -1); }
  F.piMode = F.kind === 'client' ? (v.piId || !v.partyId ? 'pi' : 'nopi') : 'pi';
  F.showGst = +v.gstRate > 0; F.showTds = +v.tdsRate > 0;
  if (F.kind && !entry && !rec && preset.kind) F.kind = preset.kind;
  if (preset.taxSub) F.sub = preset.taxSub; if (preset.taxPeriod) F.period = preset.taxPeriod;
  if (F.kind && !entry && !rec && !preset.partyId && !preset.piId) startKind(F, F.kind, true);
  if (F.kind && !entry && !rec && preset.partyId && !preset.piId) { const pid = preset.partyId; startKind(F, F.kind); v.partyId = pid; const pp = api.get('parties', pid); if (pp) { v.partyKind = pp.kind; if (F.kind === 'client') setClient(F, pid); else applyPartyMemory(F, pp); } }
  if (!entry && !rec && preset.netAmount) { F.bank = { net: +preset.netAmount, date: preset.date, accountId: preset.accountId, txnRef: preset.txnRef, paymentMode: preset.paymentMode }; applyBankLock(F); if (preset.description && !v.description) v.description = preset.description; }
  if (!entry && !rec && preset.amountOverride != null) { v.taxable = +preset.amountOverride; F.auto.taxable = false; }
  F.note = note;
  const title = { new: 'New entry', edit: 'Edit entry', dup: 'Duplicate entry', confirm: 'Record recurring item', template: 'New recurring template', 'template-edit': 'Edit recurring template' }[mode];
  const ov = openModal(`<div class="modal-h"><h2>${title}</h2><span class="muted" style="font-size:12px">Recording as <b>${esc(api.me().name)}</b></span><button class="icon-btn" data-f-act="close">${icon('x')}</button></div><div class="modal-b" id="fBody"></div>
    <div class="modal-f" id="fFoot"></div>`, 'xl');
  const body = $('#fBody', ov), foot = $('#fFoot', ov);
  const syncEmail = () => {
    if (isTpl || !F.kind) { F.email = null; return; }
    const ek = entryEmailKind(v);
    if (!ek) { F.email = null; return; }
    if (!F.email || F.email.kind !== ek || F.email.partyId !== v.partyId) { F.email = initEmail(ek, v.partyId); if (F.mode === 'edit') F.email.on = false; }
    if (F.email._reset) delete F.email._reset;
    refreshEmail(F.email, entryEmailVars(v));
  };
  const drawFoot = () => { foot.innerHTML = F.kind ? `${mode === 'new' ? '<button class="btn" data-f-act="save-more"><span class="d-only">Save & add another</span><span class="m-only">Save + new</span></button>' : ''}<button class="btn" data-f-act="close">Cancel</button><button class="btn btn-gold" data-f-act="save">${isTpl ? 'Save template' : mode === 'confirm' ? 'Confirm & record' : 'Save entry'}</button>` : '<button class="btn" data-f-act="close">Cancel</button>'; };
  const draw = () => { syncEmail(); body.innerHTML = formBody(F); drawFoot(); updateNet(); };
  const updateNet = () => {
    const t = +v.taxable || 0;
    if (F.gstAuto) { v.gstAmount = r2(t * (+v.gstRate || 0) / 100); const i = $('[data-f=gstAmount]', body); if (i && document.activeElement !== i) i.value = v.gstAmount || ''; }
    if (F.tdsAuto) { v.tdsAmount = r2(t * (+v.tdsRate || 0) / 100); const i = $('[data-f=tdsAmount]', body); if (i && document.activeElement !== i) i.value = v.tdsAmount || ''; }
    if (F.email && F.email.on && !F.email.edited) { refreshEmail(F.email, entryEmailVars(v)); const s1 = $('[data-em=subject]', body), b1 = $('[data-em=body]', body); if (s1) s1.value = F.email.subject; if (b1) b1.value = F.email.body; }
    const box = $('#sumBox', body); if (box) box.innerHTML = summaryHTML(F);
  };
  draw();
  const setField = (k, val) => {
    if (['taxable', 'gstAmount', 'tdsAmount', 'amount', 'gstRate', 'tdsRate', 'dayOfMonth'].includes(k)) val = val === '' ? '' : +val;
    v[k] = val; let redraw = false;
    if (k === 'partyId') { const p = api.get('parties', val); if (F.kind === 'client') setClient(F, val); else if (p) applyPartyMemory(F, p); redraw = true; }
    if (k === 'categoryId') { F.auto.categoryId = false; if (F.kind === 'other_out' || F.kind === 'other_in') applyCategoryMemory(F, val); redraw = true; }
    if (k === 'projectId') { const pr = api.get('projects', val); if (pr && F.deptAuto) { v.departmentId = pr.departmentId; F.auto.departmentId = true; } redraw = true; }
    if (k === 'departmentId') { F.deptAuto = false; F.auto.departmentId = false; redraw = true; }
    if (k === 'gstRate') { if (+val > 0 && v.gstType === 'none') { const p = api.get('parties', v.partyId); v.gstType = p && p.gstType !== 'none' ? p.gstType : 'intra'; } if (+val === 0) v.gstType = 'none'; F.gstAuto = true; redraw = true; }
    if (k === 'tdsRate') { F.tdsAuto = true; F.rateTouched = true; redraw = true; }
    if (k === 'tdsSection') { if (typeof applyTdsSection === 'function') applyTdsSection(F, val); redraw = true; }
    if ((k === 'gstRate' || k === 'tdsRate') && F.bank && !F.bankTyped) applyBankLock(F);
    if (k === 'taxable' && F.bank) F.bankTyped = true;
    if (k === 'gstAmount') F.gstAuto = false;
    if (k === 'tdsAmount') F.tdsAuto = false;
    if (k === 'date') { if (api.isLocked(val)) F.errs.date = monthLabel(ymOf(val), true) + ' is locked. Ask the Owner to unlock it in Settings.'; else delete F.errs.date; if (F.kind === 'employee' && F.sub === 'salary' && F.auto.description) v.description = 'Salary – ' + monthLabel(ymOf(val), true); redraw = true; }
    if (k === 'description' || k === 'refNo' || k === 'taxable') F.auto[k] = false;
    if ((k === 'categoryId' || k === 'partyId') && KIND[F.kind] && KIND[F.kind].type === 'outflow') { const c = api.get('categories', v.categoryId); if (c) v.itc = !c.itcBlocked; }
    if (k === 'billDate') { F.billSet = !!val && val !== v.date; if (!F.billSet) v.billDate = ''; redraw = true; }
    if (k === 'date' && !F.billSet) v.billDate = '';
    if (k === 'period') { delete v.period; F.period = val; F.auto.description = true; setTaxSub(F, F.sub); redraw = true; }
    if (F.errs[k] && k !== 'date') { delete F.errs[k]; redraw = true; }
    if (k === 'accountId' || k === 'toAccountId' || k === 'paymentMode') redraw = true;
    if (redraw) draw(); else updateNet();
  };
  body.addEventListener('input', ev => { const el = ev.target.closest('[data-f]'); if (!el || el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date') return; setField(el.dataset.f, el.value); });
  body.addEventListener('change', ev => {
    const el = ev.target.closest('[data-f]');
    if (el) { if (el.type === 'checkbox') { v[el.dataset.f] = el.checked; updateNet(); return; } if (el.tagName === 'SELECT' || el.type === 'date') setField(el.dataset.f, el.value); return; }
    const o = ev.target.closest('[data-o]'); if (o) { F[o.dataset.o] = o.type === 'checkbox' ? o.checked : o.value; draw(); return; }
    if (ev.target.id === 'fFiles') addFiles([...ev.target.files]);
  });
  const addFiles = files => { const ok = files.filter(f => /^image\//.test(f.type) || f.type === 'application/pdf'); if (ok.length < files.length) toast('Only images and PDFs can be attached', 'error'); F.newFiles.push(...ok); draw(); };
  bindEmailEvents(body, () => F.email, draw);
  body.addEventListener('dragover', ev => { const d = ev.target.closest('.drop,.ef-attach'); if (d) { ev.preventDefault(); d.classList.add('over'); } });
  body.addEventListener('dragleave', ev => ev.target.closest('.drop,.ef-attach')?.classList.remove('over'));
  body.addEventListener('drop', ev => { const d = ev.target.closest('.drop,.ef-attach'); if (!d) return; ev.preventDefault(); addFiles([...ev.dataTransfer.files]); });
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-f-act]'); if (!b) return;
    const a = b.dataset.fAct; ev.preventDefault();
    if (a === 'close') return ov.remove();
    if (a === 'kind') { startKind(F, b.dataset.v); F.errs = {}; draw(); const first = $('.ef-main select, .ef-main input', body); first && first.focus(); return; }
    if (a === 'kind-reset') { F.kind = null; F.errs = {}; return draw(); }
    if (a === 'sub') { if (F.kind === 'employee') setEmpSub(F, b.dataset.v); else setTaxSub(F, b.dataset.v); return draw(); }
    if (a === 'pick-pi') { pickPI(F, b.dataset.id); return draw(); }
    if (a === 'nopi') { F.piMode = 'nopi'; if (v.piId) { v.piId = ''; ['projectId', 'refNo', 'description', 'categoryId'].forEach(k => { if (F.auto[k]) { v[k] = ''; F.auto[k] = false; } }); if (F.auto.departmentId) { v.departmentId = ''; F.auto.departmentId = false; F.deptAuto = true; } v.taxable = ''; } F.open.cat = !v.categoryId; F.open.dept = !v.departmentId; return draw(); }
    if (a === 'usepi') { F.piMode = 'pi'; return draw(); }
    if (a === 'open') { const k = b.dataset.k; if (k === 'more') F.more = !F.more; else if (k === 'email') F.emailOpen = !F.emailOpen; else if (k === 'gst') { F.showGst = true; if (!+v.gstRate) { v.gstRate = 18; const p = api.get('parties', v.partyId); v.gstType = p && p.gstType !== 'none' ? p.gstType : 'intra'; F.gstAuto = true; } } else if (k === 'tds') { F.showTds = true; if (!+v.tdsRate) { v.tdsRate = F.kind === 'vendor' ? 2 : 10; F.tdsAuto = true; } } else if (k === 'allcats') F.allCats = !F.allCats; else F.open[k] = !F.open[k]; return draw(); }
    if (a === 'use-suggest') { v.taxable = +b.dataset.v; F.gstAuto = F.tdsAuto = true; return draw(); }
    if (a === 'pick-file') return $('#fFiles', body).click();
    if (a === 'rm-new') { F.newFiles.splice(+b.dataset.i, 1); return draw(); }
    if (a === 'rm-old') { F.removed.push(b.dataset.id); v.attachments = v.attachments.filter(x => x.id !== b.dataset.id); return draw(); }
    if (a === 'new-party') return quickParty(KIND[F.kind].pk || 'other', p => { setField('partyId', p.id); });
    if (a === 'save' || a === 'save-more') {
      b.disabled = true;
      try {
        let saved = null;
        if (isTpl) await saveTemplate(F); else saved = await saveEntryFromForm(F);
        ov.remove();
        if (onSaved && saved) { try { await onSaved(saved); } catch (e2) { toast(e2.message, 'error'); } }
        afterWrite();
        if (a === 'save-more') openEntryForm({ kind: F.kind, preset: { type: v.type, date: v.date, accountId: v.accountId, paymentMode: v.paymentMode, kind: F.kind } });
      } catch (err) {
        F.errs = err.fields || {};
        if (F.errs.categoryId) F.open.cat = true; if (F.errs.departmentId) F.open.dept = true;
        draw(); toast(err.message, 'error'); b.disabled = false;
      }
    }
  });
}

/** A bank line fixes the net cash: keep date / account / mode / ref, and size the taxable value so net = bank amount. */
function taxableForNet(net, g, t) {
  g = +g || 0; t = +t || 0; const base = r2(net / (1 + g / 100 - t / 100));
  for (const d of [0, 0.01, -0.01, 0.02, -0.02, 0.03, -0.03, 0.04, -0.04, 0.05, -0.05]) { const tx = r2(base + d); if (Math.abs(r2(tx + r2(tx * g / 100) - r2(tx * t / 100)) - net) < 0.005) return tx; }
  return base;
}
function applyBankLock(F) {
  const B = F.bank; if (!B) return; const v = F.v;
  if (B.date) v.date = B.date; if (B.accountId && v.type !== 'transfer') v.accountId = B.accountId; if (B.txnRef) v.txnRef = B.txnRef; if (B.paymentMode) v.paymentMode = B.paymentMode;
  if (v.type === 'transfer' || F.kind === 'transfer') { v.amount = B.net; if (B.accountId) v.accountId = B.accountId; return; }
  if (!F.bankTyped) { v.taxable = taxableForNet(B.net, v.gstRate, v.tdsRate); F.auto.taxable = false; F.gstAuto = F.tdsAuto = true;
    const g = r2(v.taxable * (+v.gstRate || 0) / 100), t = r2(v.taxable * (+v.tdsRate || 0) / 100), diff = r2(B.net - (v.taxable + g - t));
    if (diff && Math.abs(diff) <= 0.05 && +v.gstRate > 0) { v.gstAmount = r2(g + diff); v.tdsAmount = t; F.gstAuto = false; } }
}
/* ---- kind setup & memory ---- */
function resetForKind(F, k) {
  const v = F.v, K = KIND[k];
  Object.assign(v, { type: K.type, partyKind: K.pk || '', partyId: '', categoryId: '', departmentId: '', projectId: '', piId: '', gstRate: 0, gstType: 'none', gstAmount: 0, tdsRate: 0, tdsAmount: 0, itc: K.type === 'outflow', toAccountId: '' });
  if (!F.mode.startsWith('template') && F.mode !== 'edit') { v.description = ''; v.refNo = ''; }
  Object.assign(F, { deptAuto: true, gstAuto: true, tdsAuto: true, showGst: false, showTds: false, open: {}, auto: {}, allCats: false, remembered: null, piMode: 'pi', email: null });
}
function _startKind(F, k, keepValues) {
  const prevKind = F.kind; F.kind = k;
  if (!keepValues || prevKind !== k) resetForKind(F, k);
  const v = F.v;
  // default account & mode: from the last entry of this kind
  const L = lastEntry(e => kindOfEntry(e) === k);
  if (L && !keepValues) { v.accountId = L.accountId; v.paymentMode = L.paymentMode; }
  if (k === 'employee') setEmpSub(F, F.sub && EMP_SUBS[F.sub] ? F.sub : 'salary');
  if (k === 'tax') { F.period = F.period || addMonths(ymOf(v.date || TODAY), -1); setTaxSub(F, F.sub && TAX_SUBS[F.sub] ? F.sub : 'gst'); }
  if (k === 'transfer') { v.type = 'transfer'; if (L) { v.accountId = L.accountId; v.toAccountId = L.toAccountId; } }
}
function startKind(F, k, keepValues) { const r = _startKind(F, k, keepValues); applyBankLock(F); return r; }
function _applyPartyMemory(F, p) {
  const v = F.v;
  const L = lastEntry(e => e.partyId === p.id && e.type === v.type && (F.kind !== 'employee' || subOfEntry('employee', e) === F.sub));
  if (F.kind === 'employee') { if (p.departmentId && F.deptAuto) { v.departmentId = p.departmentId; F.auto.departmentId = true; } setEmpSub(F, F.sub, L); return; }
  if (L) {
    if (catsFor(F).some(c => c.id === L.categoryId) || F.allCats) { v.categoryId = L.categoryId; F.auto.categoryId = true; }
    if (F.deptAuto && L.departmentId) { v.departmentId = L.departmentId; F.auto.departmentId = true; }
    Object.assign(v, { gstRate: L.gstRate, gstType: L.gstType, tdsRate: L.tdsRate, itc: L.itc, accountId: L.accountId, paymentMode: L.paymentMode });
    F.remembered = { date: L.date, amount: L.taxable };
  } else {
    v.gstRate = F.kind === 'vendor' && p.gstType !== 'none' ? 18 : 0; v.gstType = v.gstRate ? (p.gstType !== 'none' ? p.gstType : 'intra') : 'none'; v.tdsRate = 0; F.remembered = null;
    if (!v.categoryId) F.open.cat = true;
  }
  F.showGst = +v.gstRate > 0 || (F.kind === 'vendor' && p.gstType !== 'none'); F.showTds = +v.tdsRate > 0; F.gstAuto = F.tdsAuto = true;
  F.open.cat = !v.categoryId; F.open.dept = !v.departmentId;
}
function applyPartyMemory(F, p) { const r = _applyPartyMemory(F, p); applyBankLock(F); return r; }
function _applyCategoryMemory(F, catId) {
  const v = F.v, L = lastEntry(e => e.categoryId === catId);
  if (!L) return;
  const p = api.get('parties', L.partyId);
  if (p && !v.partyId && p.kind === 'other') v.partyId = p.id;
  if (F.deptAuto && L.departmentId) { v.departmentId = L.departmentId; F.auto.departmentId = true; }
  Object.assign(v, { gstRate: L.gstRate, gstType: L.gstType, tdsRate: L.tdsRate, itc: L.itc, accountId: L.accountId, paymentMode: L.paymentMode });
  F.showGst = +v.gstRate > 0; F.showTds = +v.tdsRate > 0; F.gstAuto = F.tdsAuto = true; F.remembered = { date: L.date, amount: L.taxable };
}
function applyCategoryMemory(F, catId) { const r = _applyCategoryMemory(F, catId); applyBankLock(F); return r; }
function _setEmpSub(F, sub, Lp) {
  const v = F.v; F.sub = sub;
  const p = api.get('parties', v.partyId);
  const lastSal = p ? lastEntry(e => e.partyId === p.id && ['cat_sal', 'cat_ceo'].includes(e.categoryId)) : null;
  v.categoryId = sub === 'reimb' ? 'cat_reimb' : sub === 'bonus' ? 'cat_bonus' : (lastSal ? lastSal.categoryId : 'cat_sal');
  if (!api.get('categories', v.categoryId)) { const alt = api.list('categories').find(c => c.type === 'outflow' && c.partyKind === 'employee'); v.categoryId = alt ? alt.id : ''; }
  F.auto.categoryId = true;
  v.gstRate = 0; v.gstType = 'none'; F.showGst = false;
  v.tdsRate = sub === 'reimb' ? 0 : (lastSal ? lastSal.tdsRate : 0); F.showTds = sub !== 'reimb'; F.tdsAuto = true;
  if (sub === 'salary' && p) { if (!(+v.taxable > 0) || F.auto.taxable) { v.taxable = lastSal ? lastSal.taxable : (p.monthlySalary || ''); F.auto.taxable = !!v.taxable; } }
  else if (F.auto.taxable) { v.taxable = ''; F.auto.taxable = false; }
  const L = Lp || (p ? lastEntry(e => e.partyId === p.id) : null); if (L) { v.accountId = L.accountId; v.paymentMode = L.paymentMode; }
  if (F.auto.description !== false || !v.description) { v.description = sub === 'salary' ? 'Salary – ' + monthLabel(ymOf(v.date || TODAY), true) : sub === 'bonus' ? 'Bonus' : ''; F.auto.description = true; }
}
function setEmpSub(F, sub, Lp) { const r = _setEmpSub(F, sub, Lp); applyBankLock(F); return r; }
function setTaxSub(F, sub, keepAmount) {
  const v = F.v; F.sub = sub; const [label, cat, party] = TAX_SUBS[sub];
  v.categoryId = api.get('categories', cat) ? cat : ''; v.partyId = api.get('parties', party) ? party : (v.partyId || ''); v.partyKind = 'other';
  if (api.get('departments', 'dep_fin') && F.deptAuto) { v.departmentId = 'dep_fin'; F.auto.departmentId = true; }
  v.gstRate = 0; v.gstType = 'none'; v.tdsRate = 0; F.showGst = F.showTds = false; F.gstAuto = F.tdsAuto = true;
  if (F.auto.description !== false || !v.description) { v.description = sub === 'adv' ? 'Advance tax' : (sub === 'gst' ? 'GSTR-3B liability' : sub === 'tds' ? 'TDS deposit' : 'Professional tax') + ' for ' + monthLabel(F.period, true); F.auto.description = true; }
  if (F.auto.taxable !== false || !(+v.taxable > 0)) { const sg = sub === 'adv' ? 0 : taxSuggest(sub, F.period); v.taxable = sg > 0 ? sg : ''; F.auto.taxable = sg > 0; }
  const L = lastEntry(e => e.categoryId === cat); if (L) { v.accountId = L.accountId; v.paymentMode = L.paymentMode; }
}
function _setClient(F, id) {
  const v = F.v; v.partyId = id; v.partyKind = 'client'; v.piId = '';
  const unpaid = api.list('pis').filter(p => p.clientId === id && p.status !== 'cancelled' && Sales.piState(p).outstanding > 0);
  F.piMode = unpaid.length ? 'pi' : 'nopi';
  if (unpaid.length === 1) pickPI(F, unpaid[0].id);
  else { const p = api.get('parties', id); v.gstRate = 18; v.gstType = p && p.gstType !== 'none' ? p.gstType : 'intra'; v.tdsRate = 10; F.showGst = F.showTds = true; F.gstAuto = F.tdsAuto = true; const L = lastEntry(e => e.partyId === id && e.type === 'inflow'); if (L) { v.accountId = L.accountId; v.paymentMode = L.paymentMode; } }
  F.open.cat = F.piMode === 'nopi' && !v.categoryId;
}
function setClient(F, id) { const r = _setClient(F, id); applyBankLock(F); return r; }
function _pickPI(F, id) {
  const v = F.v, pi = api.get('pis', id); if (!pi) return;
  const o = Sales.orderOfPI(pi), st = Sales.piState(pi);
  Object.assign(v, { piId: pi.id, partyId: pi.clientId, partyKind: 'client', projectId: pi.projectId || '', taxable: st.outstandingTaxable || pi.taxable, gstRate: pi.gstRate, gstType: pi.gstType, tdsRate: pi.tdsRate, categoryId: catForPI(pi) });
  if (F.deptAuto && o) v.departmentId = o.departmentId;
  F.auto = { ...F.auto, categoryId: true, departmentId: true, projectId: true };
  if (F.auto.refNo !== false) { v.refNo = pi.taxInvoiceNo || pi.piNo; F.auto.refNo = true; }
  if (F.auto.description !== false) { v.description = pi.milestone; F.auto.description = true; }
  F.showGst = +pi.gstRate > 0; F.showTds = true; F.gstAuto = F.tdsAuto = true; F.piMode = 'pi';
  const L = lastEntry(e => e.partyId === pi.clientId && e.type === 'inflow'); if (L) { v.accountId = L.accountId; v.paymentMode = L.paymentMode; }
}
function pickPI(F, id) { const r = _pickPI(F, id); applyBankLock(F); return r; }

/* ---- rendering ---- */
function billDateField(F, f) {
  const v = F.v, bd = v.billDate || v.date, ym = ymOf(bd || TODAY), locked = (+v.gstRate && typeof gstLocked === 'function' && gstLocked(ym)) || (+v.tdsRate && typeof tdsLocked === 'function' && tdsLocked(ym));
  return f('billDate', 'Bill date', `<input class="input" type="date" data-f="billDate" value="${esc(bd || '')}">`, '', locked ? `<span class="out">${monthLabel(ym, true)} is confirmed by the CA</span>` : `${[+v.gstRate && F.showGst ? 'ITC' : '', +v.tdsRate && F.showTds ? 'TDS' : ''].filter(Boolean).join(' & ')} in ${monthLabel(ym, true)}${F.billSet ? '' : ' · same as payment date'}`);
}
function taxInvoiceToggle(F) {
  const pi = api.get('pis', F.v.piId); if (!pi || typeof nextInvoiceNo !== 'function' || !api.can('gst.edit')) return '';
  if (pi.taxInvoiceDate) return `<div class="hint" style="margin-top:8px">Tax invoice ${esc(pi.taxInvoiceNo)} issued ${fmtDate(pi.taxInvoiceDate)}</div>`;
  if (F.issueTI === undefined) F.issueTI = F.mode === 'new' || F.mode === 'dup';
  return `<label class="check ef-tinv" style="margin-top:10px"><input type="checkbox" data-o="issueTI" ${F.issueTI ? 'checked' : ''}> Issue tax invoice <b class="mono">${esc(nextInvoiceNo(F.v.date || TODAY))}</b> dated ${fmtDate(F.v.date || TODAY)}</label><div class="hint">${F.issueTI ? 'GST on this PI goes into ' + monthLabel(ymOf(F.v.date || TODAY), true) + "'s sales register." : 'Not issuing now: GST on this receipt counts as an advance until you issue the invoice.'}</div>`;
}
function formBody(F) {
  const v = F.v, E = F.errs, isTpl = F.mode.startsWith('template');
  if (!F.kind) {
    const kinds = ENTRY_KINDS.filter(x => !isTpl || x.k !== 'transfer');
    return `${F.note ? `<div class="notice info" style="margin-bottom:14px">${icon('info')}<div>${F.note}</div></div>` : ''}<div class="ef-intro">What are you recording?</div><div class="ef-tiles">${[...new Set(kinds.map(x => x.grp))].map(g => `<div class="ef-grp"><div class="ef-gl">${g}</div><div class="ef-row">${kinds.filter(x => x.grp === g).map(x => `<button type="button" class="ef-tile ${x.type}" data-f-act="kind" data-v="${x.k}"><span class="ef-ti">${icon(x.ic)}</span><b>${x.label}</b><span>${x.sub}</span></button>`).join('')}</div></div>`).join('')}</div>`;
  }
  const K = KIND[F.kind];
  const f = (k, label, inner, cls = '', hint = '') => `<div class="field ${cls} ${E[k] ? 'has-err' : ''}"><label>${label}</label>${inner}${E[k] ? `<div class="err">${esc(E[k])}</div>` : hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  const inp = (k, attrs = '') => `<input class="input" data-f="${k}" value="${esc(v[k] ?? '')}" ${attrs}>`;
  const sel = (k, options) => `<select class="select" data-f="${k}">${options}</select>`;
  const money_ = (k, label, hint = '', cls = '') => f(k, label, `<div class="ef-money"><span>₹</span><input class="input num" data-f="${k}" value="${esc(v[k] ?? '')}" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0"></div>`, cls, hint);
  const link = (k, label) => `<button type="button" class="ef-link" data-f-act="open" data-k="${k}">${icon('plus').replace('<svg', '<svg style="width:13px;height:13px"')} ${label}</button>`;
  const chip = (key, label, value, select, autoFlag) => (F.open[key] || !value)
    ? select
    : `<div class="field"><label>${label}</label><button type="button" class="ef-chip" data-f-act="open" data-k="${key}" title="Change"><span class="ef-cn">${esc(value)}</span>${autoFlag ? '<span class="ef-auto">auto</span>' : ''}<span class="ef-chg">change</span></button></div>`;
  const deptChip = () => chip('dept', 'Department', nameOf('departments', v.departmentId), f('departmentId', 'Department *', sel('departmentId', deptOptions(v.departmentId))), F.auto.departmentId);
  const catChip = () => chip('cat', 'Category', nameOf('categories', v.categoryId), f('categoryId', 'Category *', sel('categoryId', catSelectOptions(catsFor(F), v.categoryId)), '', `<a href="#" data-f-act="open" data-k="allcats">${F.allCats ? 'Show the usual categories' : 'Show all categories'}</a>`), F.auto.categoryId);
  const partySel = (kind, label, emptyLabel) => f('partyId', label + ' *', `<div class="row" style="flex-wrap:nowrap;gap:6px">${sel('partyId', partyOptions(kind, v.partyId, emptyLabel))}<button type="button" class="btn" style="padding:0 10px" title="Add new ${kind}" data-f-act="new-party">${icon('plus')}</button></div>`, '', F.remembered && v.partyId ? `Filled from the last payment on ${fmtDate(F.remembered.date)} (${money(F.remembered.amount)})` : '');
  const gstTds = (tdsLabel) => `${F.showGst ? f('gstRate', 'GST', sel('gstRate', opts(GST_RATES.map(r => [r, r + '%']), v.gstRate))) : ''}${F.showTds ? f('tdsRate', tdsLabel, sel('tdsRate', opts(TDS_RATES.map(r => [r, r + '%']), v.tdsRate))) : ''}`;
  const gstTdsLinks = (tdsLabel) => (!F.showGst || !F.showTds) ? `<div class="ef-links">${!F.showGst ? link('gst', 'Add GST') : ''}${!F.showTds ? link('tds', 'Add ' + tdsLabel) : ''}</div>` : '';

  let h = '';
  // header
  h += `<div class="ef-head"><span class="type-ic ${K.type}">${icon(K.ic)}</span><div><b>${K.label}</b><div class="muted" style="font-size:12px">${K.sub}</div></div><span class="spacer"></span>${F.mode === 'confirm' ? `<span class="chip gold">${icon('repeat')} ${esc(F.rec.name)} · ${monthLabel(v.recurringPeriod, true)}</span>` : `<button type="button" class="btn btn-sm" data-f-act="kind-reset">Change type</button>`}</div>`;
  if (F.note) h += `<div class="notice info" style="margin-bottom:14px">${icon('info')}<div>${F.note}</div></div>`;
  if (F.mode === 'edit' && api.isLocked(v.date)) h += `<div class="notice" style="margin-bottom:14px">${icon('lock')}<div>This entry is in a locked month.</div></div>`;
  let m = '';
  if (isTpl) m += `<div class="fsec"><div class="fsec-h">Schedule</div><div class="fgrid c4">
    ${f('name', 'Template name *', inp('name', 'placeholder="e.g. Office rent"'), 'span2')}${f('frequency', 'Repeats', sel('frequency', opts(Object.entries(FREQ), v.frequency)))}${f('dayOfMonth', 'On day', inp('dayOfMonth', 'type="number" min="1" max="31"'), '', '31 = last day')}
    ${f('startDate', 'Starts', inp('startDate', 'type="date"'))}${f('endDate', 'Ends (optional)', inp('endDate', 'type="date"'))}
    <div class="field span2" style="justify-content:flex-end"><label class="check"><input type="checkbox" data-f="variable" ${v.variable ? 'checked' : ''}> Amount varies each cycle</label></div></div></div>`;

  if (F.kind === 'transfer') {
    m += `<div class="fsec"><div class="fgrid">${f('accountId', 'From account *', sel('accountId', accOptions(v.accountId)))}${f('toAccountId', 'To account *', sel('toAccountId', accOptions(v.toAccountId)))}${money_('amount', 'Amount *')}</div></div>`;
  } else if (F.kind === 'vendor') {
    m += `<div class="fsec"><div class="fgrid">${partySel('vendor', 'Vendor', 'Select vendor')}${v.partyId ? catChip() + deptChip() : ''}</div></div>`;
    if (v.partyId) { const vp = api.get('parties', v.partyId); const bl = bankLine(vp, true); m += `<div class="ef-payee">${bl ? `${icon('bank')}<span><span class="muted">Pay to</span> <b>${esc(bl)}</b></span><button type="button" class="icon-btn" title="Copy account details" data-act="copy" data-v="${esc(bl)}">${icon('copy')}</button>` : `${icon('bank')}<span class="muted">No bank details saved for this vendor.</span>`}${vp && vp.creditDays ? `<span class="ef-credit">${vp.creditDays} days credit</span>` : ''}</div>`; }
    if (v.partyId) m += `<div class="fsec"><div class="fgrid c4">${money_('taxable', 'Bill amount before GST *', '', 'span2')}${gstTds('TDS deducted')}${!isTpl ? f('refNo', 'Bill no.', inp('refNo', 'placeholder="Vendor bill / invoice no."'), F.showGst && F.showTds ? 'span2' : '') : ''}${!isTpl && ((F.showGst && +v.gstRate) || (F.showTds && +v.tdsRate)) ? billDateField(F, f) : ''}${F.showTds && +v.tdsRate && typeof tdsSectionField === 'function' ? tdsSectionField(F, f, sel) : ''}</div>${gstTdsLinks('TDS')}</div>`;
  } else if (F.kind === 'employee') {
    m += `<div class="fsec"><div class="fgrid">${partySel('employee', 'Employee', 'Select employee')}<div class="field span2"><label>Payment for</label><div class="seg">${Object.entries(EMP_SUBS).map(([k, l]) => `<button type="button" class="${F.sub === k ? 'on' : ''}" data-f-act="sub" data-v="${k}">${l}</button>`).join('')}</div></div></div></div>`;
    if (v.partyId) m += `<div class="fsec"><div class="fgrid">${money_('taxable', F.sub === 'salary' ? 'Gross salary *' : F.sub === 'bonus' ? 'Bonus (gross) *' : 'Amount *', F.sub === 'salary' && F.auto.taxable ? 'Last month\'s salary · change if different' : '')}${F.sub !== 'reimb' ? f('tdsRate', 'TDS on salary', sel('tdsRate', opts(TDS_RATES.map(r => [r, r + '%']), v.tdsRate))) : ''}${deptChip()}</div></div>`;
  } else if (F.kind === 'tax') {
    const sg = F.sub !== 'adv' ? taxSuggest(F.sub, F.period) : 0;
    const periods = Array.from({ length: 13 }, (_, i) => addMonths(ymOf(TODAY), -i));
    m += `<div class="fsec"><div class="fgrid"><div class="field span3"><label>Paying</label><div class="seg">${Object.entries(TAX_SUBS).map(([k, x]) => `<button type="button" class="${F.sub === k ? 'on' : ''}" data-f-act="sub" data-v="${k}">${x[0]}</button>`).join('')}</div></div>
      ${F.sub !== 'adv' ? f('period', 'For the month of', `<select class="select" data-f="period">${opts(periods.map(p => [p, monthLabel(p, true)]), F.period)}</select>`) : ''}
      ${money_('taxable', 'Amount paid *', sg > 0 ? `${F.sub === 'gst' ? 'Net GST for' : F.sub === 'tds' ? 'TDS deducted in' : 'Last PT payment'} ${F.sub === 'pt' ? '' : monthLabel(F.period, true)}: <b>${money(sg)}</b> ${+v.taxable !== sg ? `<a href="#" data-f-act="use-suggest" data-v="${sg}">use this</a>` : '✓'}` : F.sub === 'gst' ? 'No net GST payable for that month' : '')}
      ${!isTpl ? f('refNo', 'Challan no.', inp('refNo', 'placeholder="Challan / CIN"')) : ''}
      ${!api.get('parties', TAX_SUBS[F.sub][2]) ? partySel('other', 'Paid to', 'Select payee') : ''}</div></div>`;
  } else if (F.kind === 'other_out' || F.kind === 'other_in') {
    m += `<div class="fsec"><div class="fgrid">${f('categoryId', 'What for *', sel('categoryId', catSelectOptions(catsFor(F), v.categoryId)), '', `<a href="#" data-f-act="open" data-k="allcats">${F.allCats ? 'Show the usual categories' : 'Show all categories'}</a>`)}${partySel('other', F.kind === 'other_out' ? 'Paid to' : 'Received from', 'Select')}${v.categoryId ? deptChip() : ''}</div></div>`;
    if (v.categoryId) m += `<div class="fsec"><div class="fgrid c4">${money_('taxable', 'Amount' + (F.showGst ? ' before GST' : '') + ' *', F.remembered ? 'Last time: ' + money(F.remembered.amount) + ' on ' + fmtDate(F.remembered.date) : '', 'span2')}${gstTds(F.kind === 'other_in' ? 'TDS deducted by payer' : 'TDS deducted')}${F.kind === 'other_out' && F.showTds && +v.tdsRate && typeof tdsSectionField === 'function' ? tdsSectionField(F, f, sel) : ''}</div>${gstTdsLinks('TDS')}</div>`;
  } else if (F.kind === 'client') {
    const clients = api.list('parties').filter(p => p.kind === 'client' && (p.active || p.id === v.partyId)).map(p => ({ p, n: api.list('pis').filter(x => x.clientId === p.id && x.status !== 'cancelled' && Sales.piState(x).outstanding > 0).length })).sort((a, b) => (b.n > 0) - (a.n > 0) || a.p.name.localeCompare(b.p.name));
    m += `<div class="fsec"><div class="fgrid">${f('partyId', 'Client *', `<div class="row" style="flex-wrap:nowrap;gap:6px"><select class="select" data-f="partyId"><option value="">Select client</option>${clients.map(x => `<option value="${x.p.id}"${x.p.id === v.partyId ? ' selected' : ''}>${esc(x.p.name)}${x.n ? ` · ${x.n} unpaid PI${x.n > 1 ? 's' : ''}` : ''}</option>`).join('')}</select><button type="button" class="btn" style="padding:0 10px" data-f-act="new-party">${icon('plus')}</button></div>`, 'span2')}</div></div>`;
    if (v.partyId) {
      const unpaid = api.list('pis').filter(p => (p.clientId === v.partyId && p.status !== 'cancelled' && Sales.piState(p).outstanding > 0) || p.id === v.piId).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      if (F.piMode === 'pi' && !isTpl) {
        m += `<div class="fsec"><div class="fsec-h">Which invoice is this payment for?</div><div class="ef-pis">${unpaid.map(p => { const st = Sales.piState(p); return `<button type="button" class="ef-pi ${v.piId === p.id ? 'on' : ''}" data-f-act="pick-pi" data-id="${p.id}"><span class="ef-radio"></span><div class="grow"><b class="mono">${esc(p.piNo.split('/').slice(-2).join('/'))}</b> <span class="muted">· ${esc(nameOf('projects', p.projectId))}</span><div class="muted" style="font-size:12px">${esc(p.milestone)}</div></div><div style="text-align:right"><div class="num" style="font-weight:600">${money(st.outstanding)}</div>${st.overdueDays ? `<span class="chip overdue">${st.overdueDays}d overdue</span>` : `<span class="muted" style="font-size:11.5px">due ${fmtDate(p.dueDate)}</span>`}</div></button>`; }).join('') || '<div class="muted" style="font-size:13px">No unpaid PIs for this client.</div>'}</div>
          <button type="button" class="ef-link" data-f-act="nopi" style="margin-top:8px">No PI — advance or other receipt</button></div>`;
        if (v.piId) m += `<div class="fsec"><div class="fgrid c4">${money_('taxable', 'Invoice value settled, before GST *', 'Full balance pre-filled · change for a part payment', 'span2')}${f('gstRate', 'GST', sel('gstRate', opts(GST_RATES.map(r => [r, r + '%']), v.gstRate)))}${f('tdsRate', 'TDS by client', sel('tdsRate', opts(TDS_RATES.map(r => [r, r + '%']), v.tdsRate)))}</div>${taxInvoiceToggle(F)}</div>`;
      } else {
        m += `<div class="fsec">${unpaid.length && !isTpl ? `<div class="notice info" style="margin-bottom:12px">${icon('info')}<div>Recording without a PI. <a href="#" data-f-act="usepi">Link it to one of ${unpaid.length} unpaid PI${unpaid.length > 1 ? 's' : ''} instead</a></div></div>` : ''}<div class="fgrid">${catChip()}${f('projectId', 'Project', sel('projectId', projOptions(v.partyId, v.projectId, 'No project')))}${deptChip()}</div></div>
          <div class="fsec"><div class="fgrid c4">${money_('taxable', 'Amount before GST *', '', 'span2')}${gstTds('TDS by client')}</div>${gstTdsLinks('TDS')}</div>`;
      }
    }
  }
  // attachments (compact)
  const ready = F.kind === 'transfer' || v.partyId || v.categoryId;
  if (!isTpl && ready && F.kind !== 'transfer') m += `<div class="ef-attach" data-f-act="pick-file">${icon('clip')}<span>${(v.attachments || []).length + F.newFiles.length ? 'Add another document' : F.kind === 'client' ? 'Attach payment advice / remittance' : F.kind === 'tax' ? 'Attach challan' : F.kind === 'employee' ? 'Attach payslip or bill' : 'Attach bill or receipt'}</span><span class="faint">· drop here or click · images & PDF</span></div>
    <input type="file" id="fFiles" multiple accept="image/*,application/pdf" style="display:none">${(v.attachments || []).length + F.newFiles.length ? `<div class="files" style="margin:-6px 0 14px">${(v.attachments || []).map(a => `<div class="file"><span>${esc(a.name)}</span><button type="button" data-f-act="rm-old" data-id="${a.id}">${icon('x').replace('<svg', '<svg style="width:12px;height:12px"')}</button></div>`).join('')}${F.newFiles.map((fl, i) => `<div class="file" style="border-color:var(--gold-line);background:var(--gold-soft)"><span>${esc(fl.name)}</span><button type="button" data-f-act="rm-new" data-i="${i}">${icon('x').replace('<svg', '<svg style="width:12px;height:12px"')}</button></div>`).join('')}</div>` : ''}`;
  // payment row
  if (ready) m += `<div class="fsec ef-pay"><div class="fsec-h">${F.kind === 'transfer' ? 'Details' : 'Payment'}</div><div class="fgrid ${isTpl ? 'c2' : 'c4'}">
    ${!isTpl ? f('date', 'Date *', inp('date', 'type="date"')) : ''}${f('paymentMode', 'Mode', sel('paymentMode', opts(PAYMENT_MODES.map(x => [x, x]), v.paymentMode)))}
    ${F.kind !== 'transfer' ? f('accountId', K.type === 'inflow' ? 'Received into *' : 'Paid from *', sel('accountId', accOptions(v.accountId))) : ''}${!isTpl ? f('txnRef', 'UTR / cheque / ref', inp('txnRef')) : ''}
    ${F.kind === 'transfer' ? f('description', 'Description', inp('description', 'placeholder="e.g. Petty cash top-up"'), 'span2') : ''}</div></div>`;
  // more details
  if (ready && F.kind !== 'transfer') {
    m += `<button type="button" class="ef-more ${F.more ? 'open' : ''}" data-f-act="open" data-k="more">${icon('chev')} More details <span class="faint">${['description', F.kind === 'client' && F.piMode === 'pi' ? 'invoice no.' : '', 'project', 'notes', F.showGst ? 'GST type & ITC' : '', F.mode === 'new' ? 'repeat' : ''].filter(Boolean).join(' · ')}</span></button>`;
    if (F.more) m += `<div class="fsec ef-morebox"><div class="fgrid">
      ${f('description', 'Description', inp('description', 'placeholder="What was this for?"'), 'span2')}
      ${(F.kind === 'client' && F.piMode === 'pi') || F.kind === 'other_out' || F.kind === 'other_in' || F.kind === 'employee' ? f('refNo', F.kind === 'client' ? 'Invoice no.' : 'Reference no.', inp('refNo')) : ''}
      ${['vendor', 'employee', 'other_out', 'other_in'].includes(F.kind) || (F.kind === 'client' && F.piMode === 'pi') ? f('projectId', 'Project', sel('projectId', projOptions(F.kind === 'client' ? v.partyId : '', v.projectId, 'No project'))) : ''}
      ${F.kind !== 'tax' ? f('departmentId', 'Department', sel('departmentId', deptOptions(v.departmentId))) : ''}
      ${F.showGst && +v.gstRate ? f('gstType', 'GST type', sel('gstType', opts([['intra', GST_TYPES.intra], ['inter', GST_TYPES.inter]], v.gstType))) + f('gstAmount', 'GST amount (₹)', inp('gstAmount', 'type="number" step="0.01" min="0"'), '', 'Auto · override if the bill differs') : ''}
      ${F.showTds && +v.tdsRate ? f('tdsAmount', 'TDS amount (₹)', inp('tdsAmount', 'type="number" step="0.01" min="0"'), '', 'Auto · override if needed') : ''}
      ${K.type === 'outflow' && F.showGst && +v.gstRate ? `<div class="field" style="justify-content:flex-end"><label class="check" style="height:38px"><input type="checkbox" data-f="itc" ${v.itc ? 'checked' : ''}> Input GST claimable</label></div>` : ''}
      ${!isTpl ? f('notes', 'Notes', `<textarea class="textarea" data-f="notes" rows="2">${esc(v.notes || '')}</textarea>`, 'span3') : ''}
      ${F.mode === 'new' ? `<div class="field span3"><label class="check"><input type="checkbox" data-o="repeat" ${F.repeat ? 'checked' : ''}> Repeat this every cycle</label>${F.repeat ? `<div class="row" style="margin-top:8px"><select class="select sel-sm" data-o="rFreq">${opts(Object.entries(FREQ), F.rFreq)}</select><span class="muted" style="font-size:12.5px">on day ${+String(v.date).slice(8) || 1} · future cycles appear in Recurring</span></div>` : ''}</div>` : ''}
    </div></div>`;
  }
  // email (collapsed line by default)
  if (F.email && ready) {
    if (F.emailOpen) m += emailBoxHTML(F.email, { docs: (v.attachments || []).length + F.newFiles.length }) + `<button type="button" class="ef-link" data-f-act="open" data-k="email" style="margin:-8px 0 12px">Collapse email</button>`;
    else m += `<div class="ef-mail ${F.email.on ? 'on' : ''}"><label class="check"><input type="checkbox" data-em="on" ${F.email.on ? 'checked' : ''}> ${icon('mail').replace('<svg', '<svg style="width:15px;height:15px"')} Email ${F.email.kind === 'vendor_payment' ? 'payment advice' : 'receipt'} to</label>
      <span class="ef-mail-to">${F.email.on ? (F.email.to.length ? emailWho(F.email) : '<span class="out">no address yet</span>') : '<span class="faint">not sending</span>'}</span><button type="button" class="ef-link" data-f-act="open" data-k="email">${F.email.on ? 'Edit email' : 'Set up'}</button></div>`;
  }
  return h + `<div class="ef-grid"><div class="ef-main">${m}</div><aside class="ef-side"><div id="sumBox">${summaryHTML(F)}</div></aside></div>`;
}
function emailWho(E) { const p = api.get('parties', E.partyId), cs = partyContacts(p); const nm = x => { const c = cs.find(c => c.email === x); return c && c.name ? esc(c.name) + ' <span class="faint">' + esc(x) + '</span>' : esc(x); }; const cc = splitEmails(E.cc).length; return E.to.map(nm).join(', ') + (cc ? ` <span class="faint">· cc ${cc}</span>` : ''); }
function summaryHTML(F) {
  const v = F.v; if (!F.kind) return '';
  const K = KIND[F.kind], t = +v.taxable || 0, g = +v.gstAmount || 0, d = +v.tdsAmount || 0;
  const net = F.kind === 'transfer' ? +v.amount || 0 : r2(t + g - d);
  const row = (k, val, auto) => val ? `<div class="ef-sr"><span>${k}</span><b>${esc(val)}${auto ? ' <span class="ef-auto">auto</span>' : ''}</b></div>` : '';
  const pi = api.get('pis', v.piId);
  const lbl = { transfer: 'Amount moved', inflow: 'Net cash received', outflow: 'Net cash paid' }[K.type];
  return `<div class="ef-sum ${K.type}"><div class="ef-sl">${lbl}</div><div class="ef-sv">${money(net)}</div>
    ${F.kind !== 'transfer' && (g || d) ? `<div class="ef-calc"><div><span>Before GST</span><span>${money(t)}</span></div>${g ? `<div><span>+ GST ${v.gstRate}%</span><span>${money(g)}</span></div>` : ''}${d ? `<div><span>− TDS ${v.tdsRate}%</span><span>${money(d)}</span></div>` : ''}</div>` : ''}
    <div class="ef-srs">
      ${F.kind === 'transfer' ? row('From', nameOf('accounts', v.accountId)) + row('To', nameOf('accounts', v.toAccountId)) : row(K.pk === 'client' ? 'Client' : K.pk === 'employee' ? 'Employee' : K.pk === 'vendor' ? 'Vendor' : 'Party', nameOf('parties', v.partyId))}
      ${pi ? row('Against PI', pi.piNo.split('/').slice(-2).join('/')) : ''}
      ${F.kind !== 'transfer' ? row('Category', nameOf('categories', v.categoryId), F.auto.categoryId) + row('Department', nameOf('departments', v.departmentId), F.auto.departmentId) + row('Project', v.projectId ? (api.get('projects', v.projectId) || {}).code : '', F.auto.projectId) + row(K.type === 'inflow' ? 'Into' : 'From', nameOf('accounts', v.accountId)) : ''}
      ${row('Mode', v.paymentMode)}${!F.mode.startsWith('template') ? row('Date', fmtDate(v.date)) : ''}
      ${F.email ? row('Email', F.email.on ? (F.email.to.length ? F.email.to.length + ' recipient' + (F.email.to.length > 1 ? 's' : '') : 'needs address') : 'Off') : ''}
    </div></div>`;
}
async function saveEntryFromForm(F) {
  const v = F.v;
  const input = { ...v };
  delete input.id; delete input.createdAt; delete input.createdBy; delete input.updatedAt; delete input.updatedBy; delete input.deleted; delete input.deletedAt; delete input.deletedBy;
  input.taxable = +input.taxable || 0; input.amount = +input.amount || 0;
  const errs = api.validateEntry(api.normaliseEntry(input));
  if (F.mode === 'edit' && api.isLocked(F.v.date)) errs.date = 'Locked month';
  if (Object.keys(errs).length) { const e = new Error(Object.values(errs)[0]); e.fields = errs; throw e; }
  const metas = [];
  for (const fl of F.newFiles) {
    const id = uid('f'); const meta = { id, name: fl.name, type: fl.type, size: fl.size };
    await FileStore.put({ ...meta, blob: fl }); metas.push(meta);
  }
  input.attachments = [...(v.attachments || []), ...metas];
  if (F.kind === 'tax' && F.period && F.sub !== 'adv') input.taxPeriod = F.period;
  input.billDate = input.type === 'outflow' && (+input.gstRate > 0 || +input.tdsRate > 0) && input.partyKind !== 'employee' && F.kind !== 'employee' ? (input.billDate || input.date) : null;
  if (input.type === 'outflow' && +input.tdsRate > 0 && typeof tdsSectionOf === 'function') input.tdsSection = F.kind === 'employee' ? '192' : (input.tdsSection || tdsSectionOf(input) || null);
  if (input.tdsSection && F.kind === 'vendor') { const vp = api.get('parties', input.partyId), c = api.get('categories', input.categoryId); if (vp && input.tdsSection !== (vp.tdsSection || (c && c.tdsSection))) { vp.tdsSection = input.tdsSection; } }
  const tiPI = F.kind === 'client' && F.issueTI && input.piId ? api.get('pis', input.piId) : null;
  if (tiPI && !tiPI.taxInvoiceDate) { if (typeof assertGstOpen === 'function') assertGstOpen([ymOf(input.date)], 'this invoice'); if (!F.auto || F.auto.refNo !== false || !input.refNo || input.refNo === tiPI.piNo) input.refNo = nextInvoiceNo(input.date); }
  checkEmail(F.email);
  const saved = await api.saveEntry(input, F.mode === 'edit' ? v.id : null);
  if (tiPI && !tiPI.taxInvoiceDate) { try { await issueTaxInvoice(tiPI.id, saved.date, saved.refNo); } catch (err) { toast('Saved, but the tax invoice was not issued: ' + err.message, 'error'); } }
  const mail = await finalizeEmail(F.email, { entity: 'entries', entityId: saved.id, docs: saved.attachments || [] }).catch(err => { toast('Saved, but the email was not queued: ' + err.message, 'error'); return null; });
  for (const id of F.removed) await FileStore.del(id).catch(() => {});
  if (F.repeat && F.mode === 'new') {
    const r = { name: (nameOf('categories', saved.categoryId) + ' – ' + nameOf('parties', saved.partyId)).slice(0, 60), type: saved.type, categoryId: saved.categoryId, departmentId: saved.departmentId, partyId: saved.partyId, projectId: saved.projectId, description: saved.description, taxable: saved.taxable, gstType: saved.gstType, gstRate: saved.gstRate, tdsRate: saved.tdsRate, itc: saved.itc, paymentMode: saved.paymentMode, accountId: saved.accountId, frequency: F.rFreq, dayOfMonth: +saved.date.slice(8), startDate: saved.date, endDate: null, active: true, skipped: [] };
    const rr = await api.create('recurring', r);
    saved.recurringId = rr.id; saved.recurringPeriod = ymOf(saved.date); Store.persist();
  }
  toast((F.mode === 'edit' ? 'Entry updated' : F.mode === 'confirm' ? 'Recorded ' + F.rec.name : 'Entry saved · ' + money(saved.amount)) + (mail ? ' · email queued to ' + mail.to.join(', ') : ''));
  return saved;
}
async function saveTemplate(F) {
  const v = F.v, errs = {};
  if (!v.name) errs.name = 'Name is required';
  if (!v.categoryId) errs.categoryId = 'Choose a category';
  if (!v.departmentId) errs.departmentId = 'Choose a department';
  if (!v.partyId) errs.partyId = 'Choose a party';
  if (!(+v.taxable > 0)) errs.taxable = 'Enter an amount';
  if (!(+v.dayOfMonth >= 1 && +v.dayOfMonth <= 31)) errs.dayOfMonth = '1–31';
  if (!v.startDate) errs.startDate = 'Required';
  if (!v.accountId) errs.accountId = 'Choose an account';
  if (Object.keys(errs).length) { const e = new Error(Object.values(errs)[0]); e.fields = errs; throw e; }
  const r = { name: v.name, type: v.type, categoryId: v.categoryId, departmentId: v.departmentId, partyId: v.partyId, projectId: v.projectId || null, description: v.description, taxable: r2(v.taxable), gstType: +v.gstRate ? v.gstType : 'none', gstRate: +v.gstRate, tdsRate: +v.tdsRate, itc: v.type === 'outflow' && +v.gstRate > 0 && !!v.itc, paymentMode: v.paymentMode, accountId: v.accountId, frequency: v.frequency, dayOfMonth: +v.dayOfMonth, startDate: v.startDate, endDate: v.endDate || null, variable: !!v.variable };
  if (F.mode === 'template-edit') { api.guard('recurring.edit'); await api.update('recurring', F.rec.id, r); toast('Template updated'); }
  else { api.guard('recurring.create'); await api.create('recurring', { ...r, active: true, skipped: [] }); toast('Recurring template created'); }
}
function quickParty(kind, cb) {
  if (kind === 'client' || kind === 'vendor') return partyForm(kind, null, { quick: true, cb });
  const ov = openModal(`<div class="modal-h"><h2>New ${esc(PARTY_KINDS_SHORT[kind] || 'party').toLowerCase()}</h2></div><div class="modal-b"><div class="fgrid c2">
    <div class="field span3"><label>Name *</label><input class="input" id="qpName"></div>
    ${kind === 'employee' ? `<div class="field span3"><label>Department *</label><select class="select" id="qpDept">${deptOptions('')}</select></div>` : `<div class="field"><label>GSTIN</label><input class="input" id="qpGstin"></div><div class="field"><label>GST type</label><select class="select" id="qpGst">${opts(Object.entries(GST_TYPES), kind === 'client' ? 'intra' : 'none')}</select></div>`}
    </div></div><div class="modal-f"><button class="btn" data-x="no">Cancel</button><button class="btn btn-gold" data-x="yes">Add</button></div>`, 'sm');
  setTimeout(() => $('#qpName', ov).focus(), 50);
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-x]'); if (!b) return;
    if (b.dataset.x === 'no') return ov.remove();
    const name = $('#qpName', ov).value.trim(); if (!name) return toast('Name is required', 'error');
    const rec = { kind, name, gstin: $('#qpGstin', ov)?.value || '', gstType: $('#qpGst', ov)?.value || 'none', departmentId: $('#qpDept', ov)?.value || null, designation: '', monthlySalary: null, joinDate: null, email: '', phone: '', active: true };
    if (kind === 'employee' && !rec.departmentId) return toast('Choose a department', 'error');
    if (kind === 'other' && typeof window !== 'undefined' && typeof (window as any).__supabaseSaveOtherParty === 'function') {
      try {
        const sbOp = await (window as any).__supabaseSaveOtherParty({
          name: rec.name,
          gstin: rec.gstin,
          default_gst_type: rec.gstType,
          is_active: true
        });
        if (sbOp && sbOp.id) {
          rec.supabase_id = sbOp.id;
          rec.id = String(sbOp.id);
        }
      } catch (e) {
        console.warn('Supabase quickParty other save error:', e);
      }
    }
    try { api.guard('party.create'); const p = await api.create('parties', rec); ov.remove(); toast('Added ' + name); cb(p); } catch (err) { toast(err.message, 'error'); }
  });
}
function afterWrite() { closeDrawer(); render(); }

/* ============================ REPORTS ============================ */
const REPORT_TABS = [['parties', 'Parties'], ['projects', 'Projects'], ['departments', 'Departments'], ['categories', 'Category trends'], ['tax', 'GST & TDS'], ['burn', 'Burn & runway'], ['forecast', 'Forecast']];
PAGES.reports = {
  title: 'Reports',
  render() {
    const tabs = `<div class="tabs">${REPORT_TABS.map(([k, l]) => `<button class="${S.report === k ? 'on' : ''}" data-act="report-tab" data-tab="${k}">${l}</button>`).join('')}</div>`;
    return tabs + (REPORTS[S.report] || REPORTS.parties)();
  },
  after() { REPORTS_AFTER[S.report] && REPORTS_AFTER[S.report](); },
};
const REPORTS_AFTER = {};
const REPORTS = {
  parties() {
    const [from, to] = fyRange(S.fy); const kind = S.reportKind;
    const ents = Calc.inRange(from, to).filter(e => e.type !== 'transfer' && e.partyKind === kind);
    const by = {};
    for (const e of ents) { const r = by[e.partyId] = by[e.partyId] || { n: 0, in: 0, out: 0, tax: 0, gst: 0, tds: 0 }; r.n++; r[e.type === 'inflow' ? 'in' : 'out'] += e.amount; r.tax += e.taxable; r.gst += e.gstAmount; r.tds += e.tdsAmount; }
    const rows = Object.entries(by).map(([id, r]) => ({ id, ...r, main: Math.max(r.in, r.out) })).sort((a, b) => b.main - a.main);
    const tIn = sum(rows, r => r.in), tOut = sum(rows, r => r.out); const base = kind === 'client' ? tIn : tOut || tIn;
    return `<div class="toolbar"><div class="seg">${Object.entries(PARTY_KINDS_SHORT).map(([k, l]) => `<button class="${kind === k ? 'on' : ''}" data-act="rep-kind" data-v="${k}">${l}s</button>`).join('')}</div><span class="spacer"></span><span class="muted" style="font-size:12.5px">${esc(fyLabel(S.fy))} · cash basis · click a row for its entries</span></div>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${PARTY_KINDS_SHORT[kind]}</th><th class="num">Entries</th><th class="num">Taxable</th><th class="num">GST</th><th class="num">TDS</th><th class="num">Cash in</th><th class="num">Cash out</th><th style="width:18%">Share</th></tr></thead><tbody>
    ${rows.slice(0, S.partyAll ? rows.length : 10).map(r => { const p = api.get('parties', r.id) || {}; const share = pct(kind === 'client' ? r.in : (r.out || r.in), base); return `<tr class="click" data-act="ledger-party" data-id="${r.id}"><td><div class="cell-main">${esc(p.name || '—')}</div>${p.kind === 'employee' ? `<div class="cell-sub">${esc(p.designation || '')} · ${esc(nameOf('departments', p.departmentId))}</div>` : p.gstin ? `<div class="cell-sub mono">${esc(p.gstin)}</div>` : ''}</td><td class="num">${r.n}</td><td class="num">${money(r.tax)}</td><td class="num muted">${money(r.gst)}</td><td class="num muted">${money(r.tds)}</td><td class="num in">${r.in ? money(r.in) : '–'}</td><td class="num out">${r.out ? money(r.out) : '–'}</td><td><div class="row" style="gap:8px;flex-wrap:nowrap">${bar(share, kind === 'client' ? 'in' : 'gold')}<span class="num muted" style="font-size:12px;min-width:44px;text-align:right">${fmtPct(share)}</span></div></td></tr>`; }).join('') || `<tr><td colspan="8"><div class="empty">No ${PARTY_KINDS_SHORT[kind].toLowerCase()} entries in ${esc(fyLabel(S.fy))}.</div></td></tr>`}
    ${rows.length > 10 ? `<tr><td colspan="8" style="text-align:center"><button class="btn btn-sm" data-act="party-all">${S.partyAll ? 'Show top 10 only' : 'Show all ' + rows.length + ' ' + PARTY_KINDS_SHORT[kind].toLowerCase() + 's'}</button></td></tr>` : ''}
    </tbody>${rows.length ? `<tfoot><tr><td>Total · ${rows.length}</td><td class="num">${sum(rows, r => r.n)}</td><td class="num">${money(sum(rows, r => r.tax))}</td><td class="num">${money(sum(rows, r => r.gst))}</td><td class="num">${money(sum(rows, r => r.tds))}</td><td class="num in">${money(tIn)}</td><td class="num out">${money(tOut)}</td><td></td></tr></tfoot>` : ''}</table></div></div>`;
  },
  projects() {
    const scopeAll = S.projScope === 'all'; const [from, to] = fyRange(S.fy);
    const ents = Calc.live().filter(e => e.projectId && (scopeAll || (e.date >= from && e.date <= to)));
    const rows = api.list('projects').map(p0 => { const p = { ...p0, contractValue: Sales.projectContract(p0.id) };
      const es = ents.filter(e => e.projectId === p.id);
      const rec = sum(es.filter(e => e.type === 'inflow'), e => e.taxable), cost = sum(es.filter(e => e.type === 'outflow'), e => e.taxable);
      const cin = sum(es.filter(e => e.type === 'inflow'), e => e.amount), cout = sum(es.filter(e => e.type === 'outflow'), e => e.amount);
      return { p, rec, cost, cin, cout, contrib: rec - cost, n: es.length };
    }).filter(r => r.n || scopeAll).sort((a, b) => b.rec - a.rec);
    const T = k => sum(rows, r => r[k]);
    return `<div class="toolbar"><div class="seg">${[['all', 'All time'], ['fy', fyLabel(S.fy)]].map(([k, l]) => `<button class="${S.projScope === k ? 'on' : ''}" data-act="proj-scope" data-v="${k}">${l}</button>`).join('')}</div><span class="spacer"></span><span class="muted" style="font-size:12.5px;max-width:520px">Receipts and direct costs are shown pre-GST (taxable value). Contribution = receipts − costs tagged to the project; salaries and overheads are not allocated.</span></div>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Project</th><th>Client</th><th>Dept</th><th>Status</th><th class="num">Contract value</th><th class="num">Received</th><th style="width:120px">Collected</th><th class="num">Direct costs</th><th class="num">Contribution</th><th class="num">Margin</th><th class="num">Net cash</th></tr></thead><tbody>
    ${rows.map(r => { const col = pct(r.rec, r.p.contractValue); const m = pct(r.contrib, r.rec); return `<tr class="click" data-act="ledger-proj" data-id="${r.p.id}"><td><div class="cell-main">${esc(r.p.code)}</div><div class="cell-sub">${esc(r.p.name)}</div></td><td>${esc(nameOf('parties', r.p.clientId))}</td><td class="nowrap">${esc(nameOf('departments', r.p.departmentId))}</td><td><span class="chip ${r.p.status === 'active' ? 'gold' : ''}">${esc(r.p.status)}</span></td>
      <td class="num">${r.p.contractValue ? money(r.p.contractValue) : '—'}</td><td class="num in">${money(r.rec)}</td><td>${r.p.contractValue ? `<div class="row" style="gap:6px;flex-wrap:nowrap">${bar(col, 'in')}<span class="num muted" style="font-size:11.5px">${Math.round(col)}%</span></div>` : ''}</td>
      <td class="num out">${money(r.cost)}</td><td class="num" style="font-weight:600">${money(r.contrib)}</td><td class="num ${m < 50 ? 'out' : ''}">${r.rec ? fmtPct(m) : '—'}</td><td class="num">${money(r.cin - r.cout, { sign: true })}</td></tr>`; }).join('')}
    </tbody><tfoot><tr><td colspan="4">Total · ${rows.length} projects</td><td class="num">${money(sum(rows, r => r.p.contractValue || 0))}</td><td class="num in">${money(T('rec'))}</td><td></td><td class="num out">${money(T('cost'))}</td><td class="num">${money(T('contrib'))}</td><td class="num">${fmtPct(pct(T('contrib'), T('rec')))}</td><td class="num">${money(T('cin') - T('cout'), { sign: true })}</td></tr></tfoot></table></div></div>`;
  },
  departments() {
    const periods = fyPeriods(S.fy, 'monthly'), len = periods.length; if (!len) return '<div class="card"><div class="empty">No months yet.</div></div>';
    const [fyF] = fyRange(S.fy), lastTo = periods[len - 1].to;
    const ents = Calc.inRange(fyF, lastTo).filter(e => e.type !== 'transfer');
    const scope = 'rd:';
    const build = type => {
      const agg = aggregate(ents.filter(e => e.type === type), periods, e => e.departmentId + '|' + e.categoryId);
      const nodes = finishTree(api.list('departments').map(d => ({ key: scope + type + ':' + d.id, label: d.name, drill: { departmentId: d.id },
        children: categoryTree(type, c => agg[d.id + '|' + c.id] || periods.map(() => 0), scope + type + ':' + d.id + ':', { departmentId: d.id }) })), len);
      nodes.sort((a, b) => sum(b.vals) - sum(a.vals)); return nodes;
    };
    const tOut = build('outflow'), tIn = build('inflow');
    const all = [...tOut, ...tIn];
    prepareTree(scope, all);
    const cells = (type, base) => (n, depth) => periods.map((p, i) => `<td class="num ${n.vals[i] ? 'hit' : 'zero'} ${p.cur ? 'cur' : ''}" ${n.vals[i] && n.drill ? drillAttr(type, n.drill, p.from, p.to) : ''}>${n.vals[i] ? money(n.vals[i]) : '–'}</td>`).join('') + `<td class="num tot-c">${money(sum(n.vals))}</td><td class="num share"><span class="muted">${fmtPct(pct(sum(n.vals), base))}</span></td>`;
    const sec = (label, nodes, type) => { const tv = periods.map((_, i) => sum(nodes, n => n.vals[i])); return `<tr class="sec ${type === 'inflow' ? 'in-sec' : 'out-sec'}"><td>${label}</td>${tv.map((v, i) => `<td class="num ${periods[i].cur ? 'cur' : ''}">${money(v)}</td>`).join('')}<td class="num tot-c">${money(sum(tv))}</td><td class="num share">100%</td></tr>` + treeRowsHTML(nodes, cells(type, sum(tv))); };
    return `<div class="cf-bar"><div><div class="lbl">Detail</div>${levelSeg(scope, all, [['summary', 'Departments'], ['1', 'Buckets'], ['2', 'Groups'], ['all', 'All lines']])}</div><span class="spacer"></span><span class="muted" style="font-size:12.5px">${esc(fyLabel(S.fy))} · months that haven't started are hidden · click a figure to see its entries</span></div>
    <div class="card"><div class="tbl-wrap cf-wrap"><table class="tbl sticky-first cf"><thead><tr><th class="first">Department</th>${periods.map(p => `<th class="num ${p.cur ? 'cur' : ''}">${esc(p.label)}</th>`).join('')}<th class="num tot-c">FY to date</th><th class="num share">Share</th></tr></thead><tbody>
    ${sec('Outflow by department', tOut, 'outflow')}${sec('Inflow by department', tIn, 'inflow')}</tbody></table></div></div>`;
  },
  categories() {
    const months = fyMonths(S.fy).filter(m => m <= ymOf(TODAY)), prevMonths = fyMonths(S.fy - 1);
    const per = months.map(m => ({ months: [m] }));
    const prevP = [{ months: prevMonths }];
    const live = Calc.live().filter(e => e.type !== 'transfer');
    const scope = 'rc:';
    const build = type => {
      const agg = aggregate(live.filter(e => e.type === type), per, e => e.categoryId);
      const prev = aggregate(live.filter(e => e.type === type), prevP, e => e.categoryId);
      // vals = monthly values + [prev FY] as last element
      const nodes = finishTree(categoryTree(type, c => [...(agg[c.id] || per.map(() => 0)), (prev[c.id] || [0])[0]], scope), months.length + 1);
      nodes.forEach(function srt(n) { if (n.children) { n.children.sort((a, b) => sum(b.vals.slice(0, -1)) - sum(a.vals.slice(0, -1))); n.children.forEach(srt); } });
      return nodes;
    };
    const tOut = build('outflow'), tIn = build('inflow'); const all = [...tOut, ...tIn];
    prepareTree(scope, all);
    const elapsed = months.length || 1;
    const cells = (type, base) => (n, depth) => {
      const v = n.vals.slice(0, -1), t = sum(v), prev = n.vals[n.vals.length - 1]; const ch = prev ? pct(t - prev, prev) : null;
      return `<td>${sparkline(v, 110, 24, type === 'outflow' ? '#B4432F' : '#1E7A4F')}</td><td class="num tot-c" ${n.drill ? drillAttr(type, n.drill, fyRange(S.fy)[0], TODAY) : ''}>${money(t)}</td><td class="num">${money(t / elapsed)}</td><td class="num muted">${fmtPct(pct(t, base))}</td><td class="num muted">${prev ? money(prev) : '—'}</td><td class="num ${ch == null ? 'faint' : (ch > 0) === (type === 'outflow') ? 'out' : 'in'}">${ch == null ? '—' : (ch > 0 ? '+' : '') + ch.toFixed(1) + '%'}</td>`;
    };
    const sec = (label, nodes, type) => { const t = sum(nodes, n => sum(n.vals.slice(0, -1))), p = sum(nodes, n => n.vals[n.vals.length - 1]); return `<tr class="sec ${type === 'inflow' ? 'in-sec' : 'out-sec'}"><td>${label}</td><td></td><td class="num tot-c">${money(t)}</td><td class="num">${money(t / elapsed)}</td><td class="num">100%</td><td class="num">${money(p)}</td><td></td></tr>` + treeRowsHTML(nodes, cells(type, t)); };
    return `<div class="cf-bar"><div><div class="lbl">Detail</div>${levelSeg(scope, all, [['summary', 'Summary'], ['1', 'Groups'], ['all', 'All lines']])}</div><span class="spacer"></span><span class="muted" style="font-size:12.5px">${esc(fyLabel(S.fy))} to date vs ${esc(fyLabel(S.fy - 1))} full year</span></div>
    <div class="card"><div class="tbl-wrap"><table class="tbl cf"><thead><tr><th class="first">Bucket / category</th><th>Monthly trend</th><th class="num tot-c">FY to date</th><th class="num">Avg / month</th><th class="num">Share</th><th class="num">Previous FY</th><th class="num">Change</th></tr></thead><tbody>
    ${sec('Outflow', tOut, 'outflow')}${sec('Inflow', tIn, 'inflow')}</tbody></table></div></div>
    <div class="muted" style="font-size:12.5px;margin-top:10px">Average per month uses the ${elapsed} month(s) elapsed. Change compares this FY to date with the full previous FY, so it reads low until the year is complete.</div>`;
  },
  tax() {
    const months = fyMonths(S.fy).filter(m => m <= ymOf(TODAY));
    const live = Calc.live();
    const calc = ms => {
      const es = live.filter(e => ms.includes(ymOf(e.date)));
      const ins = es.filter(e => e.type === 'inflow'), outs = es.filter(e => e.type === 'outflow');
      const og = sum(ins, e => e.gstAmount), ig = sum(outs.filter(e => e.itc), e => e.gstAmount);
      return { og, ig, nitc: sum(outs.filter(e => !e.itc), e => e.gstAmount), net: og - ig, paid: sum(outs.filter(e => e.categoryId === 'cat_gstpay'), e => e.amount), tdsC: sum(ins, e => e.tdsAmount), tdsU: sum(outs, e => e.tdsAmount), tdsDep: sum(outs.filter(e => e.categoryId === 'cat_tdsdep'), e => e.amount), adv: sum(outs.filter(e => e.categoryId === 'cat_advtax'), e => e.amount) };
    };
    const scope = 'rt:';
    const quarters = [0, 1, 2, 3].map(q => fyMonths(S.fy).slice(q * 3, q * 3 + 3).filter(m => months.includes(m))).filter(q => q.length);
    const nodes = quarters.map((ms, q) => ({ key: scope + q, label: 'Q' + (q + 1) + ' · ' + MON[+ms[0].slice(5) - 1] + '–' + MON[+ms[ms.length - 1].slice(5) - 1] + (ms.length < 3 ? ' (to date)' : ''), r: calc(ms), vals: [1], children: ms.map(m => ({ key: scope + m, label: monthLabel(m, true), r: calc(m ? [m] : []), vals: [1] })) }));
    prepareTree(scope, nodes);
    const K = ['og', 'ig', 'net', 'paid', 'nitc', 'tdsC', 'tdsU', 'tdsDep', 'adv'];
    const cells = n => K.map(k => `<td class="num ${n.r[k] ? '' : 'zero'} ${k === 'net' ? 'tot-c' : ''}">${n.r[k] ? money(n.r[k]) : '–'}</td>`).join('');
    const T = calc(months);
    const card = (l, v, s) => `<div class="card kpi"><div class="k-l">${l}</div><div class="k-v">${money(v)}</div><div class="k-s">${s}</div></div>`;
    return `<div class="stack"><div class="grid g-kpi" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      ${card('Net GST liability', T.net, 'Output ' + money(T.og) + ' − ITC ' + money(T.ig))}${card('GST paid to Govt', T.paid, 'Cash paid in ' + esc(fyLabel(S.fy)) + ' to date')}
      ${card('TDS credit (by clients)', T.tdsC, 'Claim against income tax')}${card('TDS deducted vs deposited', T.tdsU, 'Deposited ' + money(T.tdsDep))}</div>
    <div class="cf-bar"><div><div class="lbl">Detail</div>${levelSeg(scope, nodes, [['summary', 'Quarters'], ['all', 'Months']])}</div><span class="spacer"></span><span class="muted" style="font-size:12.5px;max-width:560px">Cash basis from recorded entries. GST paid and TDS deposited in a month usually settle the previous month. Use to reconcile with GSTR-3B and challans; it is not a return.</span></div>
    <div class="card"><div class="tbl-wrap"><table class="tbl sticky-first cf"><thead><tr><th class="first">${esc(fyLabel(S.fy))}</th><th class="num">Output GST</th><th class="num">Input GST (ITC)</th><th class="num tot-c">Net GST liability</th><th class="num">GST paid</th><th class="num">GST not claimable</th><th class="num">TDS by clients</th><th class="num">TDS by IUOVA</th><th class="num">TDS deposited</th><th class="num">Advance tax</th></tr></thead><tbody>
    ${treeRowsHTML(nodes, cells)}<tr class="tot"><td>FY to date</td>${K.map(k => `<td class="num ${k === 'net' ? 'tot-c' : ''}">${money(T[k])}</td>`).join('')}</tr></tbody></table></div></div></div>`;
  },
  burn() {
    const months = fyMonths(S.fy).filter(m => m <= ymOf(TODAY));
    const m = Calc.monthly(months);
    const rows = months.map((ym, i) => {
      const end = ymDate(ym, 31) < TODAY ? ymDate(ym, 31) : TODAY;
      const prev3 = [1, 2, 3].map(k => addMonths(ym, -k)); const p3 = Calc.monthly(prev3); const avg = sum(p3.outflow) / 3;
      const cash = Calc.cash(end, { includeFD: false }), cashFD = Calc.cash(end);
      return { ym, in: m.inflow[i], out: m.outflow[i], net: m.net[i], netBurn: Math.max(0, m.outflow[i] - m.inflow[i]), cash, cashFD, avg, runway: avg ? cash / avg : null, partial: ym === ymOf(TODAY) };
    });
    REPORTS_AFTER.burn = () => bindChartTip('burnChart', rows.map(r => ({ label: monthLabel(r.ym, true), items: [['Cash & bank', money(r.cash)], ['Incl. FD', money(r.cashFD)], ['Runway', r.runway ? r.runway.toFixed(1) + ' mo' : '—']] })));
    return `<div class="stack"><div class="card"><div class="card-h"><div class="grow"><h3>Month-end cash</h3><div class="sub">Bank + petty cash, and including FD</div></div><div class="chart-legend"><span><i style="background:#1B2A4A"></i>Cash & bank</span><span><i style="background:#EBA937"></i>Incl. FD</span></div></div>
      ${lineChart('burnChart', rows.map(r => monthLabel(r.ym)), [{ values: rows.map(r => r.cash), color: '#1B2A4A' }, { values: rows.map(r => r.cashFD), color: '#EBA937', dash: true }])}</div>
      <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Month</th><th class="num">Inflow</th><th class="num">Outflow (gross burn)</th><th class="num">Net</th><th class="num">Net burn</th><th class="num">Avg outflow, prior 3 mo</th><th class="num">Month-end cash & bank</th><th class="num">Incl. FD</th><th class="num">Runway</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${monthLabel(r.ym, true)}${r.partial ? ' <span class="chip gold">to date</span>' : ''}</td><td class="num in">${money(r.in)}</td><td class="num out">${money(r.out)}</td><td class="num ${r.net >= 0 ? 'in' : 'out'}">${money(r.net, { sign: true })}</td><td class="num">${r.netBurn ? money(r.netBurn) : '–'}</td><td class="num muted">${money(r.avg)}</td><td class="num" style="font-weight:600">${money(r.cash)}</td><td class="num muted">${money(r.cashFD)}</td><td class="num">${r.runway ? r.runway.toFixed(1) + ' mo' : '—'}</td></tr>`).join('')}
      </tbody></table></div></div><div class="muted" style="font-size:12.5px">Runway = month-end cash & bank (excluding FD) ÷ average gross outflow of the three months before. It answers “how long could we pay everything if no money came in”.</div></div>`;
  },
  forecast() {
    const cur = ymOf(TODAY); const next = [1, 2, 3].map(k => addMonths(cur, k));
    const burn = Calc.avgBurn(3); const months3 = burn.months;
    const nr = Calc.live().filter(e => months3.includes(ymOf(e.date)) && !e.recurringId);
    const avgOutNR = sum(nr.filter(e => e.type === 'outflow'), e => e.amount) / 3;
    // unpaid PIs → expected net cash (after the client's TDS) by due month
    const unpaid = api.list('pis').map(p => ({ p, ...Sales.piState(p) })).filter(x => x.outstanding > 0).map(x => ({ ...x, exp: r2(x.outstanding * (x.p.total - x.p.tdsAmount) / x.p.total), when: x.p.dueDate <= ymDate(cur, 31) ? cur : ymOf(x.p.dueDate) }));
    const piIn = ym => sum(unpaid.filter(x => x.when === ym), x => x.exp);
    const hasPI = (clientId, ym) => unpaid.some(x => x.p.clientId === clientId && ymOf(x.p.date) === ym);
    const recIn = items => sum(items.filter(i => i.rec.type === 'inflow' && !hasPI(i.rec.partyId, i.period)), i => i.net);
    const pendNow = Calc.pendingRecurring(ymDate(cur, 31));
    const pIn = recIn(pendNow) + piIn(cur), pOut = sum(pendNow.filter(p => p.rec.type === 'outflow'), p => p.net);
    const cash = Calc.cash(TODAY, { includeFD: false }); let open = cash + pIn - pOut;
    const cols = next.map(ym => {
      const items = Calc.recurringInMonth(ym);
      const rin = recIn(items), pin = piIn(ym), rout = sum(items.filter(i => i.rec.type === 'outflow'), i => i.net);
      const o = open, close = o + rin + pin - rout - avgOutNR; open = close;
      return { ym, o, rin, pin, rout, eout: avgOutNR, close };
    });
    const later = sum(unpaid.filter(x => x.when > next[2]), x => x.exp);
    const book = sum(api.list('orders'), o => Sales.orderState(o).toInvoice);
    const R = (label, k, cls = '') => `<tr class="${cls}"><td>${label}</td>${cols.map(c => `<td class="num">${money(c[k])}</td>`).join('')}</tr>`;
    const detail = next.map(ym => Calc.recurringInMonth(ym)).flat().reduce((acc, i) => { acc[i.rec.id] = acc[i.rec.id] || { rec: i.rec, n: 0, t: 0 }; acc[i.rec.id].n++; acc[i.rec.id].t += i.net; return acc; }, {});
    return `<div class="stack"><div class="notice">${icon('alert')}<div><b>This is a projection, not a record.</b> Receipts come from <b>unpaid PIs by due date</b> (overdue ones assumed this month, net of the client's TDS) plus recurring retainers. Payments use recurring templates plus the ${monthLabel(months3[2])}–${monthLabel(months3[0])} average of other payments (${money(avgOutNR)} a month). The ${money(book)} order book not yet invoiced is <b>not</b> included because its timing is unknown.</div></div>
    <div class="grid g-kpi" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="card kpi"><div class="k-l">Cash & bank today</div><div class="k-v">${money(cash)}</div><div class="k-s">Excludes FD</div></div>
      <div class="card kpi"><div class="k-l">Still due this month</div><div class="k-v">${money(pIn - pOut, { sign: true })}</div><div class="k-s">In ${money(pIn)} · out ${money(pOut)}</div></div>
      <div class="card kpi"><div class="k-l">Unpaid PIs expected</div><div class="k-v in">${money(sum(unpaid, x => x.exp))}</div><div class="k-s">${unpaid.length} PIs${later ? ' · ' + money(later) + ' due later' : ''}</div></div>
      <div class="card kpi accent"><div class="k-l">Projected cash · end ${monthLabel(next[2])}</div><div class="k-v">${money(cols[2].close)}</div><div class="k-s">${money(cols[2].close - cash, { sign: true })} vs today</div></div></div>
    <div class="card"><div class="tbl-wrap"><table class="tbl cf sticky-first"><thead><tr><th style="min-width:260px">3-month projection</th>${cols.map(c => `<th class="num">${monthLabel(c.ym, true)}</th>`).join('')}</tr></thead><tbody>
    ${R('Opening cash & bank', 'o', 'bal')}<tr class="sec in-sec"><td>Inflow</td><td colspan="3"></td></tr>${R('Unpaid PIs falling due', 'pin', 'd1 leaf')}${R('Recurring receipts (not yet invoiced)', 'rin', 'd1 leaf')}
    <tr class="sec out-sec"><td>Outflow</td><td colspan="3"></td></tr>${R('Recurring payments (salaries, rent…)', 'rout', 'd1 leaf')}${R('Expected other payments (3-mo avg)', 'eout', 'd1 leaf')}
    <tr class="net"><td>Net</td>${cols.map(c => `<td class="num ${c.close - c.o >= 0 ? 'in' : 'out'}">${money(c.close - c.o, { sign: true })}</td>`).join('')}</tr>${R('Closing cash & bank', 'close', 'bal')}</tbody></table></div></div>
    <div class="grid g-2"><div class="card"><div class="card-h"><h3 class="grow">Unpaid PIs in the projection</h3><a class="btn btn-sm" href="#/pis">All PIs</a></div>${unpaid.sort((a, b) => a.p.dueDate.localeCompare(b.p.dueDate)).map(x => `<div class="list-row" data-act="open-pi" data-id="${x.p.id}" style="cursor:pointer"><div class="grow"><div class="t">${esc(nameOf('parties', x.p.clientId))}</div><div class="s">${esc(x.p.piNo)} · due ${fmtDate(x.p.dueDate)}</div></div><div style="text-align:right"><div class="num in" style="font-weight:600">${money(x.exp)}</div><div class="muted" style="font-size:11.5px">${monthLabel(x.when)}</div></div></div>`).join('') || '<div class="empty">No unpaid PIs.</div>'}</div>
    <div class="card"><div class="card-h"><h3 class="grow">Recurring items</h3><span class="sub">${monthLabel(next[0])} – ${monthLabel(next[2])}</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Template</th><th class="num">Cycles</th><th class="num">Net total</th></tr></thead><tbody>
    ${Object.values(detail).sort((a, b) => b.t - a.t).map(d => `<tr><td>${esc(d.rec.name)}</td><td class="num">${d.n}</td><td class="num ${d.rec.type === 'inflow' ? 'in' : 'out'}">${d.rec.type === 'inflow' ? '+' : '−'}${money(d.t)}</td></tr>`).join('')}</tbody></table></div></div></div></div>`;
  },
};

/* ============================ RECURRING ============================ */
PAGES.recurring = {
  title: 'Recurring',
  render() {
    const pend = Calc.pendingRecurring(addDays(TODAY, 30));
    const overdue = pend.filter(p => p.overdue);
    const posted = new Set(Calc.live().filter(e => e.recurringId).map(e => e.recurringId + '|' + e.recurringPeriod));
    const nextDue = r => { for (const p of recurringPeriods(r, addDays(TODAY, 400))) if (!posted.has(r.id + '|' + p.period) && !(r.skipped || []).includes(p.period)) return p; return null; };
    const tpls = api.list('recurring').slice().sort((a, b) => (b.active - a.active) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    return `<div class="page-intro">Each template creates a due item every cycle. Nothing enters the cashflow until it is recorded. Change the amount in the row if this cycle's bill is different, then press Record; use the pencil for a different date, account, bill number or attachment.</div>
    <div class="stack"><div class="card"><div class="card-h"><div class="grow"><h3>Due & upcoming · next 30 days</h3><div class="sub">${pend.length} item(s)${overdue.length ? ` · <span class="out">${overdue.length} overdue</span>` : ''}</div></div>
      ${pend.length > 1 ? `<span class="muted" style="font-size:12px">Net ${money(sum(pend.filter(p => p.rec.type === 'inflow'), p => p.net) - sum(pend.filter(p => p.rec.type === 'outflow'), p => p.net), { sign: true })}</span>` : ''}</div>
      ${pend.length ? `<div class="due-head"><span class="grow">Item</span><span class="due-when"></span><span class="due-amt">Amount (pre-GST)</span><span class="due-net">Net cash</span><span class="due-acts"></span></div>` : ''}${pend.map(p => dueRow(p, { inline: true })).join('') || '<div class="empty"><b>All caught up</b>No recurring items due in the next 30 days.</div>'}</div>
    <div class="card"><div class="card-h"><div class="grow"><h3>Templates</h3><div class="sub">${tpls.filter(t => t.active).length} active · ${tpls.filter(t => !t.active).length} paused</div></div><button class="btn btn-navy btn-sm" data-act="new-template">${icon('plus')} New template</button></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Type</th><th>Category · department</th><th>Party</th><th class="num">Net per cycle</th><th>Schedule</th><th>Next due</th><th>Status</th><th></th></tr></thead><tbody>
    ${tpls.map(r => { const n = nextDue(r); return `<tr><td class="cell-main">${esc(r.name)}</td><td>${typeChip(r.type)}</td><td><div>${esc(nameOf('categories', r.categoryId))}</div><div class="cell-sub">${esc(nameOf('departments', r.departmentId))}</div></td><td>${esc(nameOf('parties', r.partyId))}</td>
      <td class="num ${r.type === 'inflow' ? 'in' : 'out'}">${r.variable ? (() => { const sg = recurringSuggest(r); return `<span title="Last recorded amount">${money(recurringNet(r, sg.suggested))}</span><div class="cell-sub">varies · avg ${money(recurringNet(r, sg.forecast))}</div>`; })() : money(recurringNet(r))}</td><td class="nowrap">${FREQ[r.frequency]} · day ${r.dayOfMonth}${r.endDate ? `<div class="cell-sub">until ${fmtDate(r.endDate)}</div>` : ''}</td>
      <td class="nowrap">${r.active && n ? fmtDate(n.dueDate) + (n.dueDate < TODAY ? ' <span class="chip overdue">overdue</span>' : '') : '—'}</td><td><span class="chip ${r.active ? 'inflow' : ''}">${r.active ? 'Active' : 'Paused'}</span></td>
      <td class="nowrap"><button class="icon-btn" title="Edit" data-act="edit-template" data-id="${r.id}">${icon('edit')}</button><button class="icon-btn" title="${r.active ? 'Pause' : 'Resume'}" data-act="toggle-template" data-id="${r.id}">${icon(r.active ? 'pause' : 'play')}</button>${api.can('recurring.delete') ? `<button class="icon-btn" title="Delete" data-act="del-template" data-id="${r.id}">${icon('trash')}</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="9"><div class="empty">No templates yet.</div></td></tr>'}
    </tbody></table></div></div></div>`;
  },
};

/* ============================ MASTERS ============================ */
const MASTER_TABS = [['client', 'Clients'], ['vendor', 'Vendors'], ['employee', 'Employees'], ['other', 'Other parties'], ['projects', 'Projects'], ['departments', 'Departments'], ['categories', 'Categories'], ['accounts', 'Bank accounts']];
function masterDef(tab) {
  const kinds = ['client', 'vendor', 'employee', 'other'];
  if (kinds.includes(tab)) return {
    col: 'parties', filter: p => p.kind === tab, perm: 'party', usage: p => Calc.live().filter(e => e.partyId === p.id),
    fields: [['name', 'Name *', 'text', { req: 1, span: 2 }], ...(tab === 'employee'
      ? [['departmentId', 'Department *', 'select', { req: 1, options: () => api.list('departments').map(d => [d.id, d.name]) }], ['designation', 'Designation', 'text'], ['monthlySalary', 'Monthly salary (₹)', 'number'], ['joinDate', 'Joined', 'date']]
      : [['gstin', 'GSTIN', 'text'], ['gstType', 'Default GST type', 'select', { options: () => Object.entries(GST_TYPES) }]]), ['email', 'Emails', 'text', { hint: () => 'Separate several with commas. Used for payment advices, receipts and PIs.' }], ['phone', 'Phone', 'text']],
    defaults: { kind: tab, gstType: tab === 'client' ? 'intra' : 'none' },
    cols: (tab === 'client' || tab === 'vendor') ? [
      ['Name', p => { normalizeParty(p); const r = emailRoute(p, tab === 'client' ? 'pi_issued' : 'vendor_payment'), c = partyContacts(p).find(x => x.email === r.to[0]) || partyContacts(p)[0]; return `<a href="#" class="cell-main pd-link" data-act="open-party" data-id="${p.id}">${esc(p.name)}</a><div class="cell-sub">${c ? esc(contactLabel(c)) + (c.email && c.name ? ' · ' + esc(c.email) : '') : '<span class="out">No contact yet</span>'}</div>`; }],
      ['People', p => { const n = partyContacts(p).length; return `<span class="chip">${n} ${n === 1 ? 'person' : 'people'}</span>`; }],
      ['State · GST', p => `<div>${esc(IN_STATES[p.stateCode] || '—')}</div><div class="cell-sub mono">${esc(p.gstin || 'No GSTIN')}</div>`],
      ['Credit', p => p.creditDays != null && p.creditDays !== '' ? p.creditDays + ' days' : '—'],
      ...(tab === 'vendor' ? [['Bank', p => p.bank && (p.bank.accNo || p.bank.upi) ? `<span class="muted" style="font-size:12.5px">${esc(p.bank.bankName || 'UPI')} ${esc(maskAcc(p.bank.accNo))}</span>` : '<span class="faint">—</span>']] : []),
    ] : [['Name', p => `<div class="cell-main">${esc(p.name)}</div>${p.email ? `<div class="cell-sub">${esc(p.email)}</div>` : ''}`], ...(tab === 'employee' ? [['Department', p => esc(nameOf('departments', p.departmentId))], ['Designation', p => esc(p.designation || '—')], ['Salary', p => `<span class="num">${p.monthlySalary ? money(p.monthlySalary) : '—'}</span>`]] : [['GSTIN', p => `<span class="mono" style="font-size:12px">${esc(p.gstin || '—')}</span>`], ['GST', p => esc(GST_TYPES[p.gstType] || '—')]])],
  };
  return {
    projects: { col: 'projects', filter: () => true, perm: 'project', usage: p => Calc.live().filter(e => e.projectId === p.id),
      fields: [['code', 'Project code *', 'text', { req: 1 }], ['name', 'Project name *', 'text', { req: 1 }], ['clientId', 'Client *', 'select', { req: 1, options: () => api.list('parties').filter(p => p.kind === 'client').map(p => [p.id, p.name]) }], ['departmentId', 'Department *', 'select', { req: 1, options: () => api.list('departments').map(d => [d.id, d.name]) }], ['contractValue', 'Contract value (₹, pre-GST)', 'number', { hint: () => 'Used only when the project has no orders; otherwise the sum of its orders is used.' }], ['startDate', 'Start date', 'date'], ['status', 'Status', 'select', { options: () => [['active', 'Active'], ['on-hold', 'On hold'], ['completed', 'Completed']] }]],
      defaults: { status: 'active' },
      cols: [['Project', p => `<div class="cell-main">${esc(p.code)}</div><div class="cell-sub">${esc(p.name)}</div>`], ['Client', p => esc(nameOf('parties', p.clientId))], ['Department', p => esc(nameOf('departments', p.departmentId))], ['Contract', p => { const v = Sales.projectContract(p.id); return `<span class="num">${v ? money(v) : '—'}</span>`; }], ['Status', p => `<span class="chip ${p.status === 'active' ? 'gold' : ''}">${esc(p.status)}</span>`]] },
    departments: { col: 'departments', filter: () => true, perm: 'department', usage: d => Calc.live().filter(e => e.departmentId === d.id), fields: [['name', 'Department name *', 'text', { req: 1, span: 2 }], ['managerName', 'Manager', 'text', { hint: () => 'Gets a scorecard login (prototype)' }], ['managerEmail', 'Manager email', 'text']], defaults: {}, cols: [['Department', d => `<span class="cell-main">${esc(d.name)}</span>`], ['Manager', d => esc(d.managerName || '—') + (d.managerEmail ? `<div class="cell-sub">${esc(d.managerEmail)}</div>` : '')]] },
    categories: { col: 'categories', filter: () => true, perm: 'category', usage: c => Calc.live().filter(e => e.categoryId === c.id),
      fields: [
        ['name', 'Category name *', 'text', { req: 1, span: 2 }],
        ['type', 'Type *', 'select', { req: 1, lockOnEdit: 1, options: () => [['outflow', 'Outflow'], ['inflow', 'Inflow']] }],
        ['bucket', 'Summary bucket', 'select', { options: () => {
          const live = (typeof window !== 'undefined' && (window as any).__categorySummaryBucketList);
          if (live && live.length) return live.map((b: any) => [b.name, b.name]);
          return [
            ['Operating costs (outflow)', 'Operating costs (outflow)'],
            ['Project costs (outflow)', 'Project costs (outflow)'],
            ['Tax & statutory (outflow)', 'Tax & statutory (outflow)'],
            ['Capex (outflow)', 'Capex (outflow)'],
            ['Financing & owner (outflow)', 'Financing & owner (outflow)'],
            ['Operating receipts (inflow)', 'Operating receipts (inflow)'],
            ['Other income (inflow)', 'Other income (inflow)'],
            ['Financing (inflow)', 'Financing (inflow)']
          ];
        }, hint: () => 'Top level in summary views. Leave blank to derive from group & nature.' }],
        ['group', 'Group *', 'select', { req: 1, options: () => {
          const defaults = ['People', 'Office – Fixed', 'Office – Variable', 'Travel', 'Project Costs', 'Professional & Admin', 'Capex / Purchases', 'Statutory & Tax', 'Financing & Owner', 'Operating Receipts', 'Other Income', 'Financing'];
          const live = (typeof window !== 'undefined' && (window as any).__categoryGroupList) || [];
          const existing = api.list('categories').map(c => c.group).filter(Boolean);
          const all = Array.from(new Set([...defaults, ...live, ...existing]));
          return all.map(g => [g, g]);
        } }],
        ['partyKind', 'Usually linked to', 'select', { options: () => {
          const live = (typeof window !== 'undefined' && (window as any).__categoryLinkedToList);
          if (live && live.length) return live.map((l: any) => [l.name.toLowerCase(), l.name]);
          return [['client', 'Client'], ['vendor', 'Vendor'], ['employee', 'Employee'], ['other', 'Other']];
        } }],
        ['kind', 'Nature', 'select', { options: () => {
          const live = (typeof window !== 'undefined' && (window as any).__categoryNatureList);
          if (live && live.length) return live.map((n: any) => {
            const val = { 'Operating': 'operating', 'Statutory / Tax': 'tax', 'Capex': 'capex', 'Financing / Owner': 'financing' }[n.name] || n.name.toLowerCase();
            return [val, n.name];
          });
          return [['operating', 'Operating'], ['tax', 'Statutory / Tax'], ['capex', 'Capex'], ['financing', 'Financing / Owner']];
        } }],
        ['sac', 'SAC code', 'text', { hint: () => 'For receipts: printed in the GST sales register. Confirm codes with your CA.' }],
        ['itcBlocked', 'Input GST on bills', 'select', {
          options: () => {
            const live = (typeof window !== 'undefined' && (window as any).__categoryInputGstOnBillsList);
            if (live && live.length) {
              return live.filter((g: any) => g.is_active !== false).map((g: any) => {
                const isBlocked = g.value === 'blocked_not_claimable' || (g.label || '').toLowerCase().includes('blocked');
                return [isBlocked ? '1' : '', g.label];
              });
            }
            return [['', 'Claimable (ITC)'], ['1', 'Blocked · not claimable']];
          },
          noEmpty: 1,
          hint: () => {
            const live = (typeof window !== 'undefined' && (window as any).__categoryInputGstOnBillsList);
            const blocked = live?.find((g: any) => g.value === 'blocked_not_claimable');
            return blocked?.description || 'Blocked: food, gifts, personal use, motor vehicles (Sec. 17(5))';
          }
        }],
        ['tdsSection', 'TDS section (payments)', 'select', { options: () => {
          const live = (typeof window !== 'undefined' && (window as any).__categoryTdsSectionList);
          if (live && live.length) return live.map((s: any) => [s.code, `${s.code} · ${s.description || s.code}`]);
          return [['192', '192 · Salary'], ['194C', '194C · Contractors'], ['194J', '194J · Professional / technical fees'], ['194I', '194I · Rent'], ['194H', '194H · Commission / brokerage'], ['194A', '194A · Interest (other than bank)']];
        }, hint: () => 'Suggested on payments in this category; changeable per entry' }]
      ],
      defaults: { type: 'outflow', partyKind: 'vendor', kind: 'operating' },
      cols: [['Category', c => `<div class="cell-main">${esc(c.name)}</div><div class="cell-sub">${esc(BUCKET_LABEL[bucketOf(c)])} › ${esc(c.group)}</div>`], ['Type', c => typeChip(c.type)], ['Linked to', c => esc(PARTY_KINDS_SHORT[c.partyKind] || '—')], ['Nature', c => esc(CAT_KINDS[c.kind] || '—')], ['TDS', c => c.tdsSection ? `<span class="mono" style="font-size:12px">${esc(c.tdsSection)}</span>` : '<span class="faint">—</span>'], ['GST', c => c.type === 'inflow' ? (c.sac ? `<span class="mono" style="font-size:12px">SAC ${esc(c.sac)}</span>` : '<span class="faint">—</span>') : c.itcBlocked ? '<span class="chip overdue">ITC blocked</span>' : '<span class="faint">ITC</span>']] },
    accounts: { col: 'accounts', filter: () => true, perm: 'account', usage: a => Calc.live().filter(e => e.accountId === a.id || e.toAccountId === a.id),
      fields: [['name', 'Account name *', 'text', { req: 1, span: 2 }], ['type', 'Type', 'select', { options: () => Object.entries(ACCOUNT_TYPES) }], ['number', 'Account no. (masked)', 'text'], ['openingBalance', 'Opening balance (₹)', 'number', { hint: () => 'As of ' + fmtDate(Store.data.settings.openingDate) }]],
      defaults: { type: 'bank', openingBalance: 0 },
      cols: [['Account', a => `<div class="cell-main">${esc(a.name)}</div><div class="cell-sub">${esc(a.number || '')}</div>`], ['Type', a => esc(ACCOUNT_TYPES[a.type])], ['Opening', a => `<span class="num">${money(a.openingBalance)}</span>`], ['Balance today', a => `<b class="num">${money(Calc.balance(a.id, TODAY))}</b>`]] },
  }[tab];
}
const permKey = (perm, act) => ['party', 'project'].includes(perm) ? perm + '.' + act : perm + '.edit';
PAGES.masters = {
  title: 'Masters',
  render() {
    const tab = S.master, def = masterDef(tab);
    const recs = api.list(def.col).filter(def.filter).slice().sort((a, b) => (b.active - a.active) || String(a.code || a.name).localeCompare(String(b.code || b.name)));
    const canAdd = api.can(permKey(def.perm, 'create'));
    return `<div class="tabs">${MASTER_TABS.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="master-tab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div class="card"><div class="card-h"><div class="grow"><h3>${MASTER_TABS.find(t => t[0] === tab)[1]}</h3><div class="sub">${recs.filter(r => r.active).length} active${recs.some(r => !r.active) ? ' · ' + recs.filter(r => !r.active).length + ' inactive' : ''}</div></div>
    ${canAdd ? `<button class="btn btn-navy btn-sm" data-act="master-new">${icon('plus')} Add</button>` : `<span class="muted" style="font-size:12px">Only the Owner can change these</span>`}</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr>${def.cols.map(c => `<th>${c[0]}</th>`).join('')}<th class="num">Entries</th><th>Status</th><th></th></tr></thead><tbody>
    ${recs.map(r => `<tr style="${r.active ? '' : 'opacity:.55'}">${def.cols.map(c => `<td>${c[1](r)}</td>`).join('')}<td class="num">${def.usage(r).length}</td><td><span class="chip ${r.active ? 'inflow' : ''}">${r.active ? 'Active' : 'Inactive'}</span></td><td class="nowrap">${api.can(permKey(def.perm, 'edit')) ? `<button class="icon-btn" title="Edit" data-act="master-edit" data-id="${r.id}">${icon('edit')}</button><button class="icon-btn" title="Delete" data-act="master-delete" data-id="${r.id}" style="color:var(--out);margin-left:4px">${icon('trash')}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="${def.cols.length + 3}"><div class="empty">Nothing here yet.</div></td></tr>`}
    </tbody></table></div></div>`;
  },
};
function masterForm(tab, id) {
  const def = masterDef(tab); const rec = id ? api.get(def.col, id) : null; const v = rec ? { ...rec } : { ...def.defaults };
  if (tab === 'categories') {
    v.itcBlocked = v.itcBlocked ? '1' : '';
    const bucketKeyToName = {
      'op_cost': 'Operating costs (outflow)',
      'proj_cost': 'Project costs (outflow)',
      'tax': 'Tax & statutory (outflow)',
      'capex': 'Capex (outflow)',
      'fin_out': 'Financing & owner (outflow)',
      'op_rec': 'Operating receipts (inflow)',
      'oth_inc': 'Other income (inflow)',
      'fin_in': 'Financing (inflow)'
    };
    if (v.bucket && bucketKeyToName[v.bucket]) v.bucket = bucketKeyToName[v.bucket];
    if (v.partyKind) v.partyKind = v.partyKind.toLowerCase();
    if (v.kind) {
      const kindKeyMap = {
        'statutory / tax': 'tax',
        'financing / owner': 'financing'
      };
      const lk = v.kind.toLowerCase();
      if (kindKeyMap[lk]) v.kind = kindKeyMap[lk];
    }
  }
  const canDeact = api.can('master.deactivate');
  const field = ([k, label, type, o = {}]) => {
    const hint = o.hint ? `<div class="hint">${esc(o.hint())}</div>` : '';
    if (type === 'select') return `<div class="field ${o.span ? 'span3' : ''}"><label>${label}</label><select class="select" name="${k}" ${o.lockOnEdit && rec ? 'disabled' : ''}>${opts(o.options(), v[k], o.noEmpty ? null : o.req ? 'Select' : '—')}</select>${hint}</div>`;
    return `<div class="field ${o.span ? 'span3' : ''}"><label>${label}</label><input class="input" name="${k}" type="${type}" value="${esc(v[k] ?? '')}" ${o.list ? `list="dl_${k}"` : ''} ${type === 'number' ? 'step="0.01"' : ''}>${o.list ? `<datalist id="dl_${k}">${o.list().map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}${hint}</div>`;
  };
  const ov = openModal(`<div class="modal-h"><h2>${rec ? 'Edit' : 'Add'} ${esc(MASTER_TABS.find(t => t[0] === tab)[1].replace(/s$/, '').toLowerCase())}</h2></div>
    <div class="modal-b"><form id="mForm" class="fgrid c2">${def.fields.map(field).join('')}
    ${rec ? `<div class="field span3"><label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''} ${canDeact ? '' : 'disabled'}> Active${canDeact ? '' : ' <span class="muted">(Owner only)</span>'}</label><div class="hint">Inactive records stay on past entries but are hidden from new-entry dropdowns.</div></div>` : ''}</form></div>
    <div class="modal-f"><button class="btn" data-x="no">Cancel</button><button class="btn btn-gold" data-x="yes">Save</button></div>`, 'sm');
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-x]'); if (!b) return;
    if (b.dataset.x === 'no') return ov.remove();
    const fm = $('#mForm', ov); const out = {};
    for (const [k, label, type, o = {}] of def.fields) {
      const el = fm.elements[k]; if (el.disabled) continue;
      let val = el.value.trim(); if (type === 'number') val = val === '' ? null : +val;
      if (o.req && (val === '' || val == null)) return toast(label.replace(' *', '') + ' is required', 'error');
      out[k] = val === '' ? (type === 'select' ? null : '') : val;
    }
    if (tab === 'categories' && 'itcBlocked' in out) out.itcBlocked = !!out.itcBlocked;
    if (rec && canDeact) out.active = fm.elements.active.checked;
    if (def.col === 'projects') { const dup = api.list('projects').find(p => p.code.toLowerCase() === out.code.toLowerCase() && p.id !== id); if (dup) return toast('Project code already exists', 'error'); }
    try {
      if (tab === 'employee' && typeof window !== 'undefined' && typeof (window as any).__supabaseSaveEmployee === 'function') {
        try {
          const deptName = nameOf('departments', out.departmentId) || out.departmentId || 'Operations / Admin';
          const sbEmp = await (window as any).__supabaseSaveEmployee({
            supabase_id: rec ? (rec.supabase_id || (!isNaN(Number(rec.id)) ? Number(rec.id) : null)) : null,
            name: out.name,
            department: deptName,
            designation: out.designation,
            monthly_salary: out.monthlySalary,
            joined: out.joinDate,
            emails: out.email,
            phone: out.phone,
            is_active: out.active !== false
          });
          if (sbEmp && sbEmp.id) {
            out.supabase_id = sbEmp.id;
            if (!rec) {
              out.id = String(sbEmp.id);
            }
          }
        } catch (sbErr: any) {
          console.error('Supabase employee save error:', sbErr);
          return toast(sbErr.message || 'Failed to save employee to Supabase', 'error');
        }
      }
      if (tab === 'other' && typeof window !== 'undefined' && typeof (window as any).__supabaseSaveOtherParty === 'function') {
        try {
          const sbOp = await (window as any).__supabaseSaveOtherParty({
            supabase_id: rec ? (rec.supabase_id || (!isNaN(Number(rec.id)) ? Number(rec.id) : null)) : null,
            name: out.name,
            gstin: out.gstin,
            default_gst_type: out.gstType,
            emails: out.email,
            phone: out.phone,
            is_active: out.active !== false
          });
          if (sbOp && sbOp.id) {
            out.supabase_id = sbOp.id;
            if (!rec) {
              out.id = String(sbOp.id);
            }
          }
        } catch (sbErr: any) {
          console.error('Supabase other party save error:', sbErr);
          return toast(sbErr.message || 'Failed to save other party to Supabase', 'error');
        }
      }
      if ((tab === 'projects' || def.col === 'projects') && typeof window !== 'undefined' && typeof (window as any).__supabaseSaveProject === 'function') {
        try {
          const deptName = nameOf('departments', out.departmentId) || out.departmentId || 'Design';
          const sbProj = await (window as any).__supabaseSaveProject({
            supabase_id: rec ? (rec.supabase_id || (!isNaN(Number(rec.id)) ? Number(rec.id) : null)) : null,
            project_code: out.code,
            project_name: out.name,
            client_id: out.clientId,
            department: deptName,
            contract_value: out.contractValue,
            start_date: out.startDate,
            status: out.status
          });
          if (sbProj && sbProj.id) {
            out.supabase_id = sbProj.id;
            if (!rec) {
              out.id = String(sbProj.id);
            }
          }
        } catch (sbErr: any) {
          console.error('Supabase project save error:', sbErr);
          return toast(sbErr.message || 'Failed to save project to Supabase', 'error');
        }
      }
      if ((tab === 'departments' || def.col === 'departments') && typeof window !== 'undefined' && typeof (window as any).__supabaseSaveDepartment === 'function') {
        try {
          const sbDept = await (window as any).__supabaseSaveDepartment({
            supabase_id: rec ? (rec.supabase_id || (!isNaN(Number(rec.id)) ? Number(rec.id) : null)) : null,
            department_name: out.name,
            manager: out.managerName,
            manager_email: out.managerEmail
          });
          if (sbDept && sbDept.id) {
            out.supabase_id = sbDept.id;
            if (!rec) {
              out.id = String(sbDept.id);
            }
          }
        } catch (sbErr: any) {
          console.error('Supabase department save error:', sbErr);
          return toast(sbErr.message || 'Failed to save department to Supabase', 'error');
        }
      }
      if ((tab === 'accounts' || def.col === 'accounts') && typeof window !== 'undefined' && typeof (window as any).__supabaseSaveBankAccount === 'function') {
        try {
          const sbAcc = await (window as any).__supabaseSaveBankAccount({
            supabase_id: rec ? (rec.supabase_id || (!isNaN(Number(rec.id)) ? Number(rec.id) : null)) : null,
            account_name: out.name,
            account_type: out.type === 'bank' ? 'Bank' : (out.type === 'fd' ? 'Fixed deposit' : (out.type === 'cash' ? 'Cash' : out.type || 'Bank')),
            account_number_masked: out.number,
            opening_balance: out.openingBalance,
            opening_balance_date: out.openingBalanceDate || Store.data?.settings?.openingDate || '2025-04-01'
          });
          if (sbAcc && sbAcc.id) {
            out.supabase_id = sbAcc.id;
            if (!rec) {
              out.id = String(sbAcc.id);
            }
          }
        } catch (sbErr: any) {
          console.error('Supabase bank account save error:', sbErr);
          return toast(sbErr.message || 'Failed to save bank account to Supabase', 'error');
        }
      }
      if ((tab === 'categories' || def.col === 'categories') && typeof window !== 'undefined' && typeof (window as any).__supabaseSaveCategory === 'function') {
        try {
          const sbCat = await (window as any).__supabaseSaveCategory({
            supabase_id: rec ? (rec.supabase_id || (!isNaN(Number(rec.id)) ? Number(rec.id) : null)) : null,
            name: out.name,
            type: out.type,
            bucket: out.bucket,
            group: out.group,
            partyKind: out.partyKind,
            kind: out.kind,
            sac: out.sac,
            itcBlocked: out.itcBlocked,
            tdsSection: out.tdsSection
          });
          if (sbCat && sbCat.id) {
            out.supabase_id = sbCat.id;
            if (!rec) {
              out.id = String(sbCat.id);
            }
          }
        } catch (sbErr: any) {
          console.error('Supabase category save error:', sbErr);
          return toast(sbErr.message || 'Failed to save category to Supabase', 'error');
        }
      }
      if (rec) { api.guard(permKey(def.perm, 'edit')); await api.update(def.col, id, out); toast('Saved'); }
      else { api.guard(permKey(def.perm, 'create')); await api.create(def.col, { ...def.defaults, ...out, active: true }); toast('Added ' + (out.name || out.code)); }
      ov.remove(); render();
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ============================ AUDIT ============================ */
PAGES.audit = {
  title: 'Audit log',
  render() {
    const A = S.audit; const q = A.q.trim().toLowerCase();
    let rows = Store.data.audit.filter(a => (!A.userId || a.userId === A.userId) && (!A.action || a.action === A.action) && (!A.entity || a.entity === A.entity) && (!q || (a.summary + ' ' + JSON.stringify(a.changes)).toLowerCase().includes(q)));
    rows = rows.slice().reverse();
    const per = 100, pages = Math.max(1, Math.ceil(rows.length / per)); if (A.page >= pages) A.page = pages - 1;
    const actions = [...new Set(Store.data.audit.map(a => a.action))];
    const actChip = a => `<span class="chip ${{ create: 'inflow', update: 'gold', delete: 'outflow', purge: 'outflow', restore: 'transfer', lock: 'navy', unlock: '' }[a] || ''}">${esc(a)}</span>`;
    return `<div class="page-intro">Every change to entries, masters, recurring templates and settings is logged here with who made it and what changed. Nothing in this log can be edited.</div>
    <div class="toolbar"><div class="field" style="flex:2;min-width:200px"><label>Search</label><input class="input" data-inp="aq" value="${esc(A.q)}" placeholder="Summary or changed value…"></div>
      <div class="field"><label>User</label><select class="select" data-af="userId">${opts(Store.data.users.map(u => [u.id, u.name]), A.userId, 'Everyone')}</select></div>
      <div class="field"><label>Action</label><select class="select" data-af="action">${opts(actions.map(a => [a, a]), A.action, 'All actions')}</select></div>
      <div class="field"><label>Record type</label><select class="select" data-af="entity">${opts(Object.entries(ENTITY_LABEL), A.entity, 'All')}</select></div></div>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th style="width:45%">Summary & changes</th></tr></thead><tbody>
    ${rows.slice(A.page * per, A.page * per + per).map(a => `<tr class="${a.entity === 'entries' && api.get('entries', a.entityId) ? 'click' : ''}" ${a.entity === 'entries' && api.get('entries', a.entityId) ? `data-act="open-entry" data-id="${a.entityId}"` : ''}><td class="nowrap">${fmtDateTime(a.ts)}</td><td class="nowrap">${esc(userName(a.userId))}</td><td>${actChip(a.action)}</td><td class="nowrap">${esc(ENTITY_LABEL[a.entity] || a.entity)}</td><td><div>${esc(a.summary)}</div>${changesHTML(a)}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">No matching log entries.</div></td></tr>'}
    </tbody></table></div><div class="pager"><span>${rows.length} events</span><span class="spacer"></span><button class="btn btn-sm" data-act="apage" data-d="-1" ${A.page ? '' : 'disabled'}>Previous</button><span>Page ${A.page + 1} / ${pages}</span><button class="btn btn-sm" data-act="apage" data-d="1" ${A.page < pages - 1 ? '' : 'disabled'}>Next</button></div></div>`;
  },
};

/* ============================ TRASH ============================ */
PAGES.trash = {
  title: 'Trash',
  render() {
    const rows = Store.data.entries.filter(e => e.deleted).sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
    const owner = api.can('entry.restore');
    return `<div class="page-intro">Deleted entries stay here and are excluded from every balance and report. ${owner ? 'Restore puts an entry back exactly as it was. Permanent deletion also removes its attachments and cannot be undone.' : 'Only the Owner can restore or permanently delete.'}</div>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Entry date</th><th>Type</th><th>Category / description</th><th>Party</th><th class="num">Net cash</th><th>Deleted</th><th></th></tr></thead><tbody>
    ${rows.map(e => `<tr><td class="nowrap">${fmtDate(e.date)}</td><td>${typeChip(e.type)}</td><td><div class="cell-main">${esc(entryTitle(e))}</div><div class="cell-sub">${esc(e.description)}</div></td><td>${esc(entryParty(e))}</td><td class="num ${amtClass(e)}">${signedAmt(e)}</td><td class="nowrap">${esc(userName(e.deletedBy))}<div class="cell-sub">${fmtDateTime(e.deletedAt)}</div></td>
      <td class="nowrap"><button class="btn btn-sm" data-act="open-entry" data-id="${e.id}">View</button> ${owner ? `<button class="btn btn-sm" data-act="restore" data-id="${e.id}">${icon('restore')} Restore</button> <button class="btn btn-sm btn-danger" data-act="purge" data-id="${e.id}">Delete forever</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7"><div class="empty"><b>Trash is empty</b>Deleted entries will appear here.</div></td></tr>'}
    </tbody></table></div></div>`;
  },
};

/* ============================ SETTINGS ============================ */
PAGES.settings = {
  title: 'Settings',
  render() {
    const s = Store.data.settings, me = api.me(), owner = me.role === 'owner';
    const months = fyMonths(S.fy);
    const perms = [['Record orders & PIs', 1, 1, 0], ['Cancel or delete orders & PIs', 1, 0, 0], ['Set revenue targets', 1, 0, 0], ['View department scorecards', 1, 1, 'Own dept.'], ['Add & edit entries (unlocked months)', 1, 1], ['Confirm / skip recurring items', 1, 1], ['Add & edit recurring templates', 1, 1], ['Add & edit clients, vendors, employees, projects', 1, 1], ['Delete entries · restore from Trash', 1, 0], ['Delete recurring templates', 1, 0], ['Edit departments, categories, bank accounts', 1, 0], ['Deactivate master records', 1, 0], ['Lock / unlock months', 1, 0], ['Company settings · reset or clear data', 1, 0]];
    const yes = `<span class="in" style="display:inline-block;width:16px">${icon('check')}</span>`, no = '<span class="faint">—</span>';
    return `<div class="stack">
    <div class="grid g-2">
      <div class="card"><div class="card-h"><h3 class="grow">Who is using the app</h3></div><div class="card-b">
        <div class="field"><label>Logged in as</label><select class="select" data-chg="user">${api.users().map(u => `<option value="${u.id}"${u.id === me.id ? ' selected' : ''}>${esc(u.name)} · ${ROLES[u.role]}</option>`).join('')}</select><div class="hint">Prototype only. Department managers (set in Masters › Departments) get a scorecard-only login. The backend will replace this with real sign-in; every change is logged against the selected user.</div></div>
        <table class="tbl perm" style="margin-top:14px"><thead><tr><th>Permission</th><th class="num">Owner</th><th class="num">Accountant</th><th class="num">Manager</th></tr></thead><tbody>${perms.map(([l, o, a, m]) => `<tr><td>${l}</td><td class="num">${o ? yes : no}</td><td class="num">${a ? yes : no}</td><td class="num">${typeof m === 'string' ? `<span class="muted" style="font-size:12px">${m}</span>` : no}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3 class="grow">Company</h3></div><div class="card-b"><form id="coForm" class="fgrid c2">
        <div class="field span3"><label>Company name</label><input class="input" name="company" value="${esc(s.company)}" ${owner ? '' : 'disabled'}></div>
        <div class="field"><label>GSTIN</label><input class="input mono" name="gstin" value="${esc(s.gstin)}" ${owner ? '' : 'disabled'}></div>
        <div class="field"><label>State</label><input class="input" name="state" value="${esc(s.state)}" ${owner ? '' : 'disabled'}><div class="hint">Same-state parties default to CGST + SGST</div></div>
        <div class="field"><label>Opening balances as of</label><input class="input" type="date" name="openingDate" value="${s.openingDate}" ${owner ? '' : 'disabled'}><div class="hint">Set balances in Masters › Bank accounts</div></div>
        <div class="field"><label>Financial year</label><input class="input" value="April – March" disabled></div>
        </form>${owner ? '<div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn btn-navy" data-act="save-company">Save</button></div>' : ''}</div></div>
    </div>
    <div class="card"><div class="card-h"><div class="grow"><h3>Month locks · ${esc(fyLabel(S.fy))}</h3><div class="sub">A locked month rejects new entries, edits and deletions for everyone. Lock a month after it is reconciled with the bank and filed.</div></div>${owner ? `<button class="btn btn-sm" data-act="lock-fy" data-v="1">${icon('lock')} Lock all to last month</button>` : ''}</div>
      <div class="card-b"><div class="lockgrid">${months.map(m => { const L = s.lockedMonths.includes(m), fut = m > ymOf(TODAY); return `<div class="lockcell ${L ? 'locked' : ''}"><div class="m">${monthLabel(m, true)}</div><div style="font-size:12px;opacity:.8">${L ? 'Locked' : fut ? 'Future' : 'Open'}</div>${owner && !fut ? `<button data-act="lock" data-m="${m}" data-v="${L ? 0 : 1}">${icon(L ? 'unlock' : 'lock')}${L ? 'Unlock' : 'Lock'}</button>` : ''}</div>`; }).join('')}</div></div></div>
    ${emailSettingsCard()}
    ${typeof automationSettingsCard === 'function' ? automationSettingsCard() : ''}
    ${complianceSettingsCard()}
    ${typeof gstSettingsCard === 'function' ? gstSettingsCard() : ''}
    ${typeof tdsSettingsCard === 'function' ? tdsSettingsCard() : ''}
    <div class="card"><div class="card-h"><div class="grow"><h3>Data & storage</h3><div class="sub">Everything is stored in this browser until the backend is connected.</div></div></div><div class="card-b">
      <div class="summary-strip" style="border:1px solid var(--line-2);border-radius:8px;margin-bottom:16px">
        <div><div class="l">Entries</div><div class="v">${Store.data.entries.filter(e => !e.deleted).length}</div></div><div><div class="l">In trash</div><div class="v">${Store.data.entries.filter(e => e.deleted).length}</div></div>
        <div><div class="l">Audit events</div><div class="v">${Store.data.audit.length}</div></div><div><div class="l">Attachments</div><div class="v" id="attCount">…</div></div>
        <div><div class="l">Record storage</div><div class="v">${(Store.bytes() / 1024).toFixed(0)} KB</div></div><div><div class="l">Data set</div><div class="v" style="font-family:var(--f-body);font-size:13px">${Store.data.meta && Store.data.meta.testData ? '<span class="chip gold">Test data</span>' : 'Live'}</div></div></div>
      ${!STORAGE_OK ? `<div class="notice" style="margin-bottom:14px">${icon('alert')}<div>Browser storage is unavailable or full. Changes will be lost when this tab closes.</div></div>` : ''}
      ${owner ? `<div class="row"><button class="btn" data-act="reset-test">${icon('restore')} Reset to test data</button><button class="btn btn-danger" data-act="clear-tx">Clear transactions only</button><button class="btn btn-danger" data-act="clear-all">Clear all data</button></div>
      <div class="hint muted" style="margin-top:8px;font-size:12px">Reset replaces everything with the generated demo set. “Clear transactions” keeps masters (parties, projects, categories, accounts, recurring templates). “Clear all” starts empty with default departments and categories.</div>` : '<div class="muted">Only the Owner can reset or clear data.</div>'}
    </div></div>
    <div class="card"><div class="card-h"><h3 class="grow">For the development team</h3></div><div class="card-b" style="font-size:13px;color:var(--ink-2);line-height:1.6">
      All reads and writes go through the <code class="mono">api</code> and <code class="mono">FileStore</code> objects at the top of the script. The data model, business rules and suggested REST endpoints are documented in the comment block above them. Swap those method bodies for HTTP calls, move permission, lock and validation checks server-side, and remove <code class="mono">buildSeed()</code> plus the reset buttons above.</div></div>
    </div>`;
  },
  async after() { const n = await FileStore.count().catch(() => '?'); const el = $('#attCount'); if (el) el.textContent = n; },
};

/* ============================ actions ============================ */
const ACT = {
  'open-entry': el => openEntry(el.dataset.id),
  'close-drawer': () => closeDrawer(),
  'view-file': el => viewFile(el.dataset.id),
  'edit-entry': el => openEntryForm({ mode: 'edit', entry: api.get('entries', el.dataset.id) }),
  'dup-entry': el => openEntryForm({ mode: 'dup', entry: api.get('entries', el.dataset.id) }),
  'del-entry': async el => {
    const e = api.get('entries', el.dataset.id);
    if (!await confirmBox({ title: 'Delete this entry?', body: `<b>${esc(entryTitle(e))}</b> · ${signedAmt(e)} on ${fmtDate(e.date)}.<br><br>It moves to Trash and stops counting in balances and reports. You can restore it from Trash.`, ok: 'Move to Trash', danger: true })) return;
    try { await api.softDelete(e.id); toast('Moved to Trash'); afterWrite(); } catch (err) { toast(err.message, 'error'); }
  },
  restore: async el => { try { await api.restore(el.dataset.id); toast('Entry restored'); render(); } catch (err) { toast(err.message, 'error'); } },
  purge: async el => {
    if (!await confirmBox({ title: 'Delete permanently?', body: 'The entry and its attachments will be removed for good. The audit log keeps a record that it existed.', ok: 'Delete forever', danger: true })) return;
    try { await api.purge(el.dataset.id); toast('Deleted permanently'); render(); } catch (err) { toast(err.message, 'error'); }
  },
  'confirm-due': el => { const k = el.dataset.id + '|' + el.dataset.p; openEntryForm({ mode: 'confirm', rec: api.get('recurring', el.dataset.id), period: el.dataset.p, dueDate: el.dataset.d, amount: QAMT[k] != null ? QAMT[k] : null }); },
  'quick-record': async el => {
    const rec = api.get('recurring', el.dataset.id), k = el.dataset.id + '|' + el.dataset.p;
    const inp = document.querySelector(`[data-qamt="${k}"]`); const amt = inp ? +inp.value : recurringSuggest(rec).suggested;
    if (!(amt > 0)) { toast('Enter an amount greater than zero', 'error'); inp && inp.focus(); return; }
    el.disabled = true;
    try {
      const saved = await api.saveEntry(entryFromRecurring(rec, el.dataset.p, el.dataset.d, amt));
      delete QAMT[k];
      toast(`Recorded ${rec.name} · ${monthLabel(el.dataset.p)} · ${money(saved.amount)}`);
      render({ keepScroll: true });
    } catch (err) { el.disabled = false; toast(err.fields && err.fields.date ? err.fields.date + ' Use the edit button to change the date.' : err.message, 'error'); }
  },
  'skip-due': async el => {
    const r = api.get('recurring', el.dataset.id);
    if (!await confirmBox({ title: 'Skip this cycle?', body: `<b>${esc(r.name)}</b> for ${monthLabel(el.dataset.p, true)} will be marked as skipped and won't be recorded. Use this when the payment or receipt isn't happening this cycle.`, ok: 'Skip' })) return;
    try { await api.skipPeriod(r.id, el.dataset.p); toast('Skipped'); render(); } catch (err) { toast(err.message, 'error'); }
  },
  'new-template': () => openEntryForm({ mode: 'template' }),
  'edit-template': el => openEntryForm({ mode: 'template-edit', rec: api.get('recurring', el.dataset.id) }),
  'toggle-template': async el => { const r = api.get('recurring', el.dataset.id); try { api.guard('recurring.edit'); await api.update('recurring', r.id, { active: !r.active }); toast(r.active ? 'Resumed' : 'Paused'); render(); } catch (err) { toast(err.message, 'error'); } },
  'del-template': async el => {
    const r = api.get('recurring', el.dataset.id);
    if (!await confirmBox({ title: 'Delete template?', body: `<b>${esc(r.name)}</b> will stop generating due items. Entries already recorded from it are kept.`, ok: 'Delete', danger: true })) return;
    try { api.guard('recurring.delete'); r.deleted = true; r.deletedBy = api.me().id; r.deletedAt = nowISO(); api.log('delete', 'recurring', r.id, describe('recurring', r)); Store.persist(); toast('Template deleted'); render(); } catch (err) { toast(err.message, 'error'); }
  },
  'report-tab': el => { S.report = el.dataset.tab; if (S.page === 'reports') render(); },
  'rep-kind': el => { S.reportKind = el.dataset.v; render(); },
  'proj-scope': el => { S.projScope = el.dataset.v; render(); },
  'master-tab': el => { S.master = el.dataset.tab; render(); },
  'master-new': () => {
    if (S.master === 'client' && typeof window !== 'undefined' && typeof (window as any).openAddClientModal === 'function') {
      (window as any).openAddClientModal();
      return;
    }
    if (S.master === 'vendor' && typeof window !== 'undefined' && typeof (window as any).openAddVendorModal === 'function') {
      (window as any).openAddVendorModal();
      return;
    }
    if (S.master === 'employee' && typeof window !== 'undefined' && typeof (window as any).openAddEmployeeModal === 'function') {
      (window as any).openAddEmployeeModal();
      return;
    }
    if (S.master === 'other' && typeof window !== 'undefined' && typeof (window as any).openAddOtherPartyModal === 'function') {
      (window as any).openAddOtherPartyModal();
      return;
    }
    if (S.master === 'projects' && typeof window !== 'undefined' && typeof (window as any).openAddProjectModal === 'function') {
      (window as any).openAddProjectModal();
      return;
    }
    if (S.master === 'departments' && typeof window !== 'undefined' && typeof (window as any).openAddDepartmentModal === 'function') {
      (window as any).openAddDepartmentModal();
      return;
    }
    if (S.master === 'accounts' && typeof window !== 'undefined' && typeof (window as any).openAddBankAccountModal === 'function') {
      (window as any).openAddBankAccountModal();
      return;
    }
    if (S.master === 'categories' && typeof window !== 'undefined' && typeof (window as any).openAddCategoryModal === 'function') {
      (window as any).openAddCategoryModal();
      return;
    }
    ['client', 'vendor'].includes(S.master) ? partyForm(S.master, null) : masterForm(S.master);
  },
  'master-edit': el => ['client', 'vendor'].includes(S.master) ? partyForm(S.master, el.dataset.id) : masterForm(S.master, el.dataset.id),
  'master-delete': async el => {
    if (S.master === 'categories') {
      const c = api.get('categories', el.dataset.id);
      if (!c) return;
      if (!await confirmBox({ title: 'Delete ' + c.name + '?', body: 'Are you sure you want to delete this category from the database?', ok: 'Delete' })) return;
      if (typeof window !== 'undefined' && typeof (window as any).__supabaseDeleteCategory === 'function') {
        const sbId = c.supabase_id || (!isNaN(Number(c.id)) ? Number(c.id) : null);
        await (window as any).__supabaseDeleteCategory(sbId || c.name);
      }
      const idx = Store.data.categories.findIndex(x => x.id === c.id);
      if (idx >= 0) Store.data.categories.splice(idx, 1);
      Store.persist();
      toast('Deleted ' + c.name);
      render({ keepScroll: true });
      return;
    }
    if (S.master === 'projects') {
      const pr = api.get('projects', el.dataset.id);
      if (!pr) return;
      if (!await confirmBox({ title: 'Delete ' + (pr.code || pr.name) + '?', body: 'Are you sure you want to delete this project from the database?', ok: 'Delete' })) return;
      if (typeof window !== 'undefined' && typeof (window as any).__supabaseDeleteProject === 'function') {
        const sbId = pr.supabase_id || (!isNaN(Number(pr.id)) ? Number(pr.id) : null);
        await (window as any).__supabaseDeleteProject(sbId || pr.code);
      }
      const idx = Store.data.projects.findIndex(x => x.id === pr.id);
      if (idx >= 0) Store.data.projects.splice(idx, 1);
      Store.persist();
      toast('Deleted ' + (pr.code || pr.name));
      render({ keepScroll: true });
      return;
    }
    if (S.master === 'departments') {
      const d = api.get('departments', el.dataset.id);
      if (!d) return;
      if (!await confirmBox({ title: 'Delete ' + d.name + '?', body: 'Are you sure you want to delete this department from the database?', ok: 'Delete' })) return;
      if (typeof window !== 'undefined' && typeof (window as any).__supabaseDeleteDepartment === 'function') {
        const sbId = d.supabase_id || (!isNaN(Number(d.id)) ? Number(d.id) : null);
        await (window as any).__supabaseDeleteDepartment(sbId || d.name);
      }
      const idx = Store.data.departments.findIndex(x => x.id === d.id);
      if (idx >= 0) Store.data.departments.splice(idx, 1);
      Store.persist();
      toast('Deleted ' + d.name);
      render({ keepScroll: true });
      return;
    }
    if (S.master === 'accounts') {
      const a = api.get('accounts', el.dataset.id);
      if (!a) return;
      if (!await confirmBox({ title: 'Delete ' + a.name + '?', body: 'Are you sure you want to delete this bank account from the database?', ok: 'Delete' })) return;
      if (typeof window !== 'undefined' && typeof (window as any).__supabaseDeleteBankAccount === 'function') {
        const sbId = a.supabase_id || (!isNaN(Number(a.id)) ? Number(a.id) : null);
        await (window as any).__supabaseDeleteBankAccount(sbId || a.name);
      }
      const idx = Store.data.accounts.findIndex(x => x.id === a.id);
      if (idx >= 0) Store.data.accounts.splice(idx, 1);
      Store.persist();
      toast('Deleted ' + a.name);
      render({ keepScroll: true });
      return;
    }
    const p = api.get('parties', el.dataset.id);
    if (!p) return;
    if (!await confirmBox({ title: 'Delete ' + p.name + '?', body: 'Are you sure you want to delete this ' + p.kind + ' from the database?', ok: 'Delete' })) return;
    if (typeof window !== 'undefined' && typeof (window as any).__supabaseDeleteClient === 'function' && p.kind === 'client') {
      await (window as any).__supabaseDeleteClient(p.id);
    }
    if (typeof window !== 'undefined' && typeof (window as any).__supabaseDeleteVendor === 'function' && p.kind === 'vendor') {
      await (window as any).__supabaseDeleteVendor(p.id);
    }
    if (typeof window !== 'undefined' && typeof (window as any).__supabaseDeleteEmployee === 'function' && p.kind === 'employee') {
      const sbId = p.supabase_id || (!isNaN(Number(p.id)) ? Number(p.id) : null);
      if (sbId) {
        await (window as any).__supabaseDeleteEmployee(sbId);
      }
    }
    if (typeof window !== 'undefined' && typeof (window as any).__supabaseDeleteOtherParty === 'function' && p.kind === 'other') {
      const sbId = p.supabase_id || (!isNaN(Number(p.id)) ? Number(p.id) : null);
      if (sbId) {
        await (window as any).__supabaseDeleteOtherParty(sbId);
      }
    }
    const idx = Store.data.parties.findIndex(x => x.id === p.id);
    if (idx >= 0) Store.data.parties.splice(idx, 1);
    Store.persist();
    toast('Deleted ' + p.name);
    render({ keepScroll: true });
  },
  'cf-set': el => { S.cf[el.dataset.k] = el.dataset.v; render({ keepScroll: true }); },
  'sb-detail': () => { S.sbDetail = !S.sbDetail; render({ keepScroll: true }); },
  'rp-open': () => { S.rpOpen = !S.rpOpen; render({ keepScroll: true }); },
  'rp-deps': () => { S.rpDeps = S.rpDeps === false; render({ keepScroll: true }); },
  'cf-drill': el => go('ledger', { ...LEDGER_RESET(), type: el.dataset.type, ...JSON.parse(el.dataset.drill || '{}'), from: el.dataset.from, to: el.dataset.to }),
  'ledger-drill': el => go('ledger', { ...LEDGER_RESET(), ...JSON.parse(el.dataset.drill || '{}') }),
  tree: el => { const k = el.dataset.k; OPEN.has(k) ? OPEN.delete(k) : OPEN.add(k); render({ keepScroll: true }); },
  'tree-level': el => { LEVEL_REQ[el.dataset.scope] = el.dataset.lv; render({ keepScroll: true }); },
  'party-all': () => { S.partyAll = !S.partyAll; render({ keepScroll: true }); },
  'clear-bucket': () => { Object.assign(S.ledger, { bucket: '', group: '', page: 0 }); render(); },
  'ledger-dept': el => go('ledger', { ...LEDGER_RESET(), departmentId: el.dataset.id }),
  'ledger-cat': el => go('ledger', { ...LEDGER_RESET(), categoryId: el.dataset.id, departmentId: S.page === 'dashboard' ? S.dashDept : '' }),
  'ledger-acc': el => go('ledger', { ...LEDGER_RESET(), accountId: el.dataset.id }),
  'ledger-party': el => go('ledger', { ...LEDGER_RESET(), partyId: el.dataset.id }),
  'ledger-proj': el => go('ledger', { ...LEDGER_RESET(), projectId: el.dataset.id, ...(S.projScope === 'all' ? { from: Store.data.settings.openingDate, to: TODAY } : {}) }),
  'toggle-filters': () => { S.ledger.open = !S.ledger.open; $('#moreFilters')?.classList.toggle('hide', !S.ledger.open); },
  'clear-filters': () => { Object.assign(S.ledger, LEDGER_RESET()); render(); },
  sort: el => { const k = el.dataset.k; if (S.ledger.sort === k) S.ledger.dir *= -1; else { S.ledger.sort = k; S.ledger.dir = -1; } refreshLedger(); },
  lpage: el => { S.ledger.page += +el.dataset.d; refreshLedger(); $('#ledgerResults')?.scrollIntoView({ block: 'start' }); },
  apage: el => { S.audit.page += +el.dataset.d; render(); },
  lock: async el => { try { await api.setLock(el.dataset.m, el.dataset.v === '1'); toast((el.dataset.v === '1' ? 'Locked ' : 'Unlocked ') + monthLabel(el.dataset.m, true)); render(); } catch (err) { toast(err.message, 'error'); } },
  'lock-fy': async () => {
    const last = addMonths(ymOf(TODAY), -1); const ms = fyMonths(S.fy).filter(m => m <= last && !Store.data.settings.lockedMonths.includes(m));
    if (!ms.length) return toast('Nothing to lock');
    if (!await confirmBox({ title: `Lock ${ms.length} month(s)?`, body: ms.map(m => monthLabel(m, true)).join(', '), ok: 'Lock' })) return;
    for (const m of ms) await api.setLock(m, true); toast('Locked ' + ms.length + ' month(s)'); render();
  },
  'save-company': async () => { const f = $('#coForm'); try { await api.saveSettings({ company: f.company.value.trim(), gstin: f.gstin.value.trim(), state: f.state.value.trim(), openingDate: f.openingDate.value }); toast('Saved'); render(); } catch (err) { toast(err.message, 'error'); } },
  'reset-test': async () => { if (!await confirmBox({ title: 'Reset to test data?', body: 'All current entries, masters, attachments and the audit log will be replaced with the generated demo data set.', ok: 'Reset', danger: true, typed: 'RESET' })) return; await resetToTestData(); toast('Test data loaded'); go('dashboard'); },
  'clear-tx': async () => {
    if (!await confirmBox({ title: 'Clear all transactions?', body: 'Deletes every entry (including Trash) and all attachments. Masters and recurring templates are kept. The audit log records this action.', ok: 'Clear transactions', danger: true, typed: 'CLEAR' })) return;
    api.guard('data.reset'); const n = Store.data.entries.length; Store.data.entries = []; await FileStore.clear();
    Store.data.recurring.forEach(r => r.skipped = []); Store.data.settings.lockedMonths = []; Store.data.meta.testData = false;
    api.log('reset', 'settings', 'data', `Cleared ${n} entries and all attachments`); Store.persist(); toast('Transactions cleared'); go('dashboard');
  },
  'clear-all': async () => {
    if (!await confirmBox({ title: 'Clear ALL data?', body: 'Everything is removed: entries, attachments, parties, projects, recurring templates, accounts and the audit log. You will start with a single empty bank account and the default departments and categories.', ok: 'Clear everything', danger: true, typed: 'DELETE ALL' })) return;
    api.guard('data.reset'); const me = api.me().id; Store.data = emptyData(); Store.data.settings.currentUserId = me; await FileStore.clear();
    api.log('reset', 'settings', 'data', 'Cleared all data'); Store.persist(); toast('All data cleared'); go('dashboard');
  },
  'nav-toggle': (el, ev) => {
    ev && ev.stopPropagation && ev.stopPropagation();
    const btn = el.closest('.nav-h') || el;
    const k = btn.dataset.v;
    if (!k) return;
    if (!S.openNavs) {
      S.openNavs = new Set(['overview', 'sales', 'banking', 'tax', 'admin']);
    }
    if (S.openNavs.has(k)) {
      S.openNavs.delete(k);
    } else {
      S.openNavs.add(k);
    }
    const sec = btn.closest('.nav-sec') || document.querySelector(`#nav .nav-sec[data-nav="${k}"]`);
    if (sec) {
      const on = S.openNavs.has(k);
      sec.classList.toggle('open', on);
      btn.setAttribute('aria-expanded', String(on));
    }
  },
  'open-side': () => { $('#sidebar').classList.add('open'); document.body.insertAdjacentHTML('beforeend', '<div class="drawer-ov side" style="z-index:140" data-act="close-side"></div>'); },
  'close-side': () => { $('#sidebar').classList.remove('open'); $('.drawer-ov.side')?.remove(); },
  'add-entry': () => openEntryForm(),
};
const LEDGER_RESET = () => ({ q: '', bucket: '', group: '', from: '', to: '', type: '', categoryId: '', departmentId: '', partyId: '', projectId: '', accountId: '', paymentMode: '', page: 0 });

async function resetToTestData() {
  const { data, attachments } = buildSeed();
  const me = Store.data && Store.data.settings ? Store.data.settings.currentUserId : 'u_owner';
  Store.data = data; Store.data.settings.currentUserId = me || 'u_owner'; Store.persist();
  await FileStore.clear().catch(() => {});
  for (const a of attachments) await FileStore.put({ ...a.meta, blob: new Blob([a.svg], { type: 'image/svg+xml' }) }).catch(() => {});
  S.fy = fyOf(TODAY);
}

/* ============================ boot ============================ */
let _globalBound = false;
function bindGlobal() {
  if (_globalBound) return;
  _globalBound = true;
  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]'); if (!el) return;
    const fn = ACT[el.dataset.act]; if (!fn) return;
    if (el.tagName === 'A' && el.dataset.act !== 'report-tab') ev.preventDefault();
    fn(el, ev);
  });
  document.addEventListener('change', ev => {
    const t = ev.target;
    if (t.dataset.lf) { S.ledger[t.dataset.lf] = t.value; S.ledger.page = 0; if (S.page === 'ledger') { const fresh = PAGES.ledger.render(); refreshLedger(); const btn = $('[data-act=toggle-filters]'); if (btn) { const tmp = document.createElement('div'); tmp.innerHTML = fresh; const nb = $('[data-act=toggle-filters]', tmp); btn.innerHTML = nb.innerHTML; } } return; }
    if (t.dataset.af) { S.audit[t.dataset.af] = t.value; S.audit.page = 0; render(); return; }
    if (t.dataset.of) { S.ord[t.dataset.of] = t.value; render({ keepScroll: true }); return; }
    if (t.dataset.pf) { S.pi[t.dataset.pf] = t.value; render({ keepScroll: true }); return; }
    if (t.dataset.tgf) { S.tg[t.dataset.tgf] = t.type === 'checkbox' ? t.checked : t.value; render({ keepScroll: true }); return; }
    if (t.dataset.chg === 'dashDept') { S.dashDept = t.value; render(); return; }
    if (t.dataset.chg === 'user' || t.id === 'userSelect') { api.switchUser(t.value); closeDrawer(); toast('Now using the app as ' + api.me().name + ' (' + ROLES[api.me().role] + ')'); if (api.me().role === 'manager') go('targets'); else route(); return; }
    if (t.id === 'fySelect') { S.fy = +t.value; Object.assign(S.ledger, { from: '', to: '', page: 0 }); render(); }
  });
  let deb;
  document.addEventListener('input', ev => {
    const t = ev.target;
    if (t.dataset.qamt) { const r = api.get('recurring', t.dataset.rec); QAMT[t.dataset.qamt] = t.value === '' ? '' : +t.value; const n = document.querySelector(`[data-qnet="${t.dataset.qamt}"]`); if (n) n.textContent = (r.type === 'inflow' ? '+' : '−') + money(recurringNet(r, +t.value || 0)); t.closest('.qamt').classList.toggle('edited', Math.abs((+t.value || 0) - r.taxable) > 0.004); return; }
    if (t.dataset.st && S.salesDraft) {
      S.salesDraft[t.dataset.st][+t.dataset.i] = +t.value || 0;
      const c = $(`[data-st-tot="${t.dataset.st}"]`); if (c) c.textContent = money(sum(S.salesDraft[t.dataset.st], x => +x || 0));
      const col = $$(`[data-st="${t.dataset.st}"]`).indexOf(t); const cc = $(`[data-st-col="${col}"]`); if (cc) cc.textContent = money(sum(Object.values(S.salesDraft), a => +a[+t.dataset.i] || 0));
      const all = $('[data-st-all]'); if (all) all.textContent = money(sum(Object.values(S.salesDraft), a => sum(a, x => +x || 0)));
      return;
    }
    if (t.dataset.tg && S.tgDraft) { S.tgDraft.rows[t.dataset.tg][+t.dataset.i] = +t.value || 0; const c = $(`[data-tg-tot="${t.dataset.tg}"]`); if (c) c.textContent = money(sum(S.tgDraft.rows[t.dataset.tg], x => +x || 0)); return; }
    if (!t.dataset.inp) return;
    clearTimeout(deb);
    deb = setTimeout(() => {
      if (t.dataset.inp === 'lq') { S.ledger.q = t.value; S.ledger.page = 0; refreshLedger(); }
      if (t.dataset.inp === 'obq') { S.outbox.q = t.value; const pos = t.selectionStart; render({ keepScroll: true }); const n = $('[data-inp=obq]'); n.focus(); n.setSelectionRange(pos, pos); }
      if (t.dataset.inp === 'oq' || t.dataset.inp === 'pq') { (t.dataset.inp === 'oq' ? S.ord : S.pi).q = t.value; const pos = t.selectionStart; render({ keepScroll: true }); const n = $(`[data-inp=${t.dataset.inp}]`); n.focus(); n.setSelectionRange(pos, pos); }
      if (t.dataset.inp === 'aq') { S.audit.q = t.value; S.audit.page = 0; const pos = t.selectionStart; render(); const n = $('[data-inp=aq]'); n.focus(); n.setSelectionRange(pos, pos); }
    }, 220);
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.qamt) { ev.preventDefault(); const row = ev.target.closest('.due-row'); row && row.querySelector('[data-act=quick-record]').click(); return; }
    if (ev.key === 'Escape') { const ov = [...$$('#layer .overlay')].pop(); if (ov) ov.remove(); else closeDrawer(); }
    if ((ev.key === 'n' || ev.key === 'N') && !ev.metaKey && !ev.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('#layer .overlay') && api.can('entry.create')) { ev.preventDefault(); openEntryForm(); }
  });
  window.addEventListener('hashchange', route);
}
let _booted = false;
async function boot() {
  if (_booted) {
    route();
    return;
  }
  _booted = true;
  Hooks.notify = toast;
  const loaded = Store.load() && Store.data;
  if (!loaded || (Store.data.meta?.testData && Store.data.meta?.schemaVersion !== 9)) await resetToTestData();
  else if (Store.data.meta?.schemaVersion !== 9) { Object.assign(Store.data, { orders: Store.data.orders || [], pis: Store.data.pis || [], targets: Store.data.targets || {}, emails: Store.data.emails || [] }); emailSettings(); (Store.data.parties || []).forEach(normalizeParty); featureSettings(); Store.data.meta.schemaVersion = 9; Store.persist(); }
  featureSettings();
  $('#menuBtn').innerHTML = icon('menu'); $('#menuBtn').dataset.act = 'open-side';
  $('#addBtn').innerHTML = icon('plus') + 'Add entry'; $('#addBtn').dataset.act = 'add-entry'; $('#addBtn').title = 'Add entry (N)';
  $('#fab').innerHTML = icon('plus'); $('#fab').dataset.act = 'add-entry';
  $('#bottomNav').innerHTML = [['dashboard', 'Home', 'dash'], ['ledger', 'Entries', 'list'], null, ['reports', 'Reports', 'chart'], ['more', 'More', 'menu']].map(x => x ? (x[0] === 'more' ? `<a href="#" data-act="open-side" data-p="more">${icon(x[2])}${x[1]}</a>` : `<a href="#/${x[0]}" data-p="${x[0]}">${icon(x[2])}${x[1]}</a>`) : '<span class="gap"></span>').join('');
  bindGlobal();
  route();
  setTimeout(async () => { await runAutomations(); if (S.page === 'dashboard' || ['pis', 'outbox'].includes(S.page)) render({ keepScroll: true }); }, 400);
  setInterval(runAutomations, 3600e3);
}

/* ============================ ORDERS, PIs, TARGETS ============================ */
S.sales = { period: 'monthly', metric: 'billed' };
S.ord = { scope: 'active', q: '', clientId: '', departmentId: '' };
S.pi = { scope: 'unpaid', q: '', clientId: '', departmentId: '' };
S.tg = { tab: 'scorecards', dep: '', ym: '', costs: false };

const pctTxt = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
const achClass = (a, b) => !b ? '' : a / b >= 1 ? 'in' : a / b >= 0.8 ? 'warn' : 'out';
function achChip(a, b) { if (!b) return '<span class="chip">No target</span>'; const r = a / b; return `<span class="chip ${r >= 1 ? 'inflow' : r >= 0.8 ? 'gold' : 'outflow'}">${r >= 1 ? 'On target' : r >= 0.8 ? 'Close' : 'Behind'} · ${Math.round(r * 100)}%</span>`; }
const orderStatusChip = st => `<span class="chip ${{ open: 'gold', partly: 'transfer', full: 'inflow', closed: '', cancelled: 'outflow' }[st]}">${ORDER_STATUS[st]}</span>`;
function piStatusChip(st) {
  if (st.status === 'cancelled') return '<span class="chip outflow">Cancelled</span>';
  if (st.status === 'paid') return '<span class="chip inflow">Paid</span>';
  if (st.overdueDays > 0) return `<span class="chip overdue">${st.overdueDays}d overdue</span>${st.status === 'part' ? ' <span class="chip transfer">Part-paid</span>' : ''}`;
  return `<span class="chip ${st.status === 'part' ? 'transfer' : 'gold'}">${PI_STATUS[st.status]}</span>`;
}
const shareTxt = p => (Math.round(p * 10) / 10) + '%';
const depNames = (o, amounts) => {
  const shares = Sales.shares(o);
  const seen = new Set();
  const list = [];
  for (const s of shares) {
    const rawName = nameOf('departments', s.departmentId) || s.department_name || s.departmentId || '';
    const name = (typeof rawName === 'string' && rawName.startsWith('dep_') && Store.data?.departments?.find((d: any) => d.id === rawName)?.name) || rawName;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    list.push(esc(name));
  }
  return list.join(amounts ? '<br>' : ', ') || '—';
};
function salesPeriods(mode) {
  const cur = ymOf(TODAY);
  if (mode === 'yearly') { const out = []; for (let y = fyOf(Store.data.settings.openingDate); y <= fyOf(TODAY); y++) { const ms = fyMonths(y).filter(m => m <= cur); out.push({ label: fyLabel(y) + (y === fyOf(TODAY) ? ' · to date' : ''), months: ms, from: ms[0] + '-01', to: ymDate(ms[ms.length - 1], 31), cur: y === fyOf(TODAY) }); } return out; }
  return fyPeriods(S.fy, mode);
}
function targetFor(months, dep) { return sum(months, m => dep ? Sales.targetForMonth(m, dep) : sum(api.list('departments'), d => Sales.targetForMonth(m, d.id))); }

/* combo chart: grouped bars + optional target line */
function comboChart(id, labels, series, line, opts = {}) {
  const W = 960, H = opts.h || 280, pl = 104, pr = 12, pt = 14, pb = 30, iw = W - pl - pr, ih = H - pt - pb;
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.values), ...(line ? line.values : [])));
  const n = labels.length, gw = iw / Math.max(1, n), k = series.length, bw = Math.min(20, (gw * 0.72) / k);
  let g = '';
  for (let i = 0; i <= 4; i++) { const y = pt + ih - ih * i / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="${i ? '#EEECE5' : '#CFCBBE'}"/><text x="${pl - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#7B8396" font-family="IBM Plex Mono, monospace">${money(max * i / 4)}</text>`; }
  labels.forEach((l, i) => {
    const x = pl + gw * i + gw / 2;
    if (opts.current === i) g += `<rect x="${x - gw / 2 + 2}" y="${pt}" width="${gw - 4}" height="${ih}" fill="rgba(235,169,55,.10)" rx="4"/>`;
    series.forEach((s, j) => { const h = ih * (s.values[i] || 0) / max; g += `<rect x="${x - (k * bw) / 2 + j * bw + 1}" y="${pt + ih - h}" width="${bw - 2}" height="${h}" rx="2" fill="${s.color}"/>`; });
    g += `<text x="${x}" y="${H - 9}" text-anchor="middle" font-size="11.5" fill="${opts.current === i ? '#1B2A4A' : '#7B8396'}" font-weight="${opts.current === i ? 600 : 400}">${esc(l)}</text>`;
  });
  if (line && line.values.some(v => v)) {
    const pts = line.values.map((v, i) => [pl + gw * i + gw / 2, pt + ih - ih * (v || 0) / max]);
    g += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${line.color}" stroke-width="2.2" stroke-dasharray="6 5"/>`;
    pts.forEach(p => g += `<circle cx="${p[0]}" cy="${p[1]}" r="3.2" fill="#fff" stroke="${line.color}" stroke-width="2"/>`);
  }
  labels.forEach((l, i) => g += `<rect data-i="${i}" x="${pl + gw * i}" y="${pt}" width="${gw}" height="${ih + pb}" fill="transparent"/>`);
  return `<div class="chart-wrap" id="${id}"><svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg><div class="tip"></div></div>`;
}
const chartLegend = (series, line) => `<div class="chart-legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}${line ? `<span><i style="background:transparent;border-top:2px dashed ${line.color};height:0;width:14px;border-radius:0"></i>${esc(line.name)}</span>` : ''}</div>`;

/* ---------------- ORDER BOOK ---------------- */
PAGES.sales = {
  title: 'Order book',
  render() {
    const P = S.sales, periods = salesPeriods(P.period), facts = Sales.facts();
    if (!periods.length) return '<div class="card"><div class="empty">No months yet.</div></div>';
    const pIdx = {}; periods.forEach((p, i) => p.months.forEach(m => pIdx[m] = i));
    const series = m => periods.map((_, i) => r2(sum(facts.filter(f => f.m === m && pIdx[f.ym] === i), f => f.v)));
    const booked = series('booked'), billed = series('billed'), coll = series('collected');
    const tgt = periods.map(p => targetFor(p.months));
    const fyMs = fyMonths(S.fy).filter(m => m <= ymOf(TODAY));
    const fyF = m => r2(sum(facts.filter(f => f.m === m && fyMs.includes(f.ym)), f => f.v));
    const fyT = targetFor(fyMs);
    const orders = api.list('orders'); const ost = orders.map(o => ({ o, ...Sales.orderState(o) }));
    const book = sum(ost, x => x.toInvoice);
    const pis = api.list('pis').map(p => ({ p, ...Sales.piState(p) })).filter(x => x.outstanding > 0);
    const outAmt = sum(pis, x => x.outstanding), overdue = sum(pis.filter(x => x.overdueDays > 0), x => x.outstanding);
    const kpis = `<div class="grid g-kpi" style="grid-template-columns:repeat(5,minmax(0,1fr))">
      <div class="card kpi"><div class="k-l">Orders booked · ${esc(fyLabel(S.fy))}</div><div class="k-v">${money(fyF('booked'))}</div><div class="k-s">${orders.filter(o => fyMs.includes(ymOf(o.date)) && o.status !== 'cancelled').length} orders · pre-GST</div></div>
      <div class="card kpi accent"><div class="k-l">PIs issued (revenue)</div><div class="k-v">${money(fyF('billed'))}</div><div class="k-s">Target ${money(fyT)} · ${pctTxt(fyF('billed'), fyT)}</div></div>
      <div class="card kpi"><div class="k-l">Collected</div><div class="k-v in">${money(fyF('collected'))}</div><div class="k-s">Operating receipts, pre-GST</div></div>
      <div class="card kpi"><div class="k-l">Order book (to invoice)</div><div class="k-v">${money(book)}</div><div class="k-s">${ost.filter(x => x.toInvoice > 0).length} open orders · all years</div></div>
      <div class="card kpi"><div class="k-l">Unpaid PIs</div><div class="k-v ${overdue ? 'out' : ''}">${money(outAmt)}</div><div class="k-s">${overdue ? money(overdue) + ' overdue' : 'Nothing overdue'}</div></div></div>`;
    const S3 = [{ name: 'Orders booked', color: '#8C99B5', values: booked }, { name: 'PIs issued', color: '#1B2A4A', values: billed }, { name: 'Collected', color: '#3E9C6B', values: coll }];
    const L = { name: 'Target (PIs)', color: '#EBA937', values: tgt };
    const curI = periods.findIndex(p => p.cur);
    const chart = `<div class="card"><div class="card-h"><div class="grow"><h2>Booked → billed → collected</h2><div class="sub">Pre-GST values · ${P.period === 'yearly' ? 'all years' : esc(fyLabel(S.fy))}</div></div>${chartLegend(S3, L)}
      <div class="seg">${[['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']].map(([v, l]) => `<button class="${P.period === v ? 'on' : ''}" data-act="sales-set" data-k="period" data-v="${v}">${l}</button>`).join('')}</div></div>
      ${comboChart('salesChart', periods.map(p => p.label.replace(' · to date', '')), S3, L, { current: P.period === 'monthly' && curI >= 0 ? curI : null })}</div>`;
    // department → client table, with department targets (view + inline edit)
    const canT = api.can('targets.edit'), editT = !!S.salesEdit && canT, showT = P.metric === 'billed';
    const fyAll = fyMonths(S.fy);
    const tp = editT ? fyAll.map(m => ({ label: monthLabel(m) + (m === ymOf(TODAY) ? ' · to date' : ''), months: [m], from: m + '-01', to: ymDate(m, 31), cur: m === ymOf(TODAY), future: m > ymOf(TODAY) })) : periods;
    const tIdx = {}; tp.forEach((p, i) => p.months.forEach(m => tIdx[m] = i));
    if (editT && !S.salesDraft) { const cur = (Store.data.targets || {})[S.fy] || {}; S.salesDraft = Object.fromEntries(api.list('departments').map(d => [d.id, fyAll.map((_, i) => +(cur[d.id] || [])[i] || 0)])); }
    const tgOf = (dep, p) => editT ? sum(p.months, m => +(S.salesDraft[dep] || [])[fyAll.indexOf(m)] || 0) : targetFor(p.months, dep);
    const scope = 'sb:' + P.metric + ':';
    const mf = facts.filter(f => f.m === P.metric && tIdx[f.ym] != null);
    const nodes = api.list('departments').filter(d => d.active).map(d => {
      const df = mf.filter(f => f.dep === d.id);
      const clients = [...new Set(df.map(f => f.clientId))].map(c => ({ key: scope + d.id + ':' + c, label: nameOf('parties', c) || '—', vals: tp.map((_, i) => r2(sum(df.filter(f => f.clientId === c && tIdx[f.ym] === i), f => f.v))) })).sort((a, b) => sum(b.vals) - sum(a.vals));
      return { key: scope + d.id, label: d.name, dep: d.id, children: clients, vals: tp.map((_, i) => r2(sum(df.filter(f => tIdx[f.ym] === i), f => f.v))), tg: tp.map(p => tgOf(d.id, p)) };
    }).filter(n => sum(n.vals) || (showT && sum(n.tg)) || (editT && n.dep !== 'dep_unalloc')).sort((a, b) => (sum(b.tg) - sum(a.tg)) || (sum(b.vals) - sum(a.vals)));
    prepareTree(scope, nodes);
    const totals = tp.map((_, i) => sum(nodes, n => n.vals[i])), tgtT = tp.map((_, i) => sum(nodes, n => n.tg[i]));
    const cells = (n, depth) => tp.map((p, i) => `<td class="num ${n.vals[i] ? '' : 'zero'} ${p.cur ? 'cur' : ''}">${p.future ? '<span class="faint">—</span>' : n.vals[i] ? money(n.vals[i]) : '–'}</td>`).join('') + `<td class="num tot-c">${money(sum(n.vals))}</td>`;
    const detail = editT || !!S.sbDetail;
    const shareLbl = P.period === 'yearly' ? '% of total' : '% of FY';
    const shareRow = (vals, label, cls = '') => { const T = sum(vals), mx = Math.max(0, ...vals), R = rpRank(vals, tp); return `<tr class="leaf rp-row ${cls}"><td><span class="tw-leaf">${label}</span></td>${tp.map((p, i) => `<td class="num rp-h ${p.cur ? 'cur' : ''}" ${rpHeat(vals[i], mx)}>${vals[i] ? `<b>${rpF1(rpPc(vals[i], T))}</b>${rpTag(R, i)}` : '<span class="faint">–</span>'}</td>`).join('')}<td class="num tot-c">${T ? '<b>100%</b>' : '–'}</td></tr>`; };
    const tRows = n => {
      if (!detail) return '';
      const share = editT ? '' : shareRow(n.vals, shareLbl);
      if (!showT) return share;
      const tg = n.tg, T = sum(tg), A = sum(n.vals);
      const tCells = tp.map((p, i) => editT
        ? `<td class="num ${p.cur ? 'cur' : ''}"><input class="input num sm-in tg-in" type="number" min="0" step="1000" data-st="${n.dep}" data-i="${fyAll.indexOf(p.months[0])}" value="${tg[i] || ''}" placeholder="0"></td>`
        : `<td class="num muted ${p.cur ? 'cur' : ''}">${tg[i] ? money(tg[i]) : '—'}</td>`).join('');
      return share + `<tr class="t-row"><td><span class="tw-leaf">Target</span></td>${tCells}<td class="num tot-c muted" data-st-tot="${n.dep}">${T ? money(T) : '—'}</td></tr>`
        + (editT ? '' : `<tr class="a-row"><td><span class="tw-leaf">Achievement</span></td>${tp.map((p, i) => `<td class="num ${achClass(n.vals[i], tg[i])} ${p.cur ? 'cur' : ''}">${tg[i] ? pctTxt(n.vals[i], tg[i]) : '—'}</td>`).join('')}<td class="num tot-c ${achClass(A, T)}">${T ? pctTxt(A, T) : '—'}</td></tr>`);
    };
    const detBtn = editT ? '' : `<button class="btn btn-sm ${detail ? 'on' : ''}" data-act="sb-detail">${icon('chev').replace('<svg', `<svg style="width:13px;height:13px;transform:rotate(${detail ? 90 : 0}deg)"`)} ${detail ? 'Hide' : 'Show'} ${showT ? 'targets & %' : '% share'}</button>`;
    const headBtns = detBtn + (!showT ? ''
      : editT ? `<button class="btn btn-sm" data-act="st-cancel">Cancel</button><button class="btn btn-sm btn-navy" data-act="st-save">${icon('check')} Save targets</button>`
      : canT ? `<button class="btn btn-sm" data-act="st-edit">${icon('edit')} Edit targets</button>` : '');
    const table = `<div class="card"><div class="card-h"><div class="grow"><h3>By department & client${showT ? ' · vs target' : ''}</h3><div class="sub">${editT ? `Editing monthly targets for ${esc(fyLabel(S.fy))} (all 12 months shown). Values are pre-GST revenue on PIs issued.` : 'Department credit follows each order\'s split' + (detail ? ` · ${shareLbl} shaded darker for stronger periods` + (showT ? ', target and achievement under each department' : '') : (showT ? ' · company achievement shown; open “Show targets & %” for department detail' : ''))}</div></div>
        ${editT ? '' : `<div class="seg">${Object.entries(METRICS).map(([k, l]) => `<button class="${P.metric === k ? 'on' : ''}" data-act="sales-set" data-k="metric" data-v="${k}">${l}</button>`).join('')}</div>${levelSeg(scope, nodes, [['summary', 'Departments'], ['all', 'Clients']])}`}${headBtns}</div>
      <div class="tbl-wrap"><table class="tbl sticky-first cf st-tbl rp"><thead><tr><th class="first">${esc(METRICS[P.metric])}</th>${tp.map(p => `<th class="num ${p.cur ? 'cur' : ''}">${esc(p.label)}</th>`).join('')}<th class="num tot-c">${editT ? 'FY total' : 'Total'}</th></tr></thead><tbody>
      ${nodes.map(n => treeRowsHTML([n], cells) + tRows(n)).join('') || `<tr><td colspan="${tp.length + 2}"><div class="empty">Nothing recorded.</div></td></tr>`}
      <tr class="tot"><td>All departments</td>${totals.map((v, i) => `<td class="num ${tp[i].cur ? 'cur' : ''}">${tp[i].future ? '—' : money(v)}</td>`).join('')}<td class="num tot-c">${money(sum(totals))}</td></tr>
      ${detail && !editT ? shareRow(totals, shareLbl, 'rp-co') : ''}
      ${showT ? `${detail ? `<tr class="leaf t-row"><td><span class="tw-leaf">Company target</span></td>${tgtT.map((v, i) => `<td class="num muted" data-st-col="${i}">${v ? money(v) : '—'}</td>`).join('')}<td class="num tot-c muted" data-st-all>${money(sum(tgtT))}</td></tr>` : ''}
      ${editT ? '' : `<tr class="net"><td>Achievement</td>${tp.map((_, i) => `<td class="num ${achClass(totals[i], tgtT[i])}">${pctTxt(totals[i], tgtT[i])}</td>`).join('')}<td class="num tot-c ${achClass(sum(totals), sum(tgtT))}">${pctTxt(sum(totals), sum(tgtT))}</td></tr>`}` : ''}
      </tbody></table></div>${editT ? `<div class="pager"><span>Tip: the full grid with “annual → split evenly” and “copy last year” is in <a href="#/targets" data-act="tg-set" data-k="tab" data-v="targets">Targets & scorecards › Set targets</a>.</span><span class="spacer"></span><button class="btn btn-sm" data-act="st-cancel">Cancel</button><button class="btn btn-sm btn-navy" data-act="st-save">Save targets</button></div>` : ''}</div>`;
    // ageing & lists
    const age = Sales.ageing(); const ageMax = Math.max(1, ...age.map(a => a.amt));
    const ageCard = `<div class="card"><div class="card-h"><div class="grow"><h3>Unpaid PIs by age</h3><div class="sub">Days past due date · ${money(outAmt)} outstanding incl. GST</div></div><a class="btn btn-sm" href="#/pis">All PIs</a></div>
      <div class="card-b"><div class="ageing">${age.map(a => `<div class="age ${a.k}"><div class="l">${a.l}</div><div class="v">${money(a.amt)}</div><div class="s">${a.n} PI${a.n === 1 ? '' : 's'}</div><div class="bar ${a.k === 'notdue' ? 'in' : a.k === 'd30' ? 'gold' : 'out'}"><i style="width:${a.amt / ageMax * 100}%"></i></div></div>`).join('')}</div></div>
      ${pis.sort((a, b) => b.overdueDays - a.overdueDays || b.outstanding - a.outstanding).slice(0, 6).map(x => `<div class="list-row" data-act="open-pi" data-id="${x.p.id}" style="cursor:pointer"><div class="grow"><div class="t">${esc(x.p.piNo)} · ${esc(nameOf('parties', x.p.clientId))}</div><div class="s">${esc(x.p.milestone)} · due ${fmtDate(x.p.dueDate)}</div></div><div style="text-align:right"><div class="num" style="font-weight:600">${money(x.outstanding)}</div>${piStatusChip(x)}</div></div>`).join('')}</div>`;
    const big = ost.filter(x => x.toInvoice > 0).sort((a, b) => b.toInvoice - a.toInvoice).slice(0, 6);
    const bookCard = `<div class="card"><div class="card-h"><div class="grow"><h3>Order book · still to invoice</h3><div class="sub">${money(book)} across ${ost.filter(x => x.toInvoice > 0).length} orders</div></div><a class="btn btn-sm" href="#/orders">All orders</a></div>
      ${big.map(x => `<div class="list-row" data-act="open-order" data-id="${x.o.id}" style="cursor:pointer"><div class="grow"><div class="t">${esc(nameOf('projects', x.o.projectId))}</div><div class="s">${esc(nameOf('parties', x.o.clientId))} · ${esc(x.o.orderNo)}</div><div style="margin-top:6px;max-width:260px">${bar(x.pct, 'in')}</div></div><div style="text-align:right"><div class="num" style="font-weight:600">${money(x.toInvoice)}</div><div class="muted" style="font-size:12px">of ${money(x.o.taxable)}</div></div></div>`).join('') || '<div class="empty">Everything is invoiced.</div>'}</div>`;
    return `<div class="stack">${kpis}${chart}${table}<div class="grid g-2">${ageCard}${bookCard}</div>
      <div class="muted" style="font-size:12px">Orders booked = order value on the order date. PIs issued = revenue, counted on the PI date. Collected = operating receipts on the date received. All pre-GST. None of these change cash balances; only recorded receipts do.</div></div>`;
  },
  after() {
    const periods = salesPeriods(S.sales.period), facts = Sales.facts(); const pIdx = {}; periods.forEach((p, i) => p.months.forEach(m => pIdx[m] = i));
    const v = (m, i) => sum(facts.filter(f => f.m === m && pIdx[f.ym] === i), f => f.v);
    bindChartTip('salesChart', periods.map((p, i) => { const t = targetFor(p.months), b = v('billed', i); return { label: p.label, items: [['Booked', money(v('booked', i))], ['PIs issued', money(b), '#F5C977'], ['Target', t ? money(t) + ' · ' + pctTxt(b, t) : '—'], ['Collected', money(v('collected', i)), '#9FD8B9']] }; }));
  },
};

/* ---------------- ORDERS LIST ---------------- */
PAGES.orders = {
  title: 'Orders',
  render() {
    const F = S.ord; const [fyF, fyT] = fyRange(S.fy); const q = F.q.trim().toLowerCase();
    let rows = api.list('orders').map(o => ({ o, ...Sales.orderState(o) }));
    rows = rows.filter(x => (F.scope === 'all' || (F.scope === 'active' ? ['open', 'partly'].includes(x.status) || (x.status === 'full' && x.outstanding > 0) : x.o.date >= fyF && x.o.date <= fyT))
      && (!F.clientId || x.o.clientId === F.clientId) && (!F.departmentId || Sales.shares(x.o).some(s => s.departmentId === F.departmentId))
      && (!q || [x.o.orderNo, x.o.scope, nameOf('parties', x.o.clientId), nameOf('projects', x.o.projectId)].join(' ').toLowerCase().includes(q)));
    rows.sort((a, b) => b.o.date.localeCompare(a.o.date));
    const T = k => sum(rows, x => k === 'value' ? x.o.taxable : x[k]);
    return `<div class="toolbar">
      <div><div class="lbl" style="margin-bottom:5px">Show</div><div class="seg">${[['active', 'Active'], ['fy', fyLabel(S.fy)], ['all', 'All']].map(([v, l]) => `<button class="${F.scope === v ? 'on' : ''}" data-act="ord-set" data-k="scope" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div class="field" style="flex:2;min-width:200px"><label>Search</label><input class="input" data-inp="oq" value="${esc(F.q)}" placeholder="Order no., project, client…"></div>
      <div class="field"><label>Client</label><select class="select" data-of="clientId">${partyOptions('client', F.clientId, 'All clients')}</select></div>
      <div class="field"><label>Department</label><select class="select" data-of="departmentId">${deptOptions(F.departmentId, 'All departments')}</select></div>
      <span class="spacer"></span>${api.can('order.create') ? `<button class="btn btn-gold" data-act="new-order">${icon('plus')} New order</button>` : ''}</div>
      <div class="card" id="ordResults"><div class="summary-strip"><div><div class="l">Orders</div><div class="v">${rows.length}</div></div><div><div class="l">Order value</div><div class="v">${money(T('value'))}</div></div><div><div class="l">Invoiced</div><div class="v">${money(T('invoiced'))}</div></div><div><div class="l">Received</div><div class="v in">${money(T('received'))}</div></div><div><div class="l">To invoice</div><div class="v">${money(T('toInvoice'))}</div></div></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Order</th><th>Date</th><th>Client · project</th><th>Department</th><th class="num">Order value</th><th style="width:150px">Invoiced</th><th class="num">Received</th><th class="num">To invoice</th><th>Status</th></tr></thead><tbody>
      ${rows.map(x => `<tr class="click" data-act="open-order" data-id="${x.o.id}"><td><div class="cell-main">${esc(x.o.orderNo)}</div><div class="cell-sub">${esc(x.o.type)}${(x.o.amendments || []).length ? ' · amended' : ''}</div></td><td class="nowrap">${fmtDate(x.o.date)}</td>
        <td style="max-width:260px"><div>${esc(nameOf('parties', x.o.clientId))}</div><div class="cell-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nameOf('projects', x.o.projectId))}</div></td><td>${depNames(x.o)}</td>
        <td class="num">${money(x.o.taxable)}</td><td><div class="row" style="gap:6px;flex-wrap:nowrap">${bar(x.pct, 'in')}<span class="num muted" style="font-size:11.5px;min-width:34px">${Math.round(x.pct)}%</span></div><div class="cell-sub num">${money(x.invoiced)} · ${x.pis.length} PI${x.pis.length === 1 ? '' : 's'}</div></td>
        <td class="num in">${x.received ? money(x.received) : '–'}</td><td class="num" style="font-weight:600">${x.toInvoice ? money(x.toInvoice) : '–'}</td><td>${orderStatusChip(x.status)}${x.outstanding > 0 ? `<div class="cell-sub">${money(x.outstanding)} unpaid</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="9"><div class="empty"><b>No orders here</b>Change the filter or record a new order.</div></td></tr>'}
      </tbody></table></div></div><div class="muted" style="font-size:12px;margin-top:10px">Values are pre-GST. "Active" shows orders still to be invoiced, plus fully invoiced orders with unpaid PIs.</div>`;
  },
};

/* ---------------- PIs LIST ---------------- */
PAGES.pis = {
  title: 'Proforma invoices',
  render() {
    const F = S.pi; const [fyF, fyT] = fyRange(S.fy); const q = F.q.trim().toLowerCase();
    let rows = api.list('pis').map(p => ({ p, ...Sales.piState(p), o: Sales.orderOfPI(p) }));
    rows = rows.filter(x => ({ unpaid: x.outstanding > 0, overdue: x.outstanding > 0 && x.overdueDays > 0, fy: x.p.date >= fyF && x.p.date <= fyT, all: true }[F.scope])
      && (!F.clientId || x.p.clientId === F.clientId) && (!F.departmentId || Sales.shares(x.o).some(s => s.departmentId === F.departmentId))
      && (!q || [x.p.piNo, x.p.milestone, x.p.taxInvoiceNo, nameOf('parties', x.p.clientId), nameOf('projects', x.p.projectId), x.o ? x.o.orderNo : ''].join(' ').toLowerCase().includes(q)));
    rows.sort((a, b) => F.scope === 'unpaid' || F.scope === 'overdue' ? (b.overdueDays - a.overdueDays || a.p.dueDate.localeCompare(b.p.dueDate)) : b.p.date.localeCompare(a.p.date));
    const age = Sales.ageing();
    return `<div class="ageing" style="margin-bottom:16px">${age.map(a => `<div class="age card ${a.k}" style="padding:10px 14px"><div class="l">${a.l}</div><div class="v">${money(a.amt)}</div><div class="s">${a.n} PI${a.n === 1 ? '' : 's'}</div></div>`).join('')}</div>
      <div class="toolbar">
      <div><div class="lbl" style="margin-bottom:5px">Show</div><div class="seg">${[['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['fy', fyLabel(S.fy)], ['all', 'All']].map(([v, l]) => `<button class="${F.scope === v ? 'on' : ''}" data-act="pi-set" data-k="scope" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div class="field" style="flex:2;min-width:200px"><label>Search</label><input class="input" data-inp="pq" value="${esc(F.q)}" placeholder="PI no., tax invoice, client, order…"></div>
      <div class="field"><label>Client</label><select class="select" data-pf="clientId">${partyOptions('client', F.clientId, 'All clients')}</select></div>
      <div class="field"><label>Department</label><select class="select" data-pf="departmentId">${deptOptions(F.departmentId, 'All departments')}</select></div>
      <span class="spacer"></span>${api.can('pi.create') ? `<button class="btn btn-gold" data-act="new-pi">${icon('plus')} New PI</button>` : ''}</div>
      <div class="card"><div class="summary-strip"><div><div class="l">PIs</div><div class="v">${rows.length}</div></div><div><div class="l">Value (pre-GST)</div><div class="v">${money(sum(rows, x => x.p.status === 'cancelled' ? 0 : x.p.taxable))}</div></div><div><div class="l">Total incl. GST</div><div class="v">${money(sum(rows, x => x.p.status === 'cancelled' ? 0 : x.p.total))}</div></div><div><div class="l">Received</div><div class="v in">${money(sum(rows, x => x.gross))}</div></div><div><div class="l">Outstanding</div><div class="v out">${money(sum(rows, x => x.outstanding))}</div></div></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>PI no.</th><th>Date</th><th>Client · order</th><th>Milestone</th><th class="num">Pre-GST</th><th class="num">Total incl. GST</th><th class="num">Received</th><th class="num">Outstanding</th><th>Due</th><th>Status</th></tr></thead><tbody>
      ${rows.map(x => `<tr class="click" data-act="open-pi" data-id="${x.p.id}"><td><div class="cell-main mono" style="font-size:12.5px">${esc(x.p.piNo)}</div>${x.p.taxInvoiceNo ? `<div class="cell-sub">TI ${esc(x.p.taxInvoiceNo)}</div>` : ''}</td><td class="nowrap">${fmtDate(x.p.date)}</td>
        <td style="max-width:240px"><div>${esc(nameOf('parties', x.p.clientId))}</div><div class="cell-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.o ? x.o.orderNo : '')} · ${esc(nameOf('projects', x.p.projectId))}</div></td><td style="max-width:200px">${esc(x.p.milestone)}</td>
        <td class="num">${money(x.p.taxable)}</td><td class="num">${money(x.p.total)}</td><td class="num in">${x.gross ? money(x.gross) : '–'}</td><td class="num" style="font-weight:600">${x.outstanding ? money(x.outstanding) : '–'}</td><td class="nowrap">${fmtDate(x.p.dueDate)}</td><td class="nowrap">${piStatusChip(x)}</td></tr>`).join('') || '<tr><td colspan="10"><div class="empty"><b>No PIs here</b>Nothing matches this filter.</div></td></tr>'}
      </tbody></table></div></div><div class="muted" style="font-size:12px;margin-top:10px">Received counts the gross value settled by linked receipts (taxable + GST); TDS the client deducts counts as settled. Link a receipt to its PI from the receipt form, or use “Record receipt” on the PI.</div>`;
  },
};

/* ---------------- ORDER & PI DRAWERS ---------------- */
function drawerShell(head, body, foot) {
  closeDrawer();
  $('#layer').insertAdjacentHTML('beforeend', `<div id="drawer"><div class="drawer-ov" data-act="close-drawer"></div><aside class="drawer" role="dialog">${head}<div class="drawer-b">${body}</div><div class="drawer-f">${foot}</div></aside></div>`);
}
async function loadThumbs(atts) {
  for (const a of atts || []) {
    const box = $(`[data-im="${a.id}"]`); if (!box) continue;
    if (!a.type.startsWith('image/')) { box.innerHTML = `<div style="text-align:center"><div class="faint" style="width:30px;margin:auto">${icon('file')}</div><div class="muted" style="font-size:11px;margin-top:4px">PDF</div></div>`; continue; }
    const f = await FileStore.get(a.id).catch(() => null); if (f && f.blob) box.innerHTML = `<img alt="" src="${URL.createObjectURL(f.blob)}">`;
  }
}
const thumbsHTML = atts => (atts || []).length ? `<div class="thumbs">${atts.map(a => `<div class="thumb" data-act="view-file" data-id="${a.id}"><div class="im" data-im="${a.id}"><span class="faint" style="width:28px">${icon('file')}</span></div><div class="nm" title="${esc(a.name)}">${esc(a.name)}</div></div>`).join('')}</div>` : '<div class="muted" style="font-size:13px">No documents attached.</div>';
const historyHTML = id => Store.data.audit.filter(a => a.entityId === id).slice().reverse().map(auditLine).join('') || '<div class="muted">No history.</div>';
const kvRow = (k, v) => v == null || v === '' ? '' : `<dt>${k}</dt><dd>${v}</dd>`;

function openOrder(id) {
  const o = api.get('orders', id); if (!o) return; const st = Sales.orderState(o);
  const termRows = (o.terms || []).map((t, i) => { const amt = o.taxable * t.pct / 100; const raised = st.pis.filter(x => (x.pi.milestone || '').startsWith(t.label)); return `<tr><td>${esc(t.label)}</td><td class="num">${(+t.pct).toFixed(+t.pct % 1 ? 2 : 0)}%</td><td class="num">${money(amt)}</td><td>${raised.length ? raised.map(x => `<a href="#" data-act="open-pi" data-id="${x.pi.id}">${esc(x.pi.piNo.split('/').pop())}</a>`).join(', ') : '<span class="faint">Not raised</span>'}</td></tr>`; }).join('');
  const head = `<div class="drawer-h"><div class="type-ic inflow">${icon('file')}</div><div style="flex:1;min-width:0"><div style="font:600 16px var(--f-head)">${esc(nameOf('projects', o.projectId))}</div><div class="muted" style="font-size:12.5px">${esc(ORDER_TYPES[o.type])} ${esc(o.orderNo)} · ${fmtDate(o.date)} · ${esc(nameOf('parties', o.clientId))}</div>
    <div class="num" style="font-size:22px;font-weight:600;margin-top:6px">${money(o.taxable)} <span class="muted" style="font-size:13px;font-weight:400">pre-GST</span></div><div class="row" style="gap:6px;margin-top:6px">${orderStatusChip(st.status)}</div></div><button class="icon-btn" data-act="close-drawer">${icon('x')}</button></div>`;
  const body = `<div class="mini-kpis"><div><span>Invoiced</span><b>${money(st.invoiced)}</b><em>${Math.round(st.pct)}%</em></div><div><span>Received</span><b class="in">${money(st.received)}</b></div><div><span>To invoice</span><b>${money(st.toInvoice)}</b></div><div><span>Unpaid PIs</span><b class="${st.outstanding ? 'out' : ''}">${money(st.outstanding)}</b></div></div>
    <dl class="kv" style="margin-top:16px">${kvRow('Client', `<a href="#" data-act="open-party" data-id="${o.clientId}">${esc(nameOf('parties', o.clientId))}</a>`)}${kvRow('Project', esc(nameOf('projects', o.projectId)))}${kvRow('Department', depNames(o, true))}
      ${kvRow('GST', `<span class="num">${money(o.gstAmount)}</span> <span class="muted">@ ${o.gstRate}% · ${GST_TYPES[o.gstType]} · total ${money(o.total)}</span>`)}${kvRow('Scope', esc(o.scope || '—'))}${kvRow('Expected completion', o.expectedCompletion ? fmtDate(o.expectedCompletion) : '—')}${kvRow('Client contact', esc(o.contact || '—'))}${o.notes ? kvRow('Notes', esc(o.notes)) : ''}
      ${kvRow('Recorded', esc(userName(o.createdBy)) + ' · ' + fmtDateTime(o.createdAt))}</dl>
    <div class="fsec-h" style="margin-top:22px">Payment terms</div><table class="tbl" style="font-size:12.5px"><thead><tr><th>Milestone</th><th class="num">%</th><th class="num">Amount</th><th>PI</th></tr></thead><tbody>${termRows || '<tr><td colspan="4" class="muted">No terms recorded.</td></tr>'}</tbody></table>
    <div class="fsec-h" style="margin-top:22px">PIs raised (${st.pis.length})</div>${st.pis.map(x => `<div class="list-row" style="padding:8px 0;cursor:pointer" data-act="open-pi" data-id="${x.pi.id}"><div class="grow"><div class="t mono" style="font-size:12.5px">${esc(x.pi.piNo)}</div><div class="s">${fmtDate(x.pi.date)} · ${esc(x.pi.milestone)}</div></div><div style="text-align:right"><div class="num">${money(x.pi.taxable)}</div>${piStatusChip(x)}</div></div>`).join('') || '<div class="muted" style="font-size:13px">No PIs yet.</div>'}
    ${(o.amendments || []).length ? `<div class="fsec-h" style="margin-top:22px">Amendments</div>${o.amendments.map(a => `<div class="tl"><div style="flex:1"><div><b>${money(a.from)} → ${money(a.to)}</b> <span class="muted">(${a.to >= a.from ? '+' : ''}${money(a.to - a.from)})</span></div><div class="when">${fmtDate(a.date)} · ${esc(userName(a.by))}</div>${a.note ? `<div class="changes">${esc(a.note)}</div>` : ''}</div></div>`).join('')}` : ''}
    <div class="fsec-h" style="margin-top:22px">Attachments (${(o.attachments || []).length})</div>${thumbsHTML(o.attachments)}
    <div class="fsec-h" style="margin-top:22px">History</div><div class="timeline">${historyHTML(o.id)}</div>`;
  const active = !['cancelled', 'closed'].includes(st.status);
  const foot = `${active && api.can('pi.create') && st.toInvoice > 0 ? `<button class="btn btn-gold" data-act="new-pi" data-order="${o.id}">${icon('plus')} Raise PI</button>` : ''}${api.can('order.edit') && st.status !== 'cancelled' ? `<button class="btn" data-act="edit-order" data-id="${o.id}">${icon('edit')} Edit / amend</button>` : ''}<span class="spacer"></span>
    ${api.can('order.cancel') ? (active ? `<button class="btn btn-sm" data-act="order-status" data-id="${o.id}" data-v="closed">Close</button><button class="btn btn-sm btn-danger" data-act="order-status" data-id="${o.id}" data-v="cancelled">Cancel order</button>` : `<button class="btn btn-sm" data-act="order-status" data-id="${o.id}" data-v="active">Reopen</button>`) : ''}
    ${api.can('order.delete') && !st.pis.length ? `<button class="btn btn-sm btn-danger" data-act="del-rec" data-col="orders" data-id="${o.id}">${icon('trash')}</button>` : ''}`;
  drawerShell(head, body, foot); loadThumbs(o.attachments);
}
function openPI(id) {
  const p = api.get('pis', id); if (!p) return; const st = Sales.piState(p); const o = Sales.orderOfPI(p);
  const head = `<div class="drawer-h"><div class="type-ic inflow">${icon('receipt')}</div><div style="flex:1;min-width:0"><div style="font:600 16px var(--f-head)" class="mono">${esc(p.piNo)}</div><div class="muted" style="font-size:12.5px">${fmtDate(p.date)} · ${esc(nameOf('parties', p.clientId))}</div>
    <div class="num" style="font-size:22px;font-weight:600;margin-top:6px">${money(p.total)} <span class="muted" style="font-size:13px;font-weight:400">incl. GST</span></div><div class="row" style="gap:6px;margin-top:6px">${piStatusChip(st)}</div></div><button class="icon-btn" data-act="close-drawer">${icon('x')}</button></div>`;
  const body = `<div class="mini-kpis"><div><span>Pre-GST</span><b>${money(p.taxable)}</b></div><div><span>Received</span><b class="in">${money(st.gross)}</b></div><div><span>Outstanding</span><b class="${st.outstanding ? 'out' : ''}">${money(st.outstanding)}</b></div><div><span>Expected net</span><b>${money(p.total - p.tdsAmount)}</b><em>after TDS</em></div></div>
    <dl class="kv" style="margin-top:16px">${kvRow('Order', o ? `<a href="#" data-act="open-order" data-id="${o.id}">${esc(o.orderNo)}</a> <span class="muted">· ${esc(ORDER_TYPES[o.type])}</span>` : '—')}${kvRow('Project', esc(nameOf('projects', p.projectId)))}${kvRow('Department credit', o ? depNames(o) : '—')}${kvRow('Milestone', esc(p.milestone || '—'))}
      ${kvRow('GST', `<span class="num">${money(p.gstAmount)}</span> <span class="muted">@ ${p.gstRate}% · ${GST_TYPES[p.gstType]}</span>`)}${kvRow('Expected TDS', `<span class="num">${money(p.tdsAmount)}</span> <span class="muted">@ ${p.tdsRate}%</span>`)}
      ${kvRow('Due date', fmtDate(p.dueDate) + (st.overdueDays ? ` <span class="out">· ${st.overdueDays} days overdue</span>` : ''))}${kvRow('Tax invoice no.', esc(p.taxInvoiceNo || '—'))}${p.notes ? kvRow('Notes', esc(p.notes)) : ''}${kvRow('Recorded', esc(userName(p.createdBy)) + ' · ' + fmtDateTime(p.createdAt))}</dl>
    <div class="fsec-h" style="margin-top:22px">Receipts against this PI (${st.entries.length})</div>${st.entries.map(e => entryListRow(e)).join('') || '<div class="muted" style="font-size:13px">No receipts linked yet.</div>'}
    <div class="fsec-h" style="margin-top:22px">Attachments (${(p.attachments || []).length})</div>${thumbsHTML(p.attachments)}
    ${typeof gstSectionHTML === 'function' ? gstSectionHTML(p) : ''}
    ${typeof reminderSectionHTML === 'function' ? reminderSectionHTML(p) : ''}
    ${emailSectionHTML('pis', p.id, p.status !== 'cancelled' && api.can('email.queue'))}
    <div class="fsec-h" style="margin-top:22px">History</div><div class="timeline">${historyHTML(p.id)}</div>`;
  const foot = `${st.outstanding > 0 && api.can('entry.create') ? `<button class="btn btn-gold" data-act="pi-receipt" data-id="${p.id}">${icon('in')} Record receipt</button>` : ''}${api.can('pi.edit') && p.status !== 'cancelled' ? `<button class="btn" data-act="edit-pi" data-id="${p.id}">${icon('edit')} Edit</button>` : ''}<span class="spacer"></span>
    ${api.can('pi.cancel') ? (p.status === 'cancelled' ? `<button class="btn btn-sm" data-act="pi-status" data-id="${p.id}" data-v="issued">Reinstate</button>` : !st.entries.length ? `<button class="btn btn-sm btn-danger" data-act="pi-status" data-id="${p.id}" data-v="cancelled">Cancel PI</button>` : '') : ''}
    ${api.can('pi.delete') && !st.entries.length ? `<button class="btn btn-sm btn-danger" data-act="del-rec" data-col="pis" data-id="${p.id}">${icon('trash')}</button>` : ''}`;
  drawerShell(head, body, foot); loadThumbs(p.attachments);
}

/* ---------------- shared attachments block for order/PI forms ---------------- */
function attachBlock(v, F) {
  return `<div class="drop" data-x-act="pick-file">Drop the PO / PI document here or <u>browse</u> · images & PDF</div><input type="file" class="xfiles" multiple accept="image/*,application/pdf" style="display:none">
    <div class="files">${(v.attachments || []).map(a => `<div class="file"><span>${esc(a.name)}</span><button type="button" data-x-act="rm-old" data-id="${a.id}">${icon('x').replace('<svg', '<svg style="width:12px;height:12px"')}</button></div>`).join('')}${F.newFiles.map((f, i) => `<div class="file" style="border-color:var(--gold-line);background:var(--gold-soft)"><span>${esc(f.name)}</span><button type="button" data-x-act="rm-new" data-i="${i}">${icon('x').replace('<svg', '<svg style="width:12px;height:12px"')}</button></div>`).join('')}</div>`;
}
async function storeFiles(F, v) {
  const metas = [];
  for (const fl of F.newFiles) { const id = uid('f'); const meta = { id, name: fl.name, type: fl.type, size: fl.size }; await FileStore.put({ ...meta, blob: fl }); metas.push(meta); }
  for (const id of F.removed) await FileStore.del(id).catch(() => {});
  return [...(v.attachments || []), ...metas];
}
/** Generic modal form runner: state v, render fn, handlers. */
function runForm({ title, wide, v, F, bodyFn, onField, onAct, save }) {
  const ov = openModal(`<div class="modal-h"><h2>${title}</h2><button class="icon-btn" data-x-act="close">${icon('x')}</button></div><div class="modal-b" id="xBody"></div><div class="modal-f"><button class="btn" data-x-act="close">Cancel</button><button class="btn btn-gold" data-x-act="save">Save</button></div>`, wide ? '' : 'sm');
  const body = $('#xBody', ov); const draw = () => { body.innerHTML = bodyFn(); };
  F.redraw = draw; draw();
  const set = (el, live) => { const k = el.dataset.x; let val = el.type === 'checkbox' ? el.checked : el.value; if (el.dataset.num !== undefined) val = val === '' ? '' : +val; if (onField(k, val, el, live) !== false && !live) draw(); };
  body.addEventListener('input', ev => { const el = ev.target.closest('[data-x]'); if (el && el.tagName !== 'SELECT' && el.type !== 'checkbox' && el.type !== 'date') set(el, true); });
  body.addEventListener('change', ev => { const el = ev.target.closest('[data-x]'); if (el && (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date')) set(el, false); if (ev.target.classList.contains('xfiles')) { const fs = [...ev.target.files].filter(f => /^image\//.test(f.type) || f.type === 'application/pdf'); F.newFiles.push(...fs); draw(); } });
  body.addEventListener('dragover', ev => { if (ev.target.closest('.drop')) ev.preventDefault(); });
  body.addEventListener('drop', ev => { if (!ev.target.closest('.drop')) return; ev.preventDefault(); F.newFiles.push(...[...ev.dataTransfer.files].filter(f => /^image\//.test(f.type) || f.type === 'application/pdf')); draw(); });
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-x-act]'); if (!b) return; const a = b.dataset.xAct;
    if (a === 'close') return ov.remove();
    if (a === 'pick-file') return $('.xfiles', body).click();
    if (a === 'rm-new') { F.newFiles.splice(+b.dataset.i, 1); return draw(); }
    if (a === 'rm-old') { F.removed.push(b.dataset.id); v.attachments = v.attachments.filter(x => x.id !== b.dataset.id); return draw(); }
    if (a === 'save') { b.disabled = true; try { await save(); ov.remove(); afterWrite(); } catch (err) { F.errs = err.fields || {}; draw(); toast(err.message, 'error'); b.disabled = false; } return; }
    onAct && onAct(a, b);
  });
  return ov;
}
const xf = (F, k, label, inner, cls = '', hint = '') => `<div class="field ${cls} ${F.errs[k] ? 'has-err' : ''}"><label>${label}</label>${inner}${F.errs[k] ? `<div class="err">${esc(F.errs[k])}</div>` : hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
const xi = (v, k, attrs = '') => `<input class="input" data-x="${k}" value="${esc(v[k] ?? '')}" ${attrs}>`;
const xs = (k, options) => `<select class="select" data-x="${k}">${options}</select>`;

/* client contact on an order: pick from the client's people, or type */
function orderContactField(F, v) {
  const c = api.get('parties', v.clientId), list = partyContacts(c).filter(x => x.name);
  if (!list.length || F.contactFree) return xf(F, 'contact', 'Client contact', xi(v, 'contact', 'placeholder="Name (role)"'), '', list.length ? '<a href="#" data-x-act="contact-pick">Pick from saved people</a>' : (c ? 'Add people to this client in Masters to pick them here' : ''));
  const cur = list.find(x => contactLabel(x) === v.contact);
  return xf(F, 'contact', 'Client contact', `<select class="select" data-x="contactSel">${opts(list.map(x => [x.id, contactLabel(x)]), cur ? cur.id : '', v.contact && !cur ? v.contact : 'Select person')}</select>`, '', '<a href="#" data-x-act="contact-free">Type a different name</a>');
}
/* ---------------- ORDER FORM ---------------- */
/* Value is entered per department in ₹; order value = sum, shares are derived. Payment terms take ₹ or %; last milestone = balance. */
function openOrderForm(id, preset = {}) {
  const old = id ? api.get('orders', id) : null;
  const v = old ? JSON.parse(JSON.stringify(old)) : { type: 'PO', orderNo: '', date: TODAY, clientId: '', projectId: '', departmentId: '', split: [], scope: '', taxable: '', gstRate: 18, gstType: 'intra', gstAmount: 0, terms: [{ label: 'Advance', pct: 30 }, { label: 'Design freeze', pct: 40 }, { label: 'Final delivery', pct: 30 }], expectedCompletion: '', contact: '', notes: '', attachments: [], ...preset };
  // department rows with ₹ amounts
  if (v.split && v.split.length) {
    v.split = v.split.map(s => ({ departmentId: s.departmentId, amount: s.amount !== undefined ? +s.amount : r2((+v.taxable || 0) * s.pct / 100) }));
    const diff = r2((+v.taxable || 0) - sum(v.split, s => s.amount)); if (Math.abs(diff) > 0 && Math.abs(diff) < 1) v.split[v.split.length - 1].amount = r2(v.split[v.split.length - 1].amount + diff);
  } else v.split = [{ departmentId: v.departmentId || '', amount: +v.taxable || '' }];
  if (!v.terms || !v.terms.length) v.terms = [{ label: 'Full payment', pct: 100 }];
  const F = { errs: {}, newFiles: [], removed: [], newProj: false, np: { code: '', name: '' }, reason: '' };
  const total = () => r2(sum(v.split, s => +s.amount || 0));
  const fixBalance = () => { const n = v.terms.length; if (!n) return; v.terms[n - 1].pct = 100 - sum(v.terms.slice(0, -1), t => +t.pct || 0); };
  const fmtPct = p => { const x = Math.round(p * 100) / 100; return (x % 1 ? x.toFixed(2).replace(/0$/, '') : x) + '%'; };
  // a milestone typed in ₹ keeps its ₹ when department amounts change; one typed in % keeps its %
  const sync = () => { v.taxable = total(); v.gstAmount = r2(v.taxable * (+v.gstRate || 0) / 100); v.terms.slice(0, -1).forEach(t => { if (t.mode === 'amt') t.pct = t.amt === '' ? '' : (v.taxable > 0 ? +t.amt / v.taxable * 100 : 0); }); fixBalance(); };
  v.terms.forEach(t => { const p = +t.pct || 0; if (Math.abs(p * 100 - Math.round(p * 100)) > 1e-6) { t.mode = 'amt'; t.amt = r2(total() * p / 100); } });
  sync();
  const totals = () => `<div class="net-box"><div><div class="l">Order total incl. GST</div><div class="calc">${money(v.taxable)} + GST ${money(v.gstAmount)}</div></div><div class="v">${money(v.taxable + v.gstAmount)}</div></div>`;
  const deptRows = () => {
    const T = total(), multi = v.split.length > 1;
    return v.split.map((s, i) => `<div class="od-row"><select class="select" data-x="split.${i}.departmentId">${deptOptions(s.departmentId)}</select>
      <div class="ef-money"><span>₹</span><input class="input num" data-num data-x="split.${i}.amount" value="${s.amount === '' ? '' : s.amount}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Amount"></div>
      <span class="od-share" data-share="${i}">${multi && T > 0 ? fmtPct((+s.amount || 0) / T * 100) : ''}</span>
      ${multi ? `<button type="button" class="icon-btn" data-x-act="rm-split" data-i="${i}" title="Remove">${icon('x')}</button>` : '<span></span>'}</div>`).join('');
  };
  const termRows = () => {
    const T = total(), n = v.terms.length;
    return v.terms.map((t, i) => { const last = i === n - 1, amt = r2(T * (+t.pct || 0) / 100);
      return `<div class="od-row term ${last ? 'bal' : ''}"><input class="input" data-x="terms.${i}.label" value="${esc(t.label)}" placeholder="Milestone">
      ${last ? `<div class="od-bal num" data-tamt="${i}">${money(amt)}</div><div class="od-bal num" data-tpct="${i}">${fmtPct(+t.pct || 0)}</div><span class="od-tag">${n > 1 ? 'balance' : 'full'}</span>`
        : `<div class="ef-money"><span>₹</span><input class="input num" data-num data-x="terms.${i}.amt" data-tamt="${i}" value="${T > 0 && t.pct !== '' ? amt : ''}" type="number" min="0" step="0.01" inputmode="decimal"></div><div class="od-pct"><input class="input num" data-num data-x="terms.${i}.pct" data-tpct="${i}" value="${t.pct === '' ? '' : Math.round(t.pct * 100) / 100}" type="number" min="0" max="100" step="0.01"><span>%</span></div>
        <button type="button" class="icon-btn" data-x-act="rm-term" data-i="${i}" title="Remove">${icon('x')}</button>`}</div>`; }).join('');
  };
  const bodyFn = () => {
    const valueChanged = old && Math.abs(old.taxable - v.taxable) > 0.004;
    const balNeg = (v.terms[v.terms.length - 1] || {}).pct < -0.001;
    return `<div class="row" style="margin-bottom:16px"><div class="seg">${Object.keys(ORDER_TYPES).map(t => `<button type="button" class="${v.type === t ? 'on' : ''}" data-x-act="otype" data-v="${t}">${t === 'PO' ? 'PO' : t}</button>`).join('')}</div><span class="muted" style="font-size:12px">${esc(ORDER_TYPES[v.type])}</span></div>
    <div class="fsec"><div class="fsec-h">Order</div><div class="fgrid">
      ${xf(F, 'orderNo', (v.type === 'PO' ? 'PO number' : 'Reference') + ' *', xi(v, 'orderNo', 'placeholder="' + (v.type === 'PO' ? 'Client PO no.' : 'e.g. email date / LOI ref') + '"'))}
      ${xf(F, 'date', 'Order date *', xi(v, 'date', 'type="date"'))}
      ${xf(F, 'clientId', 'Client *', `<div class="row" style="flex-wrap:nowrap;gap:6px">${xs('clientId', partyOptions('client', v.clientId, 'Select client'))}<button type="button" class="btn" style="padding:0 10px" title="Add client" data-x-act="new-client">${icon('plus')}</button></div>`)}
      ${F.newProj ? `${xf(F, 'projectId', 'New project code *', `<input class="input" data-x="np.code" value="${esc(F.np.code)}" placeholder="e.g. IU-2608">`)}${xf(F, 'np.name', 'New project name *', `<input class="input" data-x="np.name" value="${esc(F.np.name)}">`, '', '<a href="#" data-x-act="pick-proj">Pick an existing project instead</a>')}`
        : xf(F, 'projectId', 'Project *', xs('projectId', projOptions(v.clientId, v.projectId, v.clientId ? 'Select project' : 'Choose client first')), '', '<a href="#" data-x-act="new-proj">+ Create a new project</a>')}
    </div></div>
    <div class="fsec"><div class="fsec-h">Value by department <span class="faint" style="text-transform:none;letter-spacing:0;font-weight:400">pre-GST</span></div>
      <div class="od-rows ${F.errs.split ? 'has-err' : ''}" id="odDepts">${deptRows()}</div>
      <div class="row" style="margin-top:8px;gap:10px"><button type="button" class="btn btn-sm" data-x-act="add-split">${icon('plus')} Add department</button><span class="muted" style="font-size:12px">${v.split.length > 1 ? 'Each PI on this order is credited to departments in this ratio.' : 'Order shared by teams? Add a department and type its amount.'}</span></div>
      ${F.errs.split ? `<div class="err" style="margin-top:6px">${esc(F.errs.split)}</div>` : ''}
      <div class="fgrid c4" style="margin-top:14px">
        <div class="field span2"><label>Order value, pre-GST</label><div class="od-total num" id="odTotal">${money(v.taxable)}</div><div class="hint">${v.split.length > 1 ? 'Total of the department amounts' : 'Same as the department amount'}</div></div>
        ${xf(F, 'gstRate', 'GST rate', xs('gstRate', opts(GST_RATES.map(r => [r, r + '%']), v.gstRate)))}
        ${xf(F, 'gstType', 'GST type', xs('gstType', opts(+v.gstRate ? [['intra', GST_TYPES.intra], ['inter', GST_TYPES.inter]] : [['none', GST_TYPES.none]], v.gstType)))}
        <div class="span3" id="odReason">${valueChanged ? xf(F, 'reason', 'Reason for value change *', `<input class="input" data-x="reason" value="${esc(F.reason)}" placeholder="e.g. Scope extended – second variant">`, '', 'Saved as an amendment: ' + money(old.taxable) + ' → ' + money(v.taxable)) : ''}</div>
      </div><div id="xTot">${totals()}</div></div>
    <div class="fsec"><div class="fsec-h">Payment terms <span class="faint" style="text-transform:none;letter-spacing:0;font-weight:400">type ₹ or % · last milestone takes the balance</span></div>
      <div class="row" style="margin-bottom:10px;gap:6px"><span class="muted" style="font-size:12px">Presets:</span>${[['100', '100%'], ['50-50', '50 / 50'], ['30-40-30', '30 / 40 / 30'], ['40-40-20', '40 / 40 / 20']].map(([k, l]) => `<button type="button" class="btn btn-sm" data-x-act="terms" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="od-rows" id="odTerms">${termRows()}</div>
      <button type="button" class="btn btn-sm" data-x-act="add-term" style="margin-top:8px">${icon('plus')} Add milestone</button>
      <div class="err" id="odTermErr" style="margin-top:6px">${F.errs.terms ? esc(F.errs.terms) : balNeg ? 'Milestones add up to more than the order value' : ''}</div></div>
    <div class="fsec"><div class="fsec-h">Details</div><div class="fgrid">
      ${xf(F, 'scope', 'Scope', `<textarea class="textarea" data-x="scope" rows="2">${esc(v.scope)}</textarea>`, 'span3')}
      ${xf(F, 'expectedCompletion', 'Expected completion', xi(v, 'expectedCompletion', 'type="date"'))}${orderContactField(F, v)}${xf(F, 'notes', 'Notes', xi(v, 'notes'))}
      <div class="span3">${attachBlock(v, F)}</div></div></div>`;
  };
  // live refresh without re-rendering the focused input
  const live = () => {
    sync();
    const T = total(), act = document.activeElement;
    $$('[data-share]').forEach(el => { const s = v.split[+el.dataset.share]; el.textContent = v.split.length > 1 && T > 0 ? fmtPct((+s.amount || 0) / T * 100) : ''; });
    $$('[data-tamt]').forEach(el => { const t = v.terms[+el.dataset.tamt]; if (!t || el === act) return; const a = r2(T * (+t.pct || 0) / 100); if (el.tagName === 'INPUT') el.value = T > 0 && t.pct !== '' ? a : ''; else el.textContent = money(a); });
    $$('[data-tpct]').forEach(el => { const t = v.terms[+el.dataset.tpct]; if (!t || el === act) return; if (el.tagName === 'INPUT') el.value = t.pct === '' ? '' : Math.round(t.pct * 100) / 100; else el.textContent = fmtPct(+t.pct || 0); });
    const tot = $('#odTotal'); if (tot) tot.textContent = money(v.taxable);
    const x = $('#xTot'); if (x) x.innerHTML = totals();
    const te = $('#odTermErr'); if (te) te.textContent = (v.terms[v.terms.length - 1] || {}).pct < -0.001 ? 'Milestones add up to more than the order value' : '';
    if (old) { const changed = Math.abs(old.taxable - v.taxable) > 0.004, r = $('#odReason'); if (r && changed !== !!$('[data-x=reason]', r)) r.innerHTML = changed ? xf(F, 'reason', 'Reason for value change *', `<input class="input" data-x="reason" value="${esc(F.reason)}" placeholder="e.g. Scope extended – second variant">`, '', 'Saved as an amendment: ' + money(old.taxable) + ' → ' + money(v.taxable)) : ''; else if (r && changed) { const h = $('.hint', r); if (h) h.textContent = 'Saved as an amendment: ' + money(old.taxable) + ' → ' + money(v.taxable); } }
  };
  runForm({ title: old ? 'Edit order ' + esc(old.orderNo) : 'New order', wide: true, v, F, bodyFn,
    onField(k, val, el, isLive) {
      if (k.startsWith('np.')) { F.np[k.slice(3)] = val; return false; }
      if (k === 'reason') { F.reason = val; return false; }
      if (k === 'contactSel') { const c = partyContacts(api.get('parties', v.clientId)).find(x => x.id === val); v.contact = c ? contactLabel(c) : ''; v.contactId = val; return false; }
      let m = k.match(/^split\.(\d+)\.(\w+)$/);
      if (m) { v.split[+m[1]][m[2]] = val; if (isLive) { live(); return false; } sync(); return; }
      m = k.match(/^terms\.(\d+)\.(\w+)$/);
      if (m) { const t = v.terms[+m[1]], T = total();
        if (m[2] === 'amt') { t.mode = 'amt'; t.amt = val; t.pct = val === '' ? '' : (T > 0 ? val / T * 100 : 0); } else { t[m[2]] = val; if (m[2] === 'pct') t.mode = 'pct'; }
        if (isLive) { live(); return false; } sync(); return false; }
      v[k] = val;
      if (k === 'clientId') { const c = api.get('parties', val); if (c) { v.gstType = c.gstType !== 'none' ? c.gstType : 'intra'; const pr = api.get('projects', v.projectId); if (pr && pr.clientId !== val) v.projectId = ''; const pc = partyContacts(c).find(x => x.name && (x.tags || []).includes('projects')) || partyContacts(c).find(x => x.name); if (!old || !v.contact) { v.contact = pc ? contactLabel(pc) : ''; v.contactId = pc ? pc.id : ''; } F.contactFree = false; } }
      if (k === 'projectId') { const pr = api.get('projects', val); if (pr && !v.split[0].departmentId) v.split[0].departmentId = pr.departmentId; }
      if (k === 'gstRate') { if (+val && v.gstType === 'none') v.gstType = 'intra'; if (!+val) v.gstType = 'none'; }
      sync();
      if (isLive) return false;
    },
    onAct(a, b) {
      if (a === 'otype') { v.type = b.dataset.v; F.redraw(); }
      if (a === 'contact-free') { F.contactFree = true; F.redraw(); }
      if (a === 'contact-pick') { F.contactFree = false; F.redraw(); }
      if (a === 'new-proj') { F.newProj = true; F.redraw(); }
      if (a === 'pick-proj') { F.newProj = false; F.redraw(); }
      if (a === 'new-client') quickParty('client', p => { v.clientId = p.id; v.gstType = p.gstType !== 'none' ? p.gstType : 'intra'; const pc = partyContacts(p).find(x => x.name); v.contact = pc ? contactLabel(pc) : ''; F.redraw(); });
      if (a === 'add-split') { const used = v.split.map(s => s.departmentId); const next = api.list('departments').find(d => d.active !== false && !used.includes(d.id)); v.split.push({ departmentId: '', amount: '' }); F.redraw(); const sel = $$('[data-x^="split."][data-x$=".departmentId"]').pop(); sel && sel.focus(); }
      if (a === 'rm-split') { v.split.splice(+b.dataset.i, 1); if (!v.split.length) v.split = [{ departmentId: '', amount: '' }]; sync(); F.redraw(); }
      if (a === 'add-term') { const n = v.terms.length; v.terms.splice(Math.max(0, n - 1), 0, { label: '', pct: 0 }); sync(); F.redraw(); const i = $$('[data-x$=".label"]', $('#odTerms'))[Math.max(0, n - 1)]; i && i.focus(); }
      if (a === 'rm-term') { v.terms.splice(+b.dataset.i, 1); if (!v.terms.length) v.terms = [{ label: 'Full payment', pct: 100 }]; sync(); F.redraw(); }
      if (a === 'terms') { const L = { '100': [['Full payment', 100]], '50-50': [['Advance', 50], ['On delivery', 50]], '30-40-30': [['Advance', 30], ['Design freeze', 40], ['Final delivery', 30]], '40-40-20': [['Advance', 40], ['Prototype approval', 40], ['Release', 20]] }[b.dataset.v]; v.terms = L.map(([label, pct]) => ({ label, pct })); sync(); F.redraw(); }
    },
    async save() {
      sync();
      if (!v.split.some(s => s.departmentId && +s.amount > 0)) { const e = new Error('Enter the amount for at least one department'); e.fields = { split: e.message }; throw e; }
      if (v.split.some(s => +s.amount > 0 && !s.departmentId)) { const e = new Error('Choose the department for each amount'); e.fields = { split: e.message }; throw e; }
      if (v.split.some(s => s.departmentId && !(+s.amount > 0))) { const e = new Error('Enter an amount for each department, or remove the empty row'); e.fields = { split: e.message }; throw e; }
      if ((v.terms[v.terms.length - 1] || {}).pct < -0.001) { const e = new Error('Payment milestones add up to more than the order value'); e.fields = { terms: e.message }; throw e; }
      v.attachments = await storeFiles(F, v); F.newFiles = []; F.removed = [];
      const input = { ...v }; ['id', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'deleted', 'amendments', 'status', 'total'].forEach(k => delete input[k]);
      input.split = v.split.map(s => ({ departmentId: s.departmentId, amount: +s.amount || 0 }));
      input.terms = v.terms.map(t => ({ label: t.label, pct: +t.pct || 0 }));
      const r = await api.saveOrder(input, id, F.reason, F.newProj ? { code: F.np.code.trim(), name: F.np.name.trim() } : null);
      toast(old ? 'Order updated' : 'Order ' + r.orderNo + ' recorded · ' + money(r.taxable));
    },
  });
}

/* ---------------- PI FORM ---------------- */
function openPIForm(id, orderId) {
  const old = id ? api.get('pis', id) : null;
  const v = old ? JSON.parse(JSON.stringify(old)) : { orderId: orderId || '', piNo: Sales.nextPiNo(TODAY), date: TODAY, dueDate: addDays(TODAY, 30), milestone: '', taxable: '', gstRate: 18, gstType: 'intra', gstAmount: 0, tdsRate: 10, tdsAmount: 0, taxInvoiceNo: '', notes: '', attachments: [] };
  const F = { errs: {}, newFiles: [], removed: [], gstAuto: !old, tdsAuto: !old, ms: '', autoNo: !old };
  const applyOrder = () => { const o = api.get('orders', v.orderId); if (!o) return; v.gstRate = o.gstRate; v.gstType = o.gstType; const st = Sales.orderState(o); const next = (o.terms || []).findIndex(t => !st.pis.some(x => (x.pi.milestone || '').startsWith(t.label))); if (next >= 0 && !old) pickMs(next); };
  const pickMs = i => { const o = api.get('orders', v.orderId); const t = o && o.terms[i]; if (!t) return; F.ms = String(i); v.milestone = `${t.label} (${+(+t.pct).toFixed(2)}%)`; v.taxable = r2(o.taxable * t.pct / 100); F.gstAuto = F.tdsAuto = true; recalc(); };
  const recalc = () => { const t = +v.taxable || 0; if (F.gstAuto) v.gstAmount = r2(t * (+v.gstRate || 0) / 100); if (F.tdsAuto) v.tdsAmount = r2(t * (+v.tdsRate || 0) / 100); const box = $('#xTot'); if (box) box.innerHTML = totals(); ['gstAmount', 'tdsAmount'].forEach(k => { const i = $(`[data-x=${k}]`); if (i && document.activeElement !== i) i.value = v[k] || ''; }); };
  const totals = () => { const t = +v.taxable || 0, g = +v.gstAmount || 0, d = +v.tdsAmount || 0; return `<div class="net-box"><div><div class="l">PI total incl. GST</div><div class="calc">${money(t)} + GST ${money(g)} · expected net after TDS ${money(t + g - d)}</div></div><div class="v">${money(t + g)}</div></div>`; };
  const creditDays = () => { const o = api.get('orders', v.orderId); const c = o && api.get('parties', o.clientId); return c && c.creditDays != null && c.creditDays !== '' ? +c.creditDays : 30; };
  if (!old) v.dueDate = addDays(v.date, creditDays());
  if (v.orderId && !old) applyOrder();
  const bodyFn = () => {
    const o = api.get('orders', v.orderId); const st = o ? Sales.orderState(o) : null;
    if (o) { if (!F.email || F.email.partyId !== o.clientId) { F.email = initEmail('pi_issued', o.clientId); if (old) F.email.on = false; } if (F.email._reset) delete F.email._reset; refreshEmail(F.email, piEmailVars({ ...v, clientId: o.clientId, projectId: o.projectId, total: (+v.taxable || 0) + (+v.gstAmount || 0) })); } else F.email = null;
    const orderOpts = api.list('orders').filter(x => x.id === v.orderId || (!['cancelled', 'closed'].includes(x.status) && Sales.orderState(x).toInvoice > 0)).sort((a, b) => b.date.localeCompare(a.date)).map(x => [x.id, `${nameOf('parties', x.clientId)} · ${x.orderNo} · ${nameOf('projects', x.projectId)}`]);
    const after = st ? st.invoiced - (old ? old.taxable : 0) + (+v.taxable || 0) : 0;
    return `<div class="fsec"><div class="fsec-h">Raised against</div><div class="fgrid c2">
      ${xf(F, 'orderId', 'Order *', xs('orderId', opts(orderOpts, v.orderId, 'Select an order')), 'span3')}
      ${o ? `<div class="span3"><div class="mini-kpis"><div><span>Order value</span><b>${money(o.taxable)}</b></div><div><span>Already invoiced</span><b>${money(st.invoiced - (old ? old.taxable : 0))}</b></div><div><span>After this PI</span><b class="${after > o.taxable + 1 ? 'out' : ''}">${money(after)}</b><em>${pctTxt(after, o.taxable)}</em></div></div>${after > o.taxable + 1 ? `<div class="notice" style="margin-top:10px">${icon('alert')}<div>This takes invoicing above the order value. Amend the order first if the scope has grown.</div></div>` : ''}</div>
        ${xf(F, 'ms', 'Milestone', `<select class="select" data-x="ms">${opts((o.terms || []).map((t, i) => [i, `${t.label} · ${+(+t.pct).toFixed(2)}% · ${money(o.taxable * t.pct / 100)}${st.pis.some(x => x.pi.id !== id && (x.pi.milestone || '').startsWith(t.label)) ? ' · already raised' : ''}`]), F.ms, 'Custom / part milestone')}</select>`)}
        ${xf(F, 'milestone', 'Milestone label', xi(v, 'milestone'))}` : ''}</div></div>
    <div class="fsec"><div class="fsec-h">PI</div><div class="fgrid">
      ${xf(F, 'piNo', 'PI number *', xi(v, 'piNo', 'class="input mono"'), '', F.autoNo ? 'Next in series · editable' : '')}
      ${xf(F, 'date', 'PI date *', xi(v, 'date', 'type="date"'))}${xf(F, 'dueDate', 'Payment due *', xi(v, 'dueDate', 'type="date"'), '', !old && F.dueAuto !== false ? `${creditDays()} days credit for this client` : '')}</div></div>
    <div class="fsec"><div class="fsec-h">Amount</div><div class="fgrid c4">
      ${xf(F, 'taxable', 'Pre-GST value (₹) *', xi(v, 'taxable', 'type="number" data-num step="0.01"'), 'span2')}
      ${xf(F, 'gstRate', 'GST rate', xs('gstRate', opts(GST_RATES.map(r => [r, r + '%']), v.gstRate)))}${xf(F, 'gstAmount', 'GST (₹)', xi(v, 'gstAmount', 'type="number" data-num step="0.01"'), '', 'Auto · editable')}
      ${xf(F, 'tdsRate', 'Expected TDS', xs('tdsRate', opts(TDS_RATES.map(r => [r, r + '%']), v.tdsRate)))}${xf(F, 'tdsAmount', 'TDS (₹)', xi(v, 'tdsAmount', 'type="number" data-num step="0.01"'))}
      ${xf(F, 'gstType', 'GST type', xs('gstType', opts(+v.gstRate ? [['intra', GST_TYPES.intra], ['inter', GST_TYPES.inter]] : [['none', GST_TYPES.none]], v.gstType)), 'span2')}
    </div><div id="xTot">${totals()}</div></div>
    <div class="fsec"><div class="fsec-h">Other</div><div class="fgrid c2">${xf(F, 'taxInvoiceNo', 'Tax invoice no.', xi(v, 'taxInvoiceNo', 'placeholder="Once converted"'))}${xf(F, 'notes', 'Notes', xi(v, 'notes'))}<div class="span3">${attachBlock(v, F)}</div></div></div>${F.email ? emailBoxHTML(F.email, { docs: (v.attachments || []).length + F.newFiles.length }) : ''}`;
  };
  const piOv = runForm({ title: old ? 'Edit PI' : 'New proforma invoice', wide: true, v, F, bodyFn,
    onField(k, val, el, live) {
      if (k === 'ms') { if (val === '') F.ms = ''; else pickMs(+val); return; }
      v[k] = val;
      if (k === 'orderId') { F.ms = ''; applyOrder(); if (!old && F.dueAuto !== false) v.dueDate = addDays(v.date, creditDays()); return; }
      if (k === 'date') { if (F.autoNo) v.piNo = Sales.nextPiNo(val); if (!old && F.dueAuto !== false) v.dueDate = addDays(val, creditDays()); return; }
      if (k === 'dueDate') F.dueAuto = false;
      if (k === 'piNo') F.autoNo = false;
      if (k === 'gstAmount') F.gstAuto = false; if (k === 'tdsAmount') F.tdsAuto = false;
      if (k === 'gstRate') { F.gstAuto = true; if (+val && v.gstType === 'none') v.gstType = 'intra'; if (!+val) v.gstType = 'none'; }
      if (k === 'tdsRate') F.tdsAuto = true;
      if (k === 'taxable') F.ms = F.ms;
      recalc(); if (live) return false;
    },
    async save() { checkEmail(F.email); v.attachments = await storeFiles(F, v); F.newFiles = []; F.removed = []; const input = { ...v }; ['id', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'deleted', 'status', 'total', 'clientId', 'projectId'].forEach(k => delete input[k]); const r = await api.savePI(input, id); const mail = await finalizeEmail(F.email, { entity: 'pis', entityId: r.id, docs: r.attachments || [] }).catch(err => { toast('PI saved, but the email was not queued: ' + err.message, 'error'); return null; }); toast((old ? 'PI updated' : 'PI ' + r.piNo + ' issued') + (mail ? ' · emailed to ' + mail.to.join(', ') + ' (queued)' : '')); },
  });
  bindEmailEvents($('#xBody', piOv), () => F.email, F.redraw);
}

/* ---------------- TARGETS & SCORECARDS ---------------- */
function defaultScoreMonth() { const cur = ymOf(TODAY); const fyM = fyMonths(S.fy).filter(m => m <= cur); return fyM.includes(addMonths(cur, -1)) ? addMonths(cur, -1) : fyM[fyM.length - 1] || fyMonths(S.fy)[0]; }
function scoreDepts() { const fy = S.fy; return api.list('departments').filter(d => d.active && (sum(fyMonths(fy), m => Sales.targetForMonth(m, d.id)) > 0 || Sales.facts().some(f => f.dep === d.id && fyMonths(fy).includes(f.ym)))); }
function deptStats(dep, ym, facts) {
  const fy = fyOf(ym + '-01'), fyM = fyMonths(fy), qi = Math.floor(fyM.indexOf(ym) / 3), qM = fyM.slice(qi * 3, qi * 3 + 3).filter(m => m <= ym), ytdM = fyM.slice(0, fyM.indexOf(ym) + 1);
  const v = (m, ms) => r2(sum(facts.filter(f => f.dep === dep && f.m === m && ms.includes(f.ym)), f => f.v));
  const t = ms => targetFor(ms, dep);
  const blk = ms => ({ billed: v('billed', ms), target: t(ms), booked: v('booked', ms), collected: v('collected', ms) });
  return { month: blk([ym]), qtd: blk(qM), ytd: blk(ytdM), q: qi + 1, fyM, fy };
}
function scorecardHTML(dep, ym, { costs = false, facts = Sales.facts() } = {}) {
  const d = api.get('departments', dep); const st = deptStats(dep, ym, facts);
  const tile = (title, b) => `<div class="sc-tile"><div class="sc-t">${title}</div><div class="sc-big">${money(b.billed)}</div><div class="sc-sub">PIs issued vs target ${b.target ? money(b.target) : '—'}</div>
    <div class="sc-bar"><div class="bar ${b.target && b.billed / b.target >= 1 ? 'in' : b.target && b.billed / b.target >= 0.8 ? 'gold' : 'out'}" style="height:8px"><i style="width:${b.target ? Math.min(100, b.billed / b.target * 100) : 0}%"></i></div><span class="num">${pctTxt(b.billed, b.target)}</span></div>
    <div class="sc-mini"><span>Booked <b class="num">${money(b.booked)}</b></span><span>Collected <b class="num">${money(b.collected)}</b></span></div></div>`;
  const months = st.fyM; const curI = months.indexOf(ym);
  const mv = (m, ym2) => r2(sum(facts.filter(f => f.dep === dep && f.m === m && f.ym === ym2), f => f.v));
  const billed = months.map(m => m <= ym ? mv('billed', m) : 0), tg = months.map(m => Sales.targetForMonth(m, dep));
  let cumB = 0, cumT = 0;
  const rows = months.filter(m => m <= ym).map(m => { const b = mv('billed', m), t = Sales.targetForMonth(m, dep); cumB += b; cumT += t; return `<tr class="${m === ym ? 'sc-cur' : ''}"><td>${monthLabel(m, true)}</td><td class="num muted">${t ? money(t) : '—'}</td><td class="num" style="font-weight:600">${money(b)}</td><td class="num ${achClass(b, t)}">${pctTxt(b, t)}</td><td class="num ${achClass(cumB, cumT)}">${pctTxt(cumB, cumT)}</td><td class="num">${money(mv('booked', m))}</td><td class="num in">${money(mv('collected', m))}</td></tr>`; }).join('');
  const share = (o, amt) => { const s = Sales.shares(o).find(x => x.departmentId === dep); return s ? amt * s.pct / 100 : 0; };
  const pisM = api.list('pis').filter(p => p.status !== 'cancelled' && ymOf(p.date) === ym && Sales.shares(Sales.orderOfPI(p)).some(s => s.departmentId === dep));
  const ordM = api.list('orders').filter(o => o.status !== 'cancelled' && ymOf(o.date) === ym && Sales.shares(o).some(s => s.departmentId === dep));
  const unpaid = api.list('pis').map(p => ({ p, ...Sales.piState(p) })).filter(x => x.outstanding > 0 && x.p.date <= ymDate(ym, 31) && Sales.shares(Sales.orderOfPI(x.p)).some(s => s.departmentId === dep));
  let costBlock = '';
  if (costs) {
    const ms = months.filter(m => m <= ym); const ents = Calc.live().filter(e => e.type === 'outflow' && e.departmentId === dep);
    const outM = sum(ents.filter(e => ymOf(e.date) === ym), e => e.amount), outY = sum(ents.filter(e => ms.includes(ymOf(e.date))), e => e.amount);
    costBlock = `<div class="sc-sec">Department costs <span class="chip gold" style="margin-left:6px">Owner copy</span></div><div class="sc-costs"><div><span>Outflow · ${monthLabel(ym)}</span><b class="num out">${money(outM)}</b></div><div><span>Outflow · FY to date</span><b class="num out">${money(outY)}</b></div><div><span>Collected − outflow · FY to date</span><b class="num ${st.ytd.collected - outY >= 0 ? 'in' : 'out'}">${money(st.ytd.collected - outY, { sign: true })}</b></div></div>`;
  }
  const L = list => list.length ? list : '<div class="muted" style="font-size:12.5px;padding:6px 0">None.</div>';
  return `<div class="scorecard">
    <div class="sc-head"><div><div class="sc-brand">IUOVA · Department scorecard</div><div class="sc-name">${esc(d.name)}</div><div class="sc-meta">${monthLabel(ym, true)} · ${esc(fyLabel(st.fy))}${d.managerName ? ' · Manager: ' + esc(d.managerName) : ''}</div></div><div style="text-align:right">${achChip(st.month.billed, st.month.target)}<div class="sc-meta" style="margin-top:6px">Prepared ${fmtDate(TODAY)}</div></div></div>
    <div class="sc-tiles">${tile(monthLabel(ym, true), st.month)}${tile('Q' + st.q + ' to date', st.qtd)}${tile(fyLabel(st.fy) + ' to date', st.ytd)}</div>
    <div class="sc-sec">Revenue (PIs issued) vs target · ${esc(fyLabel(st.fy))}</div>
    ${comboChart('sc_' + dep, months.map(m => monthLabel(m).slice(0, 3)), [{ name: 'PIs issued', color: '#1B2A4A', values: billed }], { name: 'Target', color: '#EBA937', values: tg }, { current: curI, h: 220 })}
    <table class="tbl sc-tbl"><thead><tr><th>Month</th><th class="num">Target</th><th class="num">PIs issued</th><th class="num">Achieved</th><th class="num">Cumulative</th><th class="num">Orders booked</th><th class="num">Collected</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="sc-cols"><div><div class="sc-sec">PIs issued in ${monthLabel(ym, true)}</div>${L(pisM.map(p => { const o = Sales.orderOfPI(p); return `<div class="sc-li"><div><b>${esc(nameOf('parties', p.clientId))}</b><div class="muted">${esc(p.piNo)} · ${esc(p.milestone)}</div></div><span class="num">${money(share(o, p.taxable))}${Sales.shares(o).length > 1 ? `<div class="muted" style="font-size:11px">${shareTxt(Sales.shares(o).find(s => s.departmentId === dep).pct)} share</div>` : ''}</span></div>`; }).join(''))}</div>
      <div><div class="sc-sec">Orders booked in ${monthLabel(ym, true)}</div>${L(ordM.map(o => `<div class="sc-li"><div><b>${esc(nameOf('parties', o.clientId))}</b><div class="muted">${esc(o.orderNo)} · ${esc(nameOf('projects', o.projectId))}</div></div><span class="num">${money(share(o, o.taxable))}</span></div>`).join(''))}</div></div>
    <div class="sc-sec">Unpaid PIs (department share)</div>${L(unpaid.map(x => `<div class="sc-li"><div><b>${esc(nameOf('parties', x.p.clientId))}</b><div class="muted">${esc(x.p.piNo)} · due ${fmtDate(x.p.dueDate)}${x.overdueDays ? ` · <span class="out">${x.overdueDays}d overdue</span>` : ''}</div></div><span class="num">${money(share(Sales.orderOfPI(x.p), x.outstanding))}</span></div>`).join(''))}
    ${costBlock}
    <div class="sc-foot">Revenue = PI value before GST, credited by each order's department split. Collected = client receipts before GST. Target set by management for ${esc(fyLabel(st.fy))}.</div></div>`;
}
PAGES.targets = {
  title: 'Targets & scorecards',
  render() {
    const me = api.me(), isMgr = me.role === 'manager', T = S.tg;
    const months = fyMonths(S.fy).filter(m => m <= ymOf(TODAY));
    if (!T.ym || !months.includes(T.ym)) T.ym = defaultScoreMonth();
    const deps = scoreDepts();
    if (isMgr) T.dep = me.departmentId; else if (!T.dep || !api.get('departments', T.dep)) T.dep = (deps[0] || {}).id || '';
    const tabs = isMgr ? '' : `<div class="tabs">${[['scorecards', 'Scorecards'], ['targets', 'Set targets']].map(([k, l]) => `<button class="${T.tab === k ? 'on' : ''}" data-act="tg-set" data-k="tab" data-v="${k}">${l}</button>`).join('')}</div>`;
    if (!isMgr && T.tab === 'targets') return tabs + targetsGrid();
    const facts = Sales.facts();
    const ctl = `<div class="toolbar">
      ${isMgr ? '' : `<div class="field"><label>Department</label><select class="select" data-tgf="dep">${opts(api.list('departments').filter(d => d.active).map(d => [d.id, d.name]), T.dep)}</select></div>`}
      <div class="field"><label>Month</label><select class="select" data-tgf="ym">${opts(months.slice().reverse().map(m => [m, monthLabel(m, true) + (m === ymOf(TODAY) ? ' (to date)' : '')]), T.ym)}</select></div>
      ${!isMgr && me.role === 'owner' ? `<label class="check" style="height:38px;align-self:flex-end"><input type="checkbox" data-tgf="costs" ${T.costs ? 'checked' : ''}> Include department costs (owner copy)</label>` : ''}
      <span class="spacer"></span><button class="btn btn-navy" data-act="print-sc">${icon('file')} Print / save PDF</button>${!isMgr ? `<button class="btn" data-act="print-all">Print all departments</button>` : ''}</div>`;
    let league = '';
    if (!isMgr) {
      const rows = deps.map(d => ({ d, st: deptStats(d.id, T.ym, facts) }));
      const tot = k => ({ billed: sum(rows, r => r.st[k].billed), target: sum(rows, r => r.st[k].target) });
      const cell = b => `<td class="num">${money(b.billed)}<div class="tsub muted">of ${b.target ? money(b.target) : '—'}</div></td><td class="num ${achClass(b.billed, b.target)}" style="font-weight:600">${pctTxt(b.billed, b.target)}</td>`;
      league = `<div class="card" style="margin-bottom:16px"><div class="card-h"><div class="grow"><h3>All departments · ${monthLabel(T.ym, true)}</h3><div class="sub">PIs issued vs target · click a row to open its scorecard</div></div></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Department</th><th>Manager</th><th class="num">Month</th><th class="num">%</th><th class="num">Quarter to date</th><th class="num">%</th><th class="num">FY to date</th><th class="num">%</th><th>Status</th></tr></thead><tbody>
        ${rows.map(r => `<tr class="click ${r.d.id === T.dep ? 'sel' : ''}" data-act="tg-dep" data-id="${r.d.id}"><td class="cell-main">${esc(r.d.name)}</td><td>${esc(r.d.managerName || '—')}</td>${cell(r.st.month)}${cell(r.st.qtd)}${cell(r.st.ytd)}<td>${achChip(r.st.ytd.billed, r.st.ytd.target)}</td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">Set targets to see department performance.</div></td></tr>'}
        </tbody>${rows.length ? `<tfoot><tr><td colspan="2">Company</td>${cell(tot('month'))}${cell(tot('qtd'))}${cell(tot('ytd'))}<td></td></tr></tfoot>` : ''}</table></div></div>`;
    }
    const sc = T.dep ? scorecardHTML(T.dep, T.ym, { costs: !isMgr && T.costs, facts }) : '<div class="card"><div class="empty">Choose a department.</div></div>';
    return tabs + (isMgr ? `<div class="notice info" style="margin-bottom:14px">${icon('info')}<div>You're signed in as <b>${esc(me.name)}</b>, manager of ${esc(nameOf('departments', me.departmentId))}. This view shows your department only.</div></div>` : '') + ctl + league + `<div class="card sc-card">${sc}</div>`;
  },
};
function targetsGrid() {
  const fy = S.fy, months = fyMonths(fy), can = api.can('targets.edit');
  const deps = api.list('departments').filter(d => d.active && d.id !== 'dep_unalloc');
  const cur = (Store.data.targets || {})[fy] || {};
  S.tgDraft = S.tgDraft && S.tgDraft.fy === fy ? S.tgDraft : { fy, rows: Object.fromEntries(deps.map(d => [d.id, months.map((_, i) => (cur[d.id] || [])[i] || 0)])) };
  const R = S.tgDraft.rows; const colT = months.map((_, i) => sum(deps, d => +(R[d.id] || [])[i] || 0));
  return `<div class="page-intro">Monthly revenue targets per department, measured on PIs issued (pre-GST). The company target is the sum of departments. ${can ? 'Type an annual figure and press Split to spread it evenly, or edit months individually.' : 'Only the Owner can change targets.'}</div>
    <div class="card"><div class="tbl-wrap"><table class="tbl sticky-first tgt"><thead><tr><th style="min-width:170px">${esc(fyLabel(fy))}</th>${can ? '<th style="min-width:190px">Annual → split</th>' : ''}${months.map(m => `<th class="num">${monthLabel(m)}</th>`).join('')}<th class="num tot-c">FY total</th></tr></thead><tbody>
    ${deps.map(d => `<tr><td><div class="cell-main">${esc(d.name)}</div><div class="cell-sub">${esc(d.managerName || 'No manager')}</div></td>${can ? `<td><div class="row" style="flex-wrap:nowrap;gap:6px"><input class="input num sm-in" data-tg-annual="${d.id}" placeholder="Annual ₹"><button class="btn btn-sm" data-act="tg-split" data-id="${d.id}">Split</button></div></td>` : ''}
      ${months.map((m, i) => `<td class="num">${can ? `<input class="input num sm-in" data-tg="${d.id}" data-i="${i}" value="${(R[d.id] || [])[i] || ''}" type="number" min="0" step="1000">` : money((R[d.id] || [])[i] || 0)}</td>`).join('')}<td class="num tot-c" data-tg-tot="${d.id}">${money(sum(R[d.id] || [], x => +x || 0))}</td></tr>`).join('')}
    <tr class="tot"><td>Company</td>${can ? '<td></td>' : ''}${colT.map(v => `<td class="num">${money(v)}</td>`).join('')}<td class="num tot-c">${money(sum(colT))}</td></tr></tbody></table></div>
    ${can ? `<div class="pager"><span>Changes are logged in the audit trail.</span><span class="spacer"></span><button class="btn" data-act="tg-copy">Copy from ${esc(fyLabel(fy - 1))}</button><button class="btn btn-navy" data-act="tg-save">Save targets</button></div>` : ''}</div>`;
}
function printScorecards(deps, ym, costs) {
  const facts = Sales.facts();
  let root = $('#printRoot'); if (!root) { root = document.createElement('div'); root.id = 'printRoot'; document.body.appendChild(root); }
  root.innerHTML = deps.map(d => `<div class="print-page">${scorecardHTML(d, ym, { costs, facts })}</div>`).join('');
  document.body.classList.add('print-mode');
  const done = () => { document.body.classList.remove('print-mode'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(() => { if (document.body.classList.contains('print-mode') && !window.matchMedia('print').matches) done(); }, 1500); }, 60);
}

Object.assign(ACT, {
  'open-order': el => openOrder(el.dataset.id),
  'open-pi': el => openPI(el.dataset.id),
  'new-order': () => { if (!api.can('order.create')) return toast('Not allowed for your role', 'error'); closeDrawer(); openOrderForm(null, S.ord.clientId ? { clientId: S.ord.clientId } : {}); },
  'edit-order': el => { closeDrawer(); openOrderForm(el.dataset.id); },
  'new-pi': el => { if (!api.can('pi.create')) return toast('Not allowed for your role', 'error'); closeDrawer(); openPIForm(null, el.dataset.order || ''); },
  'edit-pi': el => { closeDrawer(); openPIForm(el.dataset.id); },
  'order-status': async el => {
    const o = api.get('orders', el.dataset.id), v = el.dataset.v;
    const msg = { cancelled: 'Cancelled orders drop out of the order book and booked revenue. Existing PIs stay as they are.', closed: 'Closing marks the order complete; any value not yet invoiced leaves the order book.', active: 'The order returns to the active order book.' }[v];
    if (!await confirmBox({ title: { cancelled: 'Cancel order ', closed: 'Close order ', active: 'Reopen order ' }[v] + o.orderNo + '?', body: msg, ok: { cancelled: 'Cancel order', closed: 'Close order', active: 'Reopen' }[v], danger: v === 'cancelled' })) return;
    try { await api.setOrderStatus(o.id, v); toast('Order updated'); afterWrite(); } catch (err) { toast(err.message, 'error'); }
  },
  'pi-status': async el => {
    const p = api.get('pis', el.dataset.id), v = el.dataset.v;
    if (!await confirmBox({ title: (v === 'cancelled' ? 'Cancel ' : 'Reinstate ') + p.piNo + '?', body: v === 'cancelled' ? 'A cancelled PI no longer counts as revenue or as outstanding. The number stays used.' : 'The PI counts again as revenue and outstanding.', ok: v === 'cancelled' ? 'Cancel PI' : 'Reinstate', danger: v === 'cancelled' })) return;
    try { await api.setPIStatus(p.id, v); toast('PI updated'); afterWrite(); } catch (err) { toast(err.message, 'error'); }
  },
  'del-rec': async el => {
    if (!await confirmBox({ title: 'Delete permanently?', body: 'This removes the record from all views. The audit log keeps a note of it.', ok: 'Delete', danger: true })) return;
    try { await api.removeRecord(el.dataset.col, el.dataset.id); toast('Deleted'); afterWrite(); } catch (err) { toast(err.message, 'error'); }
  },
  'pi-receipt': el => {
    const p = api.get('pis', el.dataset.id), st = Sales.piState(p), o = Sales.orderOfPI(p), pr = api.get('projects', p.projectId);
    const cat = pr && /^RET/.test(pr.code) ? 'cat_retain' : o && o.type === 'Email' ? 'cat_consult' : o && o.departmentId === 'dep_eng' ? 'cat_reng' : 'cat_rdesign';
    closeDrawer();
    openEntryForm({ preset: { type: 'inflow', partyKind: 'client', partyId: p.clientId, projectId: p.projectId, piId: p.id, categoryId: cat, departmentId: o ? o.departmentId : '', taxable: st.outstandingTaxable || p.taxable, gstRate: p.gstRate, gstType: p.gstType, tdsRate: p.tdsRate, refNo: p.taxInvoiceNo || p.piNo, description: p.milestone, paymentMode: 'NEFT' } });
  },
  'sales-set': el => { S.sales[el.dataset.k] = el.dataset.v; render({ keepScroll: true }); },
  'st-edit': () => { S.salesEdit = true; S.salesDraft = null; S.sales.metric = 'billed'; render({ keepScroll: true }); },
  'st-cancel': () => { S.salesEdit = false; S.salesDraft = null; render({ keepScroll: true }); },
  'st-save': async () => {
    try {
      const cur = JSON.parse(JSON.stringify((Store.data.targets || {})[S.fy] || {}));
      for (const [d, arr] of Object.entries(S.salesDraft || {})) if (arr.some(x => +x) || cur[d]) cur[d] = arr.map(x => +x || 0);
      await api.saveTargets(S.fy, cur); S.salesEdit = false; S.salesDraft = null; S.tgDraft = null; toast('Targets saved'); render({ keepScroll: true });
    } catch (err) { toast(err.message, 'error'); }
  },
  'ord-set': el => { S.ord[el.dataset.k] = el.dataset.v; render({ keepScroll: true }); },
  'pi-set': el => { S.pi[el.dataset.k] = el.dataset.v; render({ keepScroll: true }); },
  'tg-set': el => { S.tg[el.dataset.k] = el.dataset.v; S.salesEdit = false; S.salesDraft = null; if (S.page !== 'targets') go('targets'); else render(); },
  'tg-dep': el => { S.tg.dep = el.dataset.id; render({ keepScroll: true }); setTimeout(() => $('.sc-card')?.scrollIntoView({ behavior: 'smooth' }), 50); },
  'tg-split': el => { const i = $(`[data-tg-annual="${el.dataset.id}"]`); const a = +i.value; if (!(a > 0)) return toast('Enter an annual amount first', 'error'); const m = Math.round(a / 12); S.tgDraft.rows[el.dataset.id] = Array.from({ length: 12 }, (_, k) => k < 11 ? m : a - m * 11); render({ keepScroll: true }); },
  'tg-copy': () => { const prev = (Store.data.targets || {})[S.fy - 1] || {}; Object.keys(S.tgDraft.rows).forEach(d => { if (prev[d]) S.tgDraft.rows[d] = prev[d].slice(); }); render({ keepScroll: true }); toast('Copied – review and save'); },
  'tg-save': async () => { try { await api.saveTargets(S.fy, JSON.parse(JSON.stringify(S.tgDraft.rows))); S.tgDraft = null; toast('Targets saved'); render({ keepScroll: true }); } catch (err) { toast(err.message, 'error'); } },
  'print-sc': () => printScorecards([S.tg.dep], S.tg.ym, api.me().role === 'owner' && S.tg.costs),
  'print-all': () => printScorecards(scoreDepts().map(d => d.id), S.tg.ym, false),
});

/* ============================ EMAIL: composer, outbox, settings ============================ */
IC.mail = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>';
IC.send = '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>';
S.outbox = { status: 'open', q: '' };

/** Composer state for one email. */
function initEmail(kind, partyId, forceOn) {
  const p = api.get('parties', partyId), list = partyEmails(p), es = emailSettings();
  const r = emailRoute(p, kind);
  return { kind, partyId, on: forceOn || (es.autoTick && r.to.length > 0), to: r.to.slice(), newTo: '', saveNew: true, cc: [...new Set([...r.cc, ...(es.cc || [])])].join(', '), subject: '', body: '', edited: false, attachDocs: true, files: [], err: '' };
}
function refreshEmail(E, vars) { if (!E || E.edited) return; const t = emailSettings().templates[E.kind] || DEFAULT_EMAIL_TEMPLATES[E.kind]; E.subject = fillTemplate(t.subject, vars); E.body = fillTemplate(t.body, vars); }
function emailBoxHTML(E, { docs = 0, standalone = false } = {}) {
  if (!E) return '';
  const p = api.get('parties', E.partyId), saved = partyEmails(p), who = p ? (p.kind === 'client' ? 'client' : 'vendor') : 'party';
  const extra = E.to.filter(x => !saved.includes(x));
  const head = standalone ? '' : `<label class="check em-toggle"><input type="checkbox" data-em="on" ${E.on ? 'checked' : ''}> ${icon('mail').replace('<svg', '<svg style="width:15px;height:15px"')} Email this to the ${who} <span class="muted" style="font-weight:400">· ${esc(EMAIL_KINDS[E.kind])}</span></label>`;
  if (!E.on && !standalone) return `<div class="fsec em-box off">${head}${!saved.length ? `<div class="hint" style="margin:4px 0 0 26px">No email saved for ${esc(p ? p.name : 'this party')} yet. Tick to add one.</div>` : ''}</div>`;
  return `<div class="fsec em-box">${head}
    <div class="em-grid">
      <div class="lbl">To</div><div><div class="em-to">${[...saved, ...extra].map(x => { const c = partyContacts(p).find(c => c.email === x); return `<label class="em-chip ${E.to.includes(x) ? 'on' : ''}" title="${esc(x)}"><input type="checkbox" data-em-to="${esc(x)}" ${E.to.includes(x) ? 'checked' : ''}>${c && c.name ? `<b>${esc(c.name)}</b> <span class="faint">${esc(x)}</span>` : esc(x)}${saved.includes(x) ? '' : ' <span class="faint">new</span>'}</label>`; }).join('') || '<span class="muted" style="font-size:12.5px">No saved email for this party</span>'}</div>
        <div class="row" style="flex-wrap:nowrap;gap:6px;margin-top:8px"><input class="input" data-em="newTo" value="${esc(E.newTo)}" placeholder="Add email address" type="email" style="max-width:300px"><button type="button" class="btn btn-sm" data-em-act="add">${icon('plus')} Add</button>
        ${p ? `<label class="check" style="font-size:12.5px"><input type="checkbox" data-em="saveNew" ${E.saveNew ? 'checked' : ''}> Save new addresses to ${esc(p.name)}</label>` : ''}</div>${E.err ? `<div class="err" style="margin-top:4px">${esc(E.err)}</div>` : ''}</div>
      <div class="lbl">CC</div><div><input class="input" data-em="cc" value="${esc(E.cc)}" placeholder="Optional, comma-separated"></div>
      <div class="lbl">Subject</div><div><input class="input" data-em="subject" value="${esc(E.subject)}"></div>
      <div class="lbl">Message</div><div><textarea class="textarea em-body" data-em="body" rows="9">${esc(E.body)}</textarea>
        <div class="row" style="justify-content:space-between;margin-top:4px"><span class="hint">${E.edited ? 'Edited · amounts no longer update automatically' : 'Filled from the template · updates as you change amounts'}</span>${E.edited ? '<button type="button" class="btn btn-sm btn-ghost" data-em-act="reset">Reset to template</button>' : ''}</div></div>
      <div class="lbl">Attach</div><div>${docs ? `<label class="check" style="font-size:13px"><input type="checkbox" data-em="attachDocs" ${E.attachDocs ? 'checked' : ''}> Documents on this record (${docs})</label>` : '<span class="muted" style="font-size:12.5px">No documents on this record.</span>'}
        <div class="files" style="margin-top:6px">${E.files.map((f, i) => `<div class="file" style="border-color:var(--gold-line);background:var(--gold-soft)"><span>${esc(f.name)}</span><button type="button" data-em-act="rm-file" data-i="${i}">${icon('x').replace('<svg', '<svg style="width:12px;height:12px"')}</button></div>`).join('')}
        <button type="button" class="btn btn-sm" data-em-act="pick">${icon('clip')} Upload file for this email</button></div><input type="file" class="em-files" multiple accept="image/*,application/pdf" style="display:none"></div>
    </div>
    <div class="em-note">${icon('info').replace('<svg', '<svg style="width:14px;height:14px;flex:none"')}<span>Saving puts this email in the <b>outbox</b>; it is sent from <b>${esc(emailSettings().from)}</b> once the mail server is connected. Until then you can open any outbox email in your mail app.</span></div></div>`;
}
/** Delegated handler. Returns true if the event was an email event. */
function handleEmail(ev, E, redraw) {
  if (!E) return false; const t = ev.target;
  if (ev.type === 'input' && t.dataset && t.dataset.em) {
    const k = t.dataset.em; if (['subject', 'body'].includes(k)) { E[k] = t.value; if (!E.edited) { E.edited = true; const h = t.closest('.em-box').querySelector('.em-grid .hint'); if (h) h.textContent = 'Edited · amounts no longer update automatically'; } }
    else if (k === 'newTo' || k === 'cc') E[k] = t.value; return true;
  }
  if (ev.type === 'change') {
    if (t.dataset && t.dataset.em && t.type === 'checkbox') { E[t.dataset.em] = t.checked; if (t.dataset.em === 'on') redraw(); return true; }
    if (t.dataset && t.dataset.emTo != null) { const x = t.dataset.emTo; E.to = t.checked ? [...new Set([...E.to, x])] : E.to.filter(y => y !== x); redraw(); return true; }
    if (t.classList && t.classList.contains('em-files')) { E.files.push(...[...t.files].filter(f => /^image\//.test(f.type) || f.type === 'application/pdf')); redraw(); return true; }
  }
  if (ev.type === 'click') {
    const b = t.closest('[data-em-act]'); if (!b) return false; const a = b.dataset.emAct;
    if (a === 'add') { const xs = splitEmails(E.newTo); const bad = xs.filter(x => !validEmail(x)); if (!xs.length || bad.length) { E.err = bad.length ? 'Not a valid email: ' + bad.join(', ') : 'Type an email address first'; } else { E.err = ''; E.to = [...new Set([...E.to, ...xs])]; E.newTo = ''; } redraw(); }
    if (a === 'reset') { E.edited = false; E._reset = true; redraw(); }
    if (a === 'pick') b.closest('.em-box').querySelector('.em-files').click();
    if (a === 'rm-file') { E.files.splice(+b.dataset.i, 1); redraw(); }
    return true;
  }
  if (ev.type === 'keydown' && ev.key === 'Enter' && t.dataset && t.dataset.em === 'newTo') { ev.preventDefault(); t.closest('.em-box').querySelector('[data-em-act=add]').click(); return true; }
  return false;
}
function bindEmailEvents(root, getE, redraw) { ['input', 'change', 'click', 'keydown'].forEach(type => root.addEventListener(type, ev => handleEmail(ev, getE(), redraw))); }
/** Validate before the record is saved, so a bad address doesn't leave a half-done save. */
function checkEmail(E) {
  if (!E || !E.on) return;
  const pending = splitEmails(E.newTo); if (pending.length) { if (pending.some(x => !validEmail(x))) throw new Error('Check the email address you typed'); E.to = [...new Set([...E.to, ...pending])]; E.newTo = ''; }
  if (!E.to.length) throw new Error('Pick or add at least one email address, or untick “Email this”');
  const badCc = splitEmails(E.cc).filter(x => !validEmail(x)); if (badCc.length) throw new Error('Not a valid CC address: ' + badCc.join(', '));
}
async function finalizeEmail(E, { entity, entityId, docs = [] }) {
  if (!E || !E.on) return null;
  const metas = [];
  for (const fl of E.files) { const id = uid('f'); const meta = { id, name: fl.name, type: fl.type, size: fl.size }; await FileStore.put({ ...meta, blob: fl }); metas.push(meta); }
  const p = api.get('parties', E.partyId);
  if (p && E.saveNew) { const saved = partyEmails(p); const add = E.to.filter(x => !saved.includes(x)); if (add.length && api.can('party.edit')) {
    const contacts = [...partyContacts(p), ...add.map((x, i) => ({ id: uid('ct'), name: '', designation: '', email: x, phone: '', whatsapp: false, tags: partyContacts(p).length || i ? ['projects'] : ['accounts'] }))];
    await api.update('parties', p.id, { contacts, email: [...saved, ...add].join(', ') }, { summary: 'Email added for ' + p.name }); } }
  return api.queueEmail({ kind: E.kind, entity, entityId, partyId: E.partyId, to: E.to, cc: splitEmails(E.cc), subject: E.subject, body: E.body, attachments: [...(E.attachDocs ? docs : []), ...metas] });
}

/** Standalone composer for an existing entry or PI. */
function composeEmail(entity, id) {
  if (!api.can('email.queue')) return toast('Not allowed for your role', 'error');
  const rec = api.get(entity, id); const kind = entity === 'pis' ? 'pi_issued' : entryEmailKind(rec);
  if (!kind) return toast('Emails are sent for vendor payments, client receipts and PIs only', 'error');
  const partyId = entity === 'pis' ? rec.clientId : rec.partyId;
  const E = initEmail(kind, partyId, true); E.on = true;
  const vars = () => entity === 'pis' ? piEmailVars(rec) : entryEmailVars(rec);
  closeDrawer();
  const ov = openModal(`<div class="modal-h"><h2>${icon('mail').replace('<svg', '<svg style="width:18px;height:18px;display:inline;vertical-align:-3px;margin-right:6px"')}${esc(EMAIL_KINDS[kind])}</h2><button class="icon-btn" data-c="close">${icon('x')}</button></div><div class="modal-b" id="emBody"></div>
    <div class="modal-f"><button class="btn" data-c="close">Cancel</button><button class="btn" data-c="mailapp">Open in mail app</button><button class="btn btn-gold" data-c="queue">${icon('send')} Queue email</button></div>`);
  const body = $('#emBody', ov); const draw = () => { refreshEmail(E, vars()); body.innerHTML = `<div class="muted" style="font-size:13px;margin-bottom:12px">For ${esc(entity === 'pis' ? 'PI ' + rec.piNo : describe('entries', rec))}</div>` + emailBoxHTML(E, { docs: (rec.attachments || []).length, standalone: true }); };
  draw(); bindEmailEvents(body, () => E, draw);
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-c]'); if (!b) return;
    if (b.dataset.c === 'close') return ov.remove();
    try {
      checkEmail(E);
      const m = await finalizeEmail(E, { entity, entityId: id, docs: rec.attachments || [] });
      if (b.dataset.c === 'mailapp') { window.location.href = mailtoHref(m); await api.setEmailStatus(m.id, 'mailapp', 'Opened in mail app by ' + api.me().name); }
      ov.remove(); toast(b.dataset.c === 'mailapp' ? 'Opened in your mail app · logged in the outbox' : 'Email queued to ' + m.to.join(', ')); afterWrite();
    } catch (err) { toast(err.message, 'error'); }
  });
}
function emailsFor(entity, id) { return api.list('emails').filter(m => m.entity === entity && m.entityId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
const emailStatusChip = s => `<span class="chip ${{ queued: 'gold', sent: 'inflow', failed: 'overdue', cancelled: '', mailapp: 'transfer' }[s] || ''}">${EMAIL_STATUS[s] || s}</span>`;
function emailSectionHTML(entity, id, canSend) {
  const list = emailsFor(entity, id);
  return `<div class="fsec-h" style="margin-top:22px">Emails (${list.length})</div>${list.map(m => `<div class="list-row" style="padding:8px 0;cursor:pointer" data-act="view-email" data-id="${m.id}"><span class="faint" style="width:16px;flex:none">${icon('mail')}</span><div class="grow"><div class="t" style="font-size:13px">${esc(m.subject)}</div><div class="s">${esc(m.to.join(', '))} · ${fmtDateTime(m.createdAt)}</div></div>${emailStatusChip(m.status)}</div>`).join('') || '<div class="muted" style="font-size:13px">No emails sent for this record.</div>'}
    ${canSend ? `<button class="btn btn-sm" style="margin-top:10px" data-act="compose-email" data-entity="${entity}" data-id="${id}">${icon('mail')} ${list.length ? 'Send another email' : 'Email this'}</button>` : ''}`;
}

/* ---------------- outbox page ---------------- */
PAGES.outbox = {
  title: 'Email outbox',
  render() {
    const F = S.outbox, q = F.q.trim().toLowerCase();
    const all = api.list('emails');
    const cnt = st => all.filter(m => st === 'open' ? ['queued', 'failed'].includes(m.status) : st === 'all' || m.status === st).length;
    let rows = all.filter(m => (F.status === 'all' || (F.status === 'open' ? ['queued', 'failed'].includes(m.status) : m.status === F.status)) && (!q || [m.subject, m.to.join(' '), nameOf('parties', m.partyId)].join(' ').toLowerCase().includes(q)));
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return `<div class="notice info" style="margin-bottom:16px">${icon('info')}<div>Emails are <b>queued</b> here when entries and PIs are saved. Once the backend mail service is connected it sends every queued email from <b>${esc(emailSettings().from)}</b> and marks it Sent or Failed. Until then, use <b>Open in mail app</b> to send any email from Outlook or Gmail.</div></div>
    <div class="toolbar"><div class="seg">${[['open', 'Needs attention'], ['queued', 'Queued'], ['sent', 'Sent'], ['failed', 'Failed'], ['all', 'All']].map(([k, l]) => `<button class="${F.status === k ? 'on' : ''}" data-act="ob-set" data-v="${k}">${l} <span class="faint">${cnt(k)}</span></button>`).join('')}</div>
      <div class="field" style="flex:1;min-width:220px"><input class="input" data-inp="obq" value="${esc(F.q)}" placeholder="Search recipient, subject, party…"></div>${api.can('settings.edit') ? '<a class="btn" href="#/settings">Templates & sender</a>' : ''}</div>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Created</th><th>Type</th><th>To</th><th style="width:34%">Subject</th><th>Record</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(m => `<tr class="click" data-act="view-email" data-id="${m.id}"><td class="nowrap">${fmtDateTime(m.createdAt)}<div class="cell-sub">${esc(userName(m.createdBy))}</div></td><td class="nowrap">${esc({ vendor_payment: 'Payment advice', client_receipt: 'Receipt', pi_issued: 'PI', pi_reminder: 'Reminder', statement: 'Statement', tds_request: 'TDS request', digest: 'Digest', gst_pack: 'GST to CA', tds_pack: 'TDS to CA', tds_return: 'TDS return pack', tds_cert: 'Form 16A / 16' }[m.kind] || EMAIL_KINDS[m.kind] || m.kind)}</td><td style="max-width:220px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.to.join(', '))}</div><div class="cell-sub">${esc(nameOf('parties', m.partyId))}</div></td>
      <td><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px">${esc(m.subject)}</div>${m.attachments.length ? `<div class="cell-sub">${icon('clip').replace('<svg', '<svg style="width:12px;height:12px;display:inline;vertical-align:-2px"')} ${m.attachments.length} attachment(s)</div>` : ''}</td>
      <td class="nowrap">${m.entity === 'pis' ? esc(nameOf('pis', m.entityId).split('/').slice(-2).join('/')) : 'Entry'}</td><td>${emailStatusChip(m.status)}${m.error ? `<div class="cell-sub out">${esc(m.error)}</div>` : ''}</td>
      <td class="nowrap"><a class="icon-btn" title="Open in mail app" href="${esc(mailtoHref(m))}" data-act="ob-mailapp" data-id="${m.id}">${icon('ext')}</a></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty"><b>Nothing here</b>No emails match this filter.</div></td></tr>'}
    </tbody></table></div></div>`;
  },
};
function viewEmail(id) {
  const m = api.get('emails', id); if (!m) return;
  const canStatus = api.can('email.status');
  const ov = openModal(`<div class="modal-h"><h2 style="font-size:15.5px">${esc(m.subject)}</h2>${emailStatusChip(m.status)}<button class="icon-btn" data-v="close">${icon('x')}</button></div>
    <div class="modal-b"><dl class="kv" style="grid-template-columns:90px 1fr;margin-bottom:14px"><dt>From</dt><dd>${esc(m.from)}</dd><dt>To</dt><dd>${esc(m.to.join(', '))}</dd>${m.cc.length ? `<dt>CC</dt><dd>${esc(m.cc.join(', '))}</dd>` : ''}<dt>Type</dt><dd>${esc(EMAIL_KINDS[m.kind])}</dd><dt>Record</dt><dd><a href="#" data-v="record">${m.entity === 'pis' ? 'PI ' + esc(nameOf('pis', m.entityId)) : 'Open entry'}</a></dd>${m.sentAt ? `<dt>Sent</dt><dd>${fmtDateTime(m.sentAt)}</dd>` : ''}${m.error ? `<dt>Error</dt><dd class="out">${esc(m.error)}</dd>` : ''}</dl>
    <pre class="em-pre">${esc(m.body)}</pre>
    ${m.attachments.length ? `<div class="fsec-h" style="margin-top:16px">Attachments</div><div class="files">${m.attachments.map(a => `<button class="file" data-act="view-file" data-id="${a.id}">${icon('file').replace('<svg', '<svg style="width:14px;height:14px"')}<span>${esc(a.name)}</span></button>`).join('')}</div>` : ''}
    <div class="fsec-h" style="margin-top:16px">History</div>${(m.events || []).map(e => `<div class="tl"><div style="flex:1"><b>${esc(EMAIL_STATUS[e.status] || e.status)}</b> <span class="muted">· ${e.by === 'system' ? 'Mail server' : esc(userName(e.by))}</span><div class="when">${fmtDateTime(e.ts)}${e.note ? ' · ' + esc(e.note) : ''}</div></div></div>`).join('')}</div>
    <div class="modal-f">${canStatus && m.status !== 'cancelled' ? `<span class="muted" style="font-size:11.5px;margin-right:auto;align-self:center">Status buttons are for testing until the mail server updates them.</span>${m.status !== 'sent' ? '<button class="btn btn-sm" data-v="sent">Mark sent</button>' : ''}${m.status !== 'failed' ? '<button class="btn btn-sm" data-v="failed">Mark failed</button>' : ''}${['failed', 'mailapp', 'sent'].includes(m.status) ? '<button class="btn btn-sm" data-v="queued">Re-queue</button>' : ''}` : ''}
      ${api.can('email.cancel') && ['queued', 'failed'].includes(m.status) ? '<button class="btn btn-sm btn-danger" data-v="cancelled">Cancel</button>' : ''}
      <a class="btn btn-gold" href="${esc(mailtoHref(m))}" data-v="mailapp">${icon('ext')} Open in mail app</a></div>`);
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-v]'); if (!b) return; const v = b.dataset.v;
    if (v === 'close') return ov.remove();
    if (v === 'record') { ev.preventDefault(); ov.remove(); return m.entity === 'pis' ? openPI(m.entityId) : openEntry(m.entityId); }
    if (v === 'mailapp') { if (m.status === 'queued' || m.status === 'failed') { try { await api.setEmailStatus(m.id, 'mailapp', 'Opened in mail app by ' + api.me().name); } catch (e) {} } setTimeout(() => { ov.remove(); render({ keepScroll: true }); }, 300); return; }
    let note = '';
    if (v === 'failed') { note = prompt('Failure reason (e.g. bounced)?', 'Bounced – mailbox unavailable'); if (note === null) return; }
    try { await api.setEmailStatus(m.id, v, note); ov.remove(); toast('Email marked ' + EMAIL_STATUS[v].toLowerCase()); render({ keepScroll: true }); } catch (err) { toast(err.message, 'error'); }
  });
}

/* ---------------- settings card ---------------- */
function emailSettingsCard() {
  const es = emailSettings(), owner = api.can('settings.edit'), dis = owner ? '' : 'disabled';
  return `<div class="card"><div class="card-h"><div class="grow"><h3>Email</h3><div class="sub">Sender, default CC and the templates used for payment advices, receipts and PIs</div></div>${owner ? '<button class="btn btn-sm" data-act="em-reset-tpl">Reset templates</button>' : ''}</div><div class="card-b"><form id="emForm">
    <div class="fgrid">
      <div class="field"><label>Send from</label><input class="input" name="from" value="${esc(es.from)}" ${dis}><div class="hint">The backend sends as this address</div></div>
      <div class="field"><label>Always CC</label><input class="input" name="cc" value="${esc((es.cc || []).join(', '))}" placeholder="Optional, comma-separated" ${dis}></div>
      <div class="field" style="justify-content:flex-end"><label class="check" style="height:38px"><input type="checkbox" name="autoTick" ${es.autoTick ? 'checked' : ''} ${dis}> Tick “Email this” automatically when the party has an email</label></div>
    </div>
    ${Object.keys(DEFAULT_EMAIL_TEMPLATES).map(k => [k, EMAIL_KINDS[k]]).map(([k, l]) => `<div class="fsec" style="margin-top:18px"><div class="fsec-h">${esc(l)}</div><div class="fgrid c2"><div class="field span3"><label>Subject</label><input class="input" name="${k}.subject" value="${esc((es.templates[k] || DEFAULT_EMAIL_TEMPLATES[k]).subject)}" ${dis}></div><div class="field span3"><label>Message</label><textarea class="textarea em-body" rows="8" name="${k}.body" ${dis}>${esc((es.templates[k] || DEFAULT_EMAIL_TEMPLATES[k]).body)}</textarea></div></div></div>`).join('')}
    <div class="hint" style="margin-top:6px">Placeholders: ${Object.entries(EMAIL_VARS).map(([k, l]) => `<code class="mono" title="${esc(l)}">{${k}}</code>`).join(' ')}</div>
    </form>${owner ? '<div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn btn-navy" data-act="em-save-settings">Save email settings</button></div>' : ''}</div></div>`;
}

Object.assign(ACT, {
  'view-email': el => viewEmail(el.dataset.id),
  'compose-email': el => composeEmail(el.dataset.entity, el.dataset.id),
  'ob-set': el => { S.outbox.status = el.dataset.v; render({ keepScroll: true }); },
  'ob-mailapp': async el => { const m = api.get('emails', el.dataset.id); if (m && ['queued', 'failed'].includes(m.status) && api.can('email.status')) { try { await api.setEmailStatus(m.id, 'mailapp', 'Opened in mail app by ' + api.me().name); } catch (e) {} setTimeout(() => render({ keepScroll: true }), 300); } window.location.href = el.getAttribute('href'); },
  'em-save-settings': async () => {
    const f = $('#emForm'); const cc = splitEmails(f.cc.value); const bad = [f.from.value.trim(), ...cc].filter(x => !validEmail(x));
    if (bad.length) return toast('Not a valid email: ' + bad.join(', '), 'error');
    const templates = Object.fromEntries(Object.keys(DEFAULT_EMAIL_TEMPLATES).map(k => [k, { subject: f[k + '.subject'].value, body: f[k + '.body'].value }]));
    try { await api.saveEmailSettings({ from: f.from.value.trim(), cc, autoTick: f.autoTick.checked, templates }); toast('Email settings saved'); render({ keepScroll: true }); } catch (err) { toast(err.message, 'error'); }
  },
  'em-reset-tpl': async () => { if (!await confirmBox({ title: 'Reset email templates?', body: 'All templates go back to the original wording. Sender and CC are kept.', ok: 'Reset' })) return; await api.saveEmailSettings({ templates: JSON.parse(JSON.stringify(DEFAULT_EMAIL_TEMPLATES)) }); toast('Templates reset'); render({ keepScroll: true }); },
});
/* ============================ CLIENTS & VENDORS: tabbed form, contacts, drawer ============================ */
IC.phone = '<path d="M22 16.92v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0122 16.92z"/>';
IC.chat = '<path d="M21 11.5a8.4 8.4 0 01-12.3 7.4L3 21l2.1-5.6A8.4 8.4 0 1121 11.5z"/>';
const PF_TABS = [['company', 'Company'], ['people', 'People'], ['tax', 'Tax, terms & bank']];
const blankContact = (tags = ['accounts']) => ({ id: uid('ct'), name: '', designation: '', email: '', phone: '', whatsapp: false, tags });
const stateOptions = sel => opts(Object.entries(IN_STATES).sort((a, b) => a[0] === '99' ? 1 : b[0] === '99' ? -1 : a[1].localeCompare(b[1])), sel, 'Select state');
const telHref = n => 'tel:' + String(n || '').replace(/[^\d+]/g, '');
const waHref = n => { let d = String(n || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d; return 'https://wa.me/' + d; };

/** Full tabbed form for a client or vendor. quick = short form (name, GSTIN, one contact) with a link to all details. */
function partyForm(kind, id, { quick = false, cb = null, tab = 'company', preset = {} } = {}) {
  const old = id ? api.get('parties', id) : null;
  if (old) normalizeParty(old);
  const v = old ? JSON.parse(JSON.stringify(old)) : { kind, name: '', gstin: '', gstType: kind === 'client' ? 'intra' : 'none', stateCode: '', pan: '', address: '', pincode: '', creditDays: kind === 'client' ? 30 : '', contacts: [blankContact()], bank: kind === 'vendor' ? { accName: '', bankName: '', accNo: '', ifsc: '', upi: '' } : null, notes: '', active: true, ...preset };
  if (!v.contacts || !v.contacts.length) v.contacts = [blankContact()];
  if (kind === 'vendor' && !v.bank) v.bank = { accName: '', bankName: '', accNo: '', ifsc: '', upi: '' };
  const F = { tab, quick, errs: {}, gstAuto: !old };
  const L = kind === 'client' ? 'client' : 'vendor';
  const ov = openModal(`<div class="modal-h"><h2>${old ? 'Edit' : 'Add'} ${L}</h2><span class="muted" style="font-size:12.5px" id="pfName">${old ? esc(old.name) : ''}</span><span class="spacer"></span><button class="icon-btn" data-p="close">${icon('x')}</button></div>
    <div id="pfTabs"></div><div class="modal-b" id="pfBody"></div>
    <div class="modal-f"><span class="muted" style="font-size:12px;margin-right:auto" id="pfFootNote"></span><button class="btn" data-p="close">Cancel</button><button class="btn btn-gold" data-p="save">${old ? 'Save' : 'Add ' + L}</button></div>`, 'pf');
  const body = $('#pfBody', ov), tabsEl = $('#pfTabs', ov);
  const f = (k, label, inner, cls = '', hint = '') => `<div class="field ${cls} ${F.errs[k] ? 'has-err' : ''}"><label>${label}</label>${inner}${F.errs[k] ? `<div class="err">${esc(F.errs[k])}</div>` : hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  const inp = (k, val, attrs = '') => `<input class="input" data-p-f="${k}" value="${esc(val ?? '')}" ${attrs}>`;
  const gi = () => gstinInfo(v.gstin);
  const contactCard = (c, i) => `<div class="pf-person" data-i="${i}">
      <div class="pf-p-head"><span class="pf-avatar">${esc((c.name || c.email || '?').trim().charAt(0).toUpperCase() || '?')}</span><b>${esc(c.name || 'Person ' + (i + 1))}</b>${v.contacts.length > 1 ? `<button type="button" class="icon-btn" data-p="rm-person" data-i="${i}" title="Remove">${icon('trash')}</button>` : ''}</div>
      <div class="fgrid c2">
        ${f('c' + i + 'name', 'Name', inp(`contacts.${i}.name`, c.name, 'placeholder="e.g. Sunita Rao"'))}${f('c' + i + 'des', 'Designation', inp(`contacts.${i}.designation`, c.designation, 'placeholder="e.g. Accounts Payable"'))}
        ${f('c' + i + 'email', 'Email', inp(`contacts.${i}.email`, c.email, 'type="email" placeholder="name@company.com"'))}${f('c' + i + 'phone', 'Phone', inp(`contacts.${i}.phone`, c.phone, 'type="tel" placeholder="98xxx xxxxx"'))}
      </div>
      <div class="pf-tags"><span class="muted" style="font-size:12px">Receives</span>${Object.entries(CONTACT_TAGS).map(([t, l]) => `<label class="pf-tag ${(c.tags || []).includes(t) ? 'on' : ''}" title="${esc(CONTACT_TAG_HINT[t])}"><input type="checkbox" data-p-tag="${i}" value="${t}" ${(c.tags || []).includes(t) ? 'checked' : ''}>${l}</label>`).join('')}
        <label class="check" style="font-size:12.5px;margin-left:auto"><input type="checkbox" data-p-f="contacts.${i}.whatsapp" ${c.whatsapp ? 'checked' : ''}> On WhatsApp</label></div>
    </div>`;
  const gstHint = () => { const g = gi(); return g ? (g.valid ? `✓ ${esc(IN_STATES[g.stateCode] || '')} · PAN ${esc(g.pan)}` : '<span class="out">A GSTIN has 15 characters, e.g. 27ABCDE1234F1Z5</span>') : 'State and PAN fill in from the GSTIN'; };
  const stateHint = () => v.stateCode ? `GST on ${L === 'client' ? 'invoices' : 'bills'}: <b>${esc(GST_TYPES[gstTypeForState(v.stateCode)])}</b>` : '';
  const company = () => { const g = gi();
    return `<div class="fgrid c2">
      ${f('name', L === 'client' ? 'Client name *' : 'Vendor name *', inp('name', v.name, 'placeholder="Registered business name"'), 'span3')}
      ${F.errs.gstin ? f('gstin', 'GSTIN', inp('gstin', v.gstin, 'style="text-transform:uppercase" maxlength="15"')) : `<div class="field"><label>GSTIN</label>${inp('gstin', v.gstin, 'placeholder="27ABCDE1234F1Z5" style="text-transform:uppercase" maxlength="15"')}<div class="hint" id="pfGstHint">${gstHint()}</div></div>`}
      <div class="field"><label>State</label><select class="select" data-p-f="stateCode">${stateOptions(v.stateCode)}</select><div class="hint" id="pfStateHint">${stateHint()}</div></div>
      ${f('address', 'Billing address', `<textarea class="textarea" data-p-f="address" rows="2" placeholder="Building, street, area, city">${esc(v.address || '')}</textarea>`, 'span3')}
      ${f('pincode', 'PIN code', inp('pincode', v.pincode, 'inputmode="numeric" maxlength="6"'))}
    </div>`; };
  const people = () => `<div class="pf-help">${icon('info')}<span>Tag who receives what. <b>Accounts</b> people get payment advices, receipts and PIs; <b>Projects</b> are copied on PIs and receipts; <b>Management</b> on PIs. The email is filled in for you at entry time.</span></div>
      <div class="pf-people">${v.contacts.map(contactCard).join('')}</div>
      <button type="button" class="btn btn-sm" data-p="add-person">${icon('plus')} Add person</button>`;
  const tax = () => `<div class="fsec"><div class="fsec-h">Tax</div><div class="fgrid c2">
      ${f('pan', 'PAN', inp('pan', v.pan, 'style="text-transform:uppercase" maxlength="10" placeholder="ABCDE1234F"'), '', gi() && gi().pan && gi().pan === v.pan ? 'From GSTIN' : '')}
      ${kind === 'client' ? f('tan', 'TAN (their TDS account no.)', inp('tan', v.tan, 'style="text-transform:uppercase" maxlength="10" placeholder="MUMN12345A"'), '', 'Matches their TDS in your Form 26AS') : ''}
      ${f('gstType', 'Default GST type', `<select class="select" data-p-f="gstType">${opts(Object.entries(GST_TYPES), v.gstType)}</select>`, '', F.gstAuto && v.stateCode ? 'Set from the state' : '')}
    </div></div>
    <div class="fsec"><div class="fsec-h">Payment terms</div><div class="fgrid c2">
      ${f('creditDays', 'Credit period (days)', inp('creditDays', v.creditDays, 'type="number" min="0" step="1" placeholder="e.g. 30"'), '', L === 'client' ? 'PI due date = PI date + these days' : 'Shown when you record a payment to them')}
    </div></div>
    ${kind === 'vendor' ? `<div class="fsec"><div class="fsec-h">Bank details <span class="faint" style="text-transform:none;letter-spacing:0;font-weight:400">shown when paying them, and in the payment advice</span></div><div class="fgrid c2">
      ${f('bank.accName', 'Account holder name', inp('bank.accName', v.bank.accName, `placeholder="${esc(v.name || 'As per bank')}"`))}${f('bank.bankName', 'Bank', inp('bank.bankName', v.bank.bankName, 'placeholder="e.g. HDFC Bank"'))}
      ${f('bank.accNo', 'Account number', inp('bank.accNo', v.bank.accNo, 'inputmode="numeric"'))}${f('bank.ifsc', 'IFSC', inp('bank.ifsc', v.bank.ifsc, 'style="text-transform:uppercase" maxlength="11" placeholder="HDFC0001234"'))}
      ${f('bank.upi', 'UPI ID', inp('bank.upi', v.bank.upi, 'placeholder="name@bank"'))}
    </div></div>` : ''}
    ${f('notes', 'Notes', `<textarea class="textarea" data-p-f="notes" rows="2">${esc(v.notes || '')}</textarea>`)}`;
  const quickBody = () => { const c = v.contacts[0]; const g = gi();
    return `<div class="fgrid c2">${f('name', L === 'client' ? 'Client name *' : 'Vendor name *', inp('name', v.name), 'span3')}
      <div class="field"><label>GSTIN</label>${inp('gstin', v.gstin, 'style="text-transform:uppercase" maxlength="15"')}<div class="hint" id="pfGstHint">${g ? gstHint() : 'Optional · fills the state'}</div></div>
      ${f('stateCode', 'State', `<select class="select" data-p-f="stateCode">${stateOptions(v.stateCode)}</select>`)}
      <div class="span3 fsec-h" style="margin:6px 0 0">Main contact · ${L === 'client' ? 'accounts' : 'billing'}</div>
      ${f('c0name', 'Name', inp('contacts.0.name', c.name))}${f('c0email', 'Email', inp('contacts.0.email', c.email, 'type="email"'))}${f('c0phone', 'Phone', inp('contacts.0.phone', c.phone, 'type="tel"'))}
      </div><button type="button" class="ef-link" data-p="full" style="margin-top:12px">${icon('plus').replace('<svg', '<svg style="width:13px;height:13px"')} Add more people, address, ${kind === 'vendor' ? 'bank details, ' : ''}credit terms</button>`; };
  const draw = () => {
    tabsEl.innerHTML = F.quick ? '' : `<div class="pf-tabs">${PF_TABS.map(([k, l]) => `<button type="button" class="${F.tab === k ? 'on' : ''}" data-p="tab" data-v="${k}">${l}${k === 'people' ? ` <span class="tw-n">${v.contacts.filter(c => c.name || c.email || c.phone).length}</span>` : ''}${tabErr(k) ? ' <span class="pf-dot"></span>' : ''}</button>`).join('')}</div>`;
    body.innerHTML = F.quick ? quickBody() : F.tab === 'company' ? company() : F.tab === 'people' ? people() : tax();
    footNote();
  };
  const footNote = () => {
    const badge = $('.pf-tabs [data-v=people] .tw-n', ov); if (badge) badge.textContent = v.contacts.filter(c => c.name || c.email || c.phone).length;
    const r = emailRoute(v, kind === 'client' ? 'pi_issued' : 'vendor_payment');
    $('#pfFootNote', ov).innerHTML = r.to.length ? `${icon('mail').replace('<svg', '<svg style="width:13px;height:13px;vertical-align:-2px;display:inline-block"')} Emails go to ${esc(r.to.join(', '))}${r.cc.length ? ` · cc ${r.cc.length}` : ''}` : '<span class="out">No email yet — add one so payment emails can go out</span>';
  };
  const tabErr = k => Object.keys(F.errs).some(e => (k === 'company' ? ['name', 'gstin', 'stateCode'] : k === 'people' ? [] : ['pan', 'tan', 'bank.ifsc', 'creditDays']).includes(e) || (k === 'people' && /^c\d/.test(e)));
  const setPath = (path, val) => { const ks = path.split('.'); let o = v; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = val; };
  const onChange = (k, val, live) => {
    if (k === 'gstin') { val = String(val).toUpperCase().trim(); setPath(k, val); const g = gstinInfo(val); if (g && g.valid) { if (g.stateCode) v.stateCode = g.stateCode; if (!v.pan || v.pan === (gstinInfo(old && old.gstin) || {}).pan) v.pan = g.pan; if (F.gstAuto || !old) v.gstType = gstTypeForState(v.stateCode) || v.gstType; }
      delete F.errs.gstin; const h = $('#pfGstHint', body); if (h) h.innerHTML = val ? gstHint() : 'State and PAN fill in from the GSTIN'; const st = $('[data-p-f=stateCode]', body); if (st) st.value = v.stateCode || ''; const sh = $('#pfStateHint', body); if (sh) sh.innerHTML = stateHint(); return; }
    if (k === 'stateCode') { v.stateCode = val; if (F.gstAuto || !old) v.gstType = gstTypeForState(val) || v.gstType; const sh = $('#pfStateHint', body); if (sh) sh.innerHTML = stateHint(); return; }
    if (k === 'gstType') { v.gstType = val; F.gstAuto = false; return draw(); }
    if (/^contacts\.\d+\.whatsapp$/.test(k)) { setPath(k, !!val); return; }
    if (k === 'creditDays') val = val === '' ? '' : +val;
    if (['pan', 'bank.ifsc', 'tan'].includes(k)) val = String(val).toUpperCase();
    setPath(k, val);
    if (k === 'name') $('#pfName', ov).textContent = val;
    const m = k.match(/^contacts\.(\d+)\.(name|email)$/);
    if (m) { const i = +m[1], c = v.contacts[i], card = $(`.pf-person[data-i="${i}"]`, body); if (card) { $('.pf-p-head b', card).textContent = c.name || 'Person ' + (i + 1); $('.pf-avatar', card).textContent = (c.name || c.email || '?').trim().charAt(0).toUpperCase() || '?'; } footNote(); }
  };
  const _unused = () => { const a = document.activeElement, k = a && a.dataset && a.dataset.pF, pos = a && a.selectionStart; draw(); if (k) { const el = $(`[data-p-f="${k}"]`, body); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } } };
  body.addEventListener('input', ev => { const el = ev.target.closest('[data-p-f]'); if (!el || el.tagName === 'SELECT' || el.type === 'checkbox') return; onChange(el.dataset.pF, el.value, true); });
  body.addEventListener('change', ev => {
    const t = ev.target;
    if (t.dataset.pTag != null) { const c = v.contacts[+t.dataset.pTag]; c.tags = t.checked ? [...new Set([...(c.tags || []), t.value])] : (c.tags || []).filter(x => x !== t.value); t.closest('.pf-tag').classList.toggle('on', t.checked); footNote(); return; }
    const el = t.closest('[data-p-f]'); if (!el) return;
    if (el.type === 'checkbox') return onChange(el.dataset.pF, el.checked);
    if (el.tagName === 'SELECT') return onChange(el.dataset.pF, el.value);
    onChange(el.dataset.pF, el.value, false);
  });
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-p]'); if (!b) return; const a = b.dataset.p;
    if (a === 'close') return ov.remove();
    if (a === 'tab') { F.tab = b.dataset.v; return draw(); }
    if (a === 'full') { F.quick = false; F.tab = 'people'; return draw(); }
    if (a === 'add-person') { v.contacts.push(blankContact(v.contacts.some(c => (c.tags || []).includes('accounts')) ? ['projects'] : ['accounts'])); draw(); const cards = $$('.pf-person', body); const last = cards[cards.length - 1]; if (last) { last.scrollIntoView({ block: 'nearest' }); $('input', last).focus(); } return; }
    if (a === 'rm-person') { v.contacts.splice(+b.dataset.i, 1); return draw(); }
    if (a === 'save') {
      const errs = {};
      v.name = String(v.name || '').trim(); if (!v.name) errs.name = 'Name is required';
      if (v.gstin) { const g = gstinInfo(v.gstin); if (!g.valid) errs.gstin = 'GSTIN should be 15 characters, e.g. 27ABCDE1234F1Z5'; }
      if (v.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.pan)) errs.pan = 'PAN should look like ABCDE1234F';
      if (v.tan && !/^[A-Z]{4}[0-9]{5}[A-Z]$/.test(v.tan)) errs.tan = 'TAN should look like MUMN12345A';
      if (v.bank && v.bank.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.bank.ifsc)) errs['bank.ifsc'] = 'IFSC is 11 characters, e.g. HDFC0001234';
      v.contacts.forEach((c, i) => { c.email = String(c.email || '').trim(); if (c.email && !validEmail(c.email)) errs['c' + i + 'email'] = 'Not a valid email'; });
      if (Object.keys(errs).length) { F.errs = errs; const first = Object.keys(errs)[0]; F.tab = /^c\d/.test(first) ? 'people' : ['pan', 'tan', 'bank.ifsc'].includes(first) ? 'tax' : 'company'; draw(); return toast(Object.values(errs)[0], 'error'); }
      const contacts = v.contacts.filter(c => c.name || c.email || c.phone).map(c => ({ ...c, name: String(c.name || '').trim(), designation: String(c.designation || '').trim(), phone: String(c.phone || '').trim(), tags: c.tags || [] }));
      
      // Crucial validation: Ensure at least one contact has an email and receives_accounts is enabled
      if (kind === 'client') {
        const hasAccountsEmail = contacts.some(c => c.email && validEmail(c.email) && (c.tags || []).includes('accounts'));
        if (!hasAccountsEmail) {
          F.errs['accounts_email'] = 'No email yet — add one so payment emails can go out';
          F.tab = 'people';
          draw();
          return toast('No email yet — add one so payment emails can go out', 'error');
        }
      }

      const rec = { kind, name: v.name, gstin: String(v.gstin || '').toUpperCase(), gstType: v.gstType, stateCode: v.stateCode || '', pan: v.pan || '', address: v.address || '', pincode: v.pincode || '', creditDays: v.creditDays === '' || v.creditDays == null ? null : +v.creditDays,
        tan: kind === 'client' ? (v.tan || '') : '', contacts, bank: kind === 'vendor' && v.bank && Object.values(v.bank).some(Boolean) ? { ...v.bank } : null, notes: v.notes || '',
        email: [...new Set(contacts.map(c => c.email).filter(Boolean))].join(', '), phone: (contacts.find(c => c.phone) || {}).phone || '' };
      try {
        b.disabled = true;

        // Step 1 & 2: Save to Supabase fss_client and fss_client_people if available
        if (kind === 'client' && typeof (window as any).__supabaseSaveClient === 'function') {
          try {
            const sbRes = await (window as any).__supabaseSaveClient(rec, contacts, {
              pan: v.pan,
              tan: v.tan,
              default_gst_type: GST_TYPES[v.gstType] || v.gstType || 'CGST + SGST',
              credit_period: v.creditDays,
              notes: v.notes,
              bank_account_name: v.bank?.accName,
              bank_account_number: v.bank?.accNo,
              bank_ifsc: v.bank?.ifsc,
              bank_name: v.bank?.bankName
            });
            if (sbRes?.client?.id) {
              rec.id = sbRes.client.id;
            }
          } catch (sbErr: any) {
            console.error('Supabase save error:', sbErr);
            throw new Error(`Supabase error: ${sbErr.message || sbErr}`);
          }
        }

        let saved;
        if (old) { api.guard('party.edit'); saved = await api.update('parties', id, rec); toast('Saved ' + rec.name); }
        else { api.guard('party.create'); if (api.list('parties').some(p => p.kind === kind && p.name.trim().toLowerCase() === rec.name.toLowerCase() && p.id !== rec.id)) throw new Error('A ' + L + ' with this name already exists'); saved = await api.create('parties', { ...rec, departmentId: null, designation: '', monthlySalary: null, joinDate: null, active: true }); toast('Added ' + rec.name); }
        ov.remove();
        if (cb) cb(saved || api.get('parties', id)); else render({ keepScroll: true });
      } catch (err) { b.disabled = false; toast(err.message, 'error'); }
    }
  });
  draw();
  setTimeout(() => { const el = $('[data-p-f=name]', body); if (el && !old) el.focus(); }, 50);
}

/** Read-only directory card for a client / vendor. */
function openParty(id) {
  const p = api.get('parties', id); if (!p) return; normalizeParty(p);
  const isC = p.kind === 'client', es = Calc.live().filter(e => e.partyId === id);
  const [fyF, fyT] = fyRange(S.fy); const fyEs = es.filter(e => e.date >= fyF && e.date <= fyT);
  const sumT = (list, t) => sum(list.filter(e => e.type === t), e => e.amount);
  const last = es.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  const contacts = partyContacts(p);
  const unpaid = isC ? api.list('pis').filter(x => x.clientId === id && x.status !== 'cancelled').map(x => Sales.piState(x).outstanding).reduce((a, b) => a + b, 0) : 0;
  const head = `<div class="drawer-h"><div class="type-ic ${isC ? 'inflow' : 'outflow'}">${icon(isC ? 'in' : 'out')}</div><div style="flex:1;min-width:0"><div style="font:600 17px var(--f-head)">${esc(p.name)}</div><div class="muted" style="font-size:12.5px">${isC ? 'Client' : 'Vendor'}${p.stateCode ? ' · ' + esc(IN_STATES[p.stateCode] || '') : ''}${p.active ? '' : ' · Inactive'}</div></div><button class="icon-btn" data-act="close-drawer">${icon('x')}</button></div>`;
  const pc = c => `<div class="pd-person"><span class="pf-avatar">${esc((c.name || c.email || '?').charAt(0).toUpperCase())}</span><div class="grow" style="min-width:0"><div class="t">${esc(c.name || c.email || c.phone)}</div><div class="s">${esc(c.designation || '')}${(c.tags || []).map(t => `<span class="pd-tag">${CONTACT_TAGS[t]}</span>`).join('')}</div>
      <div class="s" style="margin-top:3px">${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}${c.email && c.phone ? ' · ' : ''}${c.phone ? `<span class="mono">${esc(c.phone)}</span>` : ''}</div></div>
      <div class="pd-acts">${c.email ? `<a class="icon-btn" href="mailto:${esc(c.email)}" title="Email">${icon('mail')}</a>` : ''}${c.phone ? `<a class="icon-btn" href="${telHref(c.phone)}" title="Call">${icon('phone')}</a>` : ''}${c.phone && c.whatsapp ? `<a class="icon-btn" href="${waHref(c.phone)}" target="_blank" rel="noopener" title="WhatsApp">${icon('chat')}</a>` : ''}</div></div>`;
  const b = p.bank;
  const body = `<div class="mini-kpis"><div><span>${isC ? 'Received' : 'Paid'} · ${esc(fyLabel(S.fy))}</span><b class="${isC ? 'in' : 'out'}">${money(sumT(fyEs, isC ? 'inflow' : 'outflow'))}</b></div><div><span>All time</span><b>${money(sumT(es, isC ? 'inflow' : 'outflow'))}</b></div>${isC ? `<div><span>Unpaid PIs</span><b class="${unpaid ? 'out' : ''}">${money(unpaid)}</b></div>` : `<div><span>Last paid</span><b>${last ? fmtDate(last.date) : '—'}</b></div>`}<div><span>Credit</span><b>${p.creditDays != null && p.creditDays !== '' ? p.creditDays + ' days' : '—'}</b></div></div>
    <div class="fsec-h" style="margin-top:20px">People (${contacts.length})</div>${contacts.map(pc).join('') || '<div class="muted" style="font-size:13px">No contacts yet.</div>'}
    <div class="fsec-h" style="margin-top:20px">Company</div><dl class="kv">${kvRow('GSTIN', p.gstin ? `<span class="mono">${esc(p.gstin)}</span>` : '')}${kvRow('PAN', p.pan ? `<span class="mono">${esc(p.pan)}</span>` : '')}${kvRow('GST on ' + (isC ? 'invoices' : 'bills'), esc(GST_TYPES[p.gstType] || ''))}${kvRow('Address', esc([p.address, p.pincode].filter(Boolean).join(' – ')))}${kvRow('Notes', esc(p.notes || ''))}</dl>
    ${!isC ? `<div class="fsec-h" style="margin-top:20px">Bank details</div>${b && (b.accNo || b.upi) ? `<div class="pd-bank">${[['Account name', b.accName || p.name], ['Bank', b.bankName], ['Account no.', b.accNo], ['IFSC', b.ifsc], ['UPI', b.upi]].filter(x => x[1]).map(([k, val]) => `<div><span>${k}</span><b class="${/Account no|IFSC|UPI/.test(k) ? 'mono' : ''}">${esc(val)}</b><button class="icon-btn" title="Copy" data-act="copy" data-v="${esc(val)}">${icon('copy')}</button></div>`).join('')}</div>` : '<div class="muted" style="font-size:13px">No bank details saved.</div>'}` : ''}
    <div class="fsec-h" style="margin-top:20px">Recent entries (${es.length})</div>${es.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map(entryListRow).join('') || '<div class="muted" style="font-size:13px">No entries yet.</div>'}`;
  const foot = `${api.can('entry.create') ? `<button class="btn btn-gold" data-act="party-entry" data-id="${p.id}">${icon(isC ? 'in' : 'out')} ${isC ? 'Record receipt' : 'Record payment'}</button>` : ''}${api.can('party.edit') ? `<button class="btn" data-act="party-edit" data-id="${p.id}">${icon('edit')} Edit</button>` : ''}${isC && api.list('pis').some(x => x.clientId === p.id && x.status !== 'cancelled' && Sales.piState(x).outstanding > 0) ? `<button class="btn" data-act="soa" data-id="${p.id}">Statement</button>` : ''}<span class="spacer"></span>${es.length ? `<a class="btn btn-sm" href="#/ledger" data-act="party-ledger" data-id="${p.id}">All entries</a>` : ''}`;
  drawerShell(head, body, foot);
}
Object.assign(ACT, {
  'open-party': el => openParty(el.dataset.id),
  'party-edit': el => { const p = api.get('parties', el.dataset.id); closeDrawer(); partyForm(p.kind, p.id, { cb: () => { render({ keepScroll: true }); openParty(p.id); } }); },
  'party-entry': el => { const p = api.get('parties', el.dataset.id); closeDrawer(); openEntryForm({ kind: p.kind === 'client' ? 'client' : 'vendor', preset: { type: p.kind === 'client' ? 'inflow' : 'outflow', partyId: p.id, partyKind: p.kind } }); },
  'party-ledger': el => { closeDrawer(); if (S.ledger) { S.ledger.partyId = el.dataset.id; } location.hash = '#/ledger'; render(); },
  'copy': el => { try { navigator.clipboard.writeText(el.dataset.v); toast('Copied'); } catch (e) { toast('Copy not available here', 'error'); } },
});
/* ============================ BANK STATEMENT IMPORT & RECONCILIATION ============================ */
/* Data: bankImports {id, accountId, fileName, layout, from, to, count, dupes, closing}
         bankLines   {id, importId, accountId, date, narration, ref, debit, credit, balance, hash, status: open|matched|ignored, entryId, how: auto|manual|created|recurring|pi}
         settings.bankMaps[accountId] = column map; settings.bankRules = [{key, partyId}] learned from confirmed lines.
   BACKEND: POST /api/bank/import (file) returns parsed lines; matching can stay in the client or move to the server. */
IC.upload = '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>';
IC.link = '<path d="M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07l1.5-1.5"/>';
IC.bolt = '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>';
S.bank = { acc: '', tab: 'review' };
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

/* ---------- reading files ---------- */
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/).slice(0, 15).join('\n');
  const delim = [',', '\t', ';', '|'].map(d => [d, (first.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(x => String(x).trim()));
}
function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; sc.onload = () => res(); sc.onerror = () => rej(new Error('Could not load the Excel reader (needs internet). Save the statement as CSV and try again.')); document.head.appendChild(sc); });
}
async function readSheetRows(file) {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    await loadXLSX();
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }).map(r => r.map(x => typeof x === 'number' ? x : String(x).trim()));
  }
  if (/\.pdf$/i.test(file.name)) throw new Error('PDF statements are not supported. Download the statement as Excel or CSV from net banking.');
  return parseCSV(await file.text());
}

/* ---------- column detection ---------- */
const BANK_FIELDS = [['date', 'Date *'], ['narration', 'Narration / description *'], ['ref', 'Cheque / ref no.'], ['debit', 'Withdrawal (debit)'], ['credit', 'Deposit (credit)'], ['amount', 'Amount (single column)'], ['drcr', 'Dr / Cr indicator'], ['balance', 'Balance']];
const COL_RX = {
  date: /^(txn\.?|tran\.?|transaction|posting|value)?\s*date$|^date$|^txn date|^transaction date|^tran date/,
  narration: /narration|description|particulars|remarks|details/,
  ref: /chq|cheque|ref|utr/,
  debit: /withdraw|debit|dr\.? amount|paid out|^dr$/,
  credit: /deposit|credit|cr\.? amount|paid in|^cr$/,
  amount: /^amount|^txn amount|^transaction amount/,
  drcr: /^(dr\s*\/\s*cr|cr\s*\/\s*dr|type|dr\/cr)$/,
  balance: /balance/,
};
function detectLayout(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i].map(c => String(c).toLowerCase().replace(/\s+/g, ' ').trim());
    if (cells.filter(Boolean).length < 3) continue;
    const map = {};
    cells.forEach((c, idx) => {
      if (!c) return;
      for (const f of ['balance', 'narration', 'ref', 'debit', 'credit', 'drcr', 'amount', 'date']) {
        if (map[f] != null) continue;
        if (f === 'date' && /value/.test(c) && cells.some(x => /^(txn |tran |transaction |posting )?date$|^date$/.test(x) && x !== c)) continue;
        if (COL_RX[f].test(c) && !(f === 'ref' && /date/.test(c)) && !(f === 'narration' && /amount/.test(c))) { map[f] = idx; break; }
      }
    });
    if (map.date != null && map.narration != null && ((map.debit != null && map.credit != null) || map.amount != null)) {
      const h = cells.join('|');
      const bank = /narration/.test(h) && /withdrawal amt/.test(h) ? 'HDFC Bank' : /transaction remarks/.test(h) ? 'ICICI Bank' : 'Detected columns';
      return { headerRow: i, map, bank, sig: cells.filter(Boolean).join('|') };
    }
  }
  return null;
}
const MON3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseBankDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  m = s.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2,4})/); if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; if (+m[2] >= 1 && +m[2] <= 12 && +m[1] <= 31) return `${y}-${pad2(+m[2])}-${pad2(+m[1])}`; }
  m = s.match(/^(\d{1,2})[\-\/ ]([A-Za-z]{3})[A-Za-z]*[\-\/ ,]+(\d{2,4})/); if (m) { const mo = MON3.indexOf(m[2].toLowerCase()); const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; if (mo >= 0) return `${y}-${pad2(mo + 1)}-${pad2(+m[1])}`; }
  return null;
}
function parseBankAmt(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[₹,\s]|INR|Rs\.?/gi, ''); if (!s || s === '-') return null;
  let sign = 1; if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/dr$/i.test(s)) { sign = -1; s = s.slice(0, -2); } else if (/cr$/i.test(s)) s = s.slice(0, -2);
  const n = parseFloat(s); return isNaN(n) ? null : sign * n;
}
function extractLines(rows, L) {
  const m = L.map, out = [];
  for (let i = L.headerRow + 1; i < rows.length; i++) {
    const r = rows[i]; const date = parseBankDate(r[m.date]); if (!date) continue;
    const narration = String(r[m.narration] ?? '').replace(/\s+/g, ' ').trim();
    let debit = 0, credit = 0;
    if (m.debit != null && m.credit != null) { debit = Math.abs(parseBankAmt(r[m.debit]) || 0); credit = Math.abs(parseBankAmt(r[m.credit]) || 0); }
    else { const a = parseBankAmt(r[m.amount]); if (a == null) continue; const t = m.drcr != null ? String(r[m.drcr]).toLowerCase() : ''; if (/^d/.test(t) || (!t && a < 0)) debit = Math.abs(a); else credit = Math.abs(a); }
    if (!debit && !credit) continue;
    const bal = m.balance != null ? parseBankAmt(r[m.balance]) : null;
    out.push({ date, narration, ref: m.ref != null ? String(r[m.ref] ?? '').trim().replace(/^0+$/, '') : '', debit: r2(debit), credit: r2(credit), balance: bal });
  }
  return out;
}
const lineHash = (acc, l) => [acc, l.date, l.debit, l.credit, l.narration.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60), l.ref].join('|');

/* ---------- import flow ---------- */
async function importStatement(file, accountId) {
  if (!api.can('bank.import')) return toast('Not allowed for your role', 'error');
  let rows; try { rows = await readSheetRows(file); } catch (err) { return toast(err.message, 'error'); }
  if (!rows.length) return toast('That file is empty', 'error');
  featureSettings();
  const saved = Store.data.settings.bankMaps[accountId];
  let L = detectLayout(rows);
  if (!L && saved) L = { ...saved, headerRow: findHeader(rows, saved) };
  if (!L || L.headerRow < 0) return mapColumns(rows, accountId, file.name);
  previewImport(rows, L, accountId, file.name);
}
function findHeader(rows, saved) { for (let i = 0; i < Math.min(rows.length, 40); i++) if (rows[i].map(c => String(c).toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean).join('|') === saved.sig) return i; return saved.headerRow ?? -1; }
function mapColumns(rows, accountId, fileName) {
  const width = Math.max(...rows.slice(0, 40).map(r => r.length));
  const M = { headerRow: 0, map: {} };
  const ov = openModal(`<div class="modal-h"><h2>Match the columns</h2><span class="muted" style="font-size:12.5px">${esc(fileName)}</span></div><div class="modal-b" id="bmBody"></div>
    <div class="modal-f"><button class="btn" data-b="no">Cancel</button><button class="btn btn-gold" data-b="yes">Continue</button></div>`, 'xl');
  const body = $('#bmBody', ov);
  const draw = () => {
    const hdr = rows[M.headerRow] || [];
    const colOpts = sel => '<option value="">—</option>' + Array.from({ length: width }, (_, i) => `<option value="${i}"${+sel === i && sel !== '' && sel != null ? ' selected' : ''}>${esc(String(hdr[i] || 'Column ' + (i + 1)).slice(0, 40))}</option>`).join('');
    body.innerHTML = `<div class="notice info" style="margin-bottom:14px">${icon('info')}<div>The app couldn't recognise this layout. Pick the header row and tell it which column is which. It remembers this for <b>${esc(nameOf('accounts', accountId))}</b>.</div></div>
      <div class="fgrid c4"><div class="field span2"><label>Header row</label><select class="select" data-bm="headerRow">${rows.slice(0, 40).map((r, i) => `<option value="${i}"${i === M.headerRow ? ' selected' : ''}>Row ${i + 1}: ${esc(r.filter(Boolean).slice(0, 5).join(' · ').slice(0, 70))}</option>`).join('')}</select></div>
      ${BANK_FIELDS.map(([k, l]) => `<div class="field"><label>${l}</label><select class="select" data-bm="${k}">${colOpts(M.map[k])}</select></div>`).join('')}</div>
      <div class="hint" style="margin:6px 0 14px">Use either Withdrawal + Deposit columns, or one Amount column (with a Dr/Cr column, or negative numbers for withdrawals).</div>
      <div class="tbl-wrap" style="max-height:260px;border:1px solid var(--line);border-radius:10px"><table class="tbl" style="font-size:12px"><tbody>${rows.slice(M.headerRow, M.headerRow + 8).map((r, i) => `<tr style="${i === 0 ? 'font-weight:600;background:var(--surface-2)' : ''}">${Array.from({ length: width }, (_, c) => `<td style="white-space:nowrap">${esc(String(r[c] ?? '').slice(0, 30))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  };
  draw();
  body.addEventListener('change', ev => { const el = ev.target.closest('[data-bm]'); if (!el) return; if (el.dataset.bm === 'headerRow') M.headerRow = +el.value; else if (el.value === '') delete M.map[el.dataset.bm]; else M.map[el.dataset.bm] = +el.value; draw(); });
  ov.addEventListener('click', ev => {
    const b = ev.target.closest('[data-b]'); if (!b) return;
    if (b.dataset.b === 'no') return ov.remove();
    const m = M.map; if (m.date == null || m.narration == null || !((m.debit != null && m.credit != null) || m.amount != null)) return toast('Pick Date, Narration and either Withdrawal + Deposit or Amount', 'error');
    const L = { headerRow: M.headerRow, map: { ...m }, bank: 'Custom layout', sig: (rows[M.headerRow] || []).map(c => String(c).toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean).join('|') };
    if (!extractLines(rows, L).length) return toast('No rows with a valid date and amount under that header — check the columns', 'error');
    ov.remove(); previewImport(rows, L, accountId, fileName);
  });
}
function previewImport(rows, L, accountId, fileName) {
  const lines = extractLines(rows, L);
  if (!lines.length) return toast('No transactions found in this file', 'error');
  const existing = new Set(Store.data.bankLines.filter(x => x.accountId === accountId && !x.deleted).map(x => x.hash));
  const fresh = [], seen = new Set(); let dupes = 0;
  for (const l of lines) { const h = lineHash(accountId, l); if (existing.has(h) || seen.has(h)) { dupes++; continue; } seen.add(h); fresh.push({ ...l, hash: h }); }
  const dates = lines.map(l => l.date).sort(); const from = dates[0], to = dates[dates.length - 1];
  const withBal = lines.filter(l => l.balance != null); const closing = withBal.length ? (lines[0].date <= lines[lines.length - 1].date ? withBal[withBal.length - 1] : withBal[0]).balance : null;
  const dr = sum(fresh, l => l.debit), cr = sum(fresh, l => l.credit);
  const ov = openModal(`<div class="modal-h"><h2>Import statement</h2></div><div class="modal-b">
    <div class="bk-prev"><div><span>Account</span><b>${esc(nameOf('accounts', accountId))}</b></div><div><span>File</span><b>${esc(fileName)}</b><em>${esc(L.bank)}</em></div><div><span>Period</span><b>${fmtDate(from)} – ${fmtDate(to)}</b></div>
    <div><span>New lines</span><b>${fresh.length}</b>${dupes ? `<em>${dupes} already imported, skipped</em>` : ''}</div><div><span>Withdrawals</span><b class="out">${money(dr)}</b></div><div><span>Deposits</span><b class="in">${money(cr)}</b></div>${closing != null ? `<div><span>Closing balance</span><b>${money(closing)}</b></div>` : ''}</div>
    ${fresh.length ? '<div class="hint" style="margin-top:12px">After import the app matches each line to your entries. Nothing is added to the books until you confirm it.</div>' : '<div class="notice" style="margin-top:12px">Every line in this file is already imported.</div>'}</div>
    <div class="modal-f"><button class="btn" data-b="no">Cancel</button>${fresh.length ? `<button class="btn btn-gold" data-b="yes">Import ${fresh.length} lines</button>` : ''}</div>`, 'sm');
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-b]'); if (!b) return; if (b.dataset.b === 'no') return ov.remove();
    b.disabled = true;
    featureSettings();
    if (L.bank === 'Custom layout') Store.data.settings.bankMaps[accountId] = { map: L.map, sig: L.sig, headerRow: L.headerRow, bank: L.bank };
    const imp = { id: uid('bi'), accountId, fileName, layout: L.bank, from, to, count: fresh.length, dupes, closing, closingDate: to, createdBy: api.me().id, createdAt: nowISO() };
    Store.data.bankImports.push(imp);
    fresh.forEach(l => Store.data.bankLines.push({ id: uid('bl'), importId: imp.id, accountId, ...l, status: 'open', entryId: null, how: null }));
    api.log('create', 'bankImports', imp.id, `Imported ${fresh.length} lines · ${nameOf('accounts', accountId)} · ${fmtDate(from)}–${fmtDate(to)}`);
    const n = autoMatch(accountId);
    Store.persist(); ov.remove();
    S.bank.acc = accountId; S.bank.tab = 'review';
    if (S.page !== 'bank') location.hash = '#/bank'; else render();
    toast(`Imported ${fresh.length} lines · ${n} matched automatically`);
  });
}

/* ---------- matching ---------- */
const BANK_NOISE = new Set('neft rtgs imps upi ach nach dr cr inb ib mb netbank net bank tpt trf transfer to from by ref chq cheque clg clearing ft fund pos atm int mum mumbai pvt ltd limited private india the and of for payment pay paid hdfc icici sbi axis kotak bank a c ac acct account no utr txn self mob mobile online inr rs'.split(' '));
const normTxt = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokensOf = s => normTxt(s).split(' ').filter(t => t.length >= 3 && !/^\d+$/.test(t) && !BANK_NOISE.has(t));
const lineDir = l => l.debit > 0 ? 'out' : 'in';
const lineAmt = l => l.debit || l.credit;
const lineEntry = l => { const e = l.entryId ? api.get('entries', l.entryId) : null; return e && !e.deleted ? e : null; };
const lineStatus = l => l.status === 'ignored' ? 'ignored' : lineEntry(l) ? 'matched' : 'open';
function entryFitsLine(e, l) {
  const acc = l.accountId, d = lineDir(l);
  if (d === 'out' && !((e.type === 'outflow' || e.type === 'transfer') && e.accountId === acc)) return false;
  if (d === 'in' && !((e.type === 'inflow' && e.accountId === acc) || (e.type === 'transfer' && e.toAccountId === acc))) return false;
  return Math.abs(e.amount - lineAmt(l)) < 1 && Math.abs(diffDays(e.date, l.date)) <= 7;
}
function partyTokens(p) { return tokensOf(p.name).filter(t => t.length >= 4); }
function scoreEntry(e, l) {
  const txt = normTxt(l.narration + ' ' + l.ref); let sc = 100 - 6 * Math.abs(diffDays(e.date, l.date));
  const refDigits = String(e.txnRef || '').replace(/\D/g, ''); if (refDigits.length >= 6 && txt.replace(/\s/g, '').includes(refDigits.slice(-8))) sc += 45;
  const p = api.get('parties', e.partyId); if (p && partyTokens(p).some(t => txt.includes(t))) sc += 25;
  return sc;
}
/** Entries already linked on this account's statement (a transfer can be linked once on each account). */
function usedEntryIds(acc, exceptLine) { return new Set(Store.data.bankLines.filter(x => !x.deleted && x.accountId === acc && x !== exceptLine && x.status !== 'ignored' && x.entryId).map(x => x.entryId)); }
function entryCandidates(l, used) {
  used = used || usedEntryIds(l.accountId, l);
  return Calc.live().filter(e => !used.has(e.id) && entryFitsLine(e, l)).map(e => ({ e, score: scoreEntry(e, l) })).sort((a, b) => b.score - a.score);
}
/** Link every line that has one clear match. Returns how many were linked. */
function autoMatch(accountId) {
  const used = usedEntryIds(accountId, null); let n = 0;
  const open = Store.data.bankLines.filter(l => !l.deleted && l.accountId === accountId && lineStatus(l) === 'open').sort((a, b) => a.date.localeCompare(b.date));
  for (const l of open) {
    const c = entryCandidates(l, used);
    if (c.length && c[0].score >= 70 && (c.length === 1 || c[0].score - c[1].score >= 25)) { l.entryId = c[0].e.id; l.status = 'matched'; l.how = 'auto'; l.matchedAt = nowISO(); used.add(c[0].e.id); n++; }
  }
  if (n) Store.persist();
  return n;
}
function ruleFor(l) {
  const txt = ' ' + normTxt(l.narration) + ' ';
  return (Store.data.settings.bankRules || []).find(r => r.key.split(' ').every(k => txt.includes(' ' + k + ' ')));
}
function learnRule(l, partyId) {
  const p = api.get('parties', partyId); if (!p) return;
  const txt = normTxt(l.narration);
  if (partyTokens(p).some(t => txt.includes(t))) return; // name is already in the narration
  const toks = tokensOf(l.narration).filter(t => !/^[a-z]{4}0[a-z0-9]{6}$/.test(t)).slice(0, 2); if (!toks.length) return;
  const key = toks.join(' ');
  const rules = Store.data.settings.bankRules; const ex = rules.find(r => r.key === key);
  if (ex) ex.partyId = partyId; else rules.push({ key, partyId, createdAt: nowISO() });
}
function guessParty(l) {
  const r = ruleFor(l); if (r && api.get('parties', r.partyId)) return { p: api.get('parties', r.partyId), why: 'learned from "' + r.key + '"' };
  const txt = normTxt(l.narration); const d = lineDir(l);
  const kinds = d === 'out' ? ['vendor', 'employee', 'other'] : ['client', 'other'];
  let best = null;
  for (const p of api.list('parties').filter(p => p.active && kinds.includes(p.kind))) {
    const toks = partyTokens(p); if (!toks.length) continue;
    const hit = toks.filter(t => txt.includes(t)).length; if (!hit) continue;
    const sc = hit / toks.length + (txt.includes(toks[0]) ? 0.5 : 0);
    if (!best || sc > best.sc) best = { p, sc };
  }
  return best && best.sc >= 0.5 ? { p: best.p, why: 'name in narration' } : null;
}
const MODE_RX = [['UPI', /\bupi\b/i], ['IMPS', /\bimps\b/i], ['RTGS', /\brtgs\b/i], ['NEFT', /\bneft\b/i], ['Cheque', /\bchq\b|cheque|\bclg\b/i], ['Auto-debit', /\bach\b|\bnach\b|\bsi\b|auto ?debit|ecs/i], ['Card', /\bpos\b|card/i]];
const modeOf = l => (MODE_RX.find(([, rx]) => rx.test(l.narration)) || ['NEFT'])[0];
const refOf = l => { const m = (l.narration + ' ' + l.ref).match(/\b([A-Z]{0,5}\d{8,22})\b/); return l.ref || (m ? m[1] : ''); };
/** Everything the app can propose for an unmatched line, best first. */
function suggestionsFor(l) {
  const out = [], amt = lineAmt(l), d = lineDir(l);
  entryCandidates(l).slice(0, 3).forEach(({ e, score }) => out.push({ t: 'entry', conf: score >= 70 ? 'high' : 'med', label: 'Match ' + entryTitle(e), sub: `${fmtDate(e.date)} · ${money(e.amount)}${e.txnRef ? ' · ' + e.txnRef : ''}`, entryId: e.id }));
  // recurring items not yet confirmed
  const pend = Calc.pendingRecurring(addDays(l.date, 12)).filter(p => p.rec.accountId === l.accountId && (p.rec.type === 'outflow') === (d === 'out') && Math.abs(diffDays(p.dueDate, l.date)) <= 12);
  pend.map(p => ({ p, diff: Math.abs(p.net - amt) })).filter(x => x.diff < 1 || (x.p.rec.variable && x.diff <= Math.max(500, x.p.net * 0.35))).sort((a, b) => a.diff - b.diff).slice(0, 2)
    .forEach(({ p, diff }) => out.push({ t: 'recurring', conf: diff < 1 ? 'high' : 'med', label: 'Confirm ' + p.rec.name + ' · ' + monthLabel(p.period, true), sub: diff < 1 ? 'Amount matches the template' : `Template ${money(p.net)} · bank ${money(amt)} (variable bill)`, recId: p.rec.id, period: p.period, dueDate: p.dueDate }));
  // client receipt against an unpaid PI
  if (d === 'in') {
    const g = guessParty(l);
    api.list('pis').filter(p => p.status !== 'cancelled').map(p => ({ p, st: Sales.piState(p) })).filter(x => x.st.outstanding > 0).forEach(({ p, st }) => {
      const tax = st.outstandingTaxable || p.taxable, expNet = r2(tax * (1 + (+p.gstRate || 0) / 100 - (+p.tdsRate || 0) / 100));
      const nameHit = g && g.p.id === p.clientId;
      if (Math.abs(expNet - amt) < 1 || (nameHit && amt < expNet)) out.push({ t: 'pi', conf: Math.abs(expNet - amt) < 1 ? 'high' : 'med', label: 'Receipt against ' + p.piNo.split('/').slice(-2).join('/') + ' · ' + nameOf('parties', p.clientId), sub: Math.abs(expNet - amt) < 1 ? `Expected ${money(expNet)} after TDS — exact` : `Part payment of ${money(expNet)} expected`, piId: p.id, exact: Math.abs(expNet - amt) < 1 });
    });
  }
  // transfer between own accounts
  const txt = normTxt(l.narration);
  const other = api.list('accounts').find(a => a.id !== l.accountId && a.active && a.number && txt.includes(String(a.number).replace(/\D/g, '')));
  if (other || /\bsweep|\bown a ?c|\bself\b|fd booking|fixed deposit|\bto fd\b/.test(txt)) {
    const o = other || api.list('accounts').find(a => a.id !== l.accountId && (/fd|fixed/i.test(a.name + a.type) ? /fd|fixed/.test(txt) : true));
    if (o) out.push({ t: 'transfer', conf: other ? 'high' : 'med', label: (d === 'out' ? 'Transfer to ' : 'Transfer from ') + o.name, sub: 'Between your own accounts', otherId: o.id });
  }
  // a known party: quick add from their last entry, or open the form
  const g = guessParty(l);
  if (g) {
    const kind = g.p.kind === 'client' ? 'client' : g.p.kind === 'vendor' ? 'vendor' : g.p.kind === 'employee' ? 'employee' : (d === 'out' ? 'other_out' : 'other_in');
    const last = lastEntry(e => e.partyId === g.p.id && e.type === (d === 'out' ? 'outflow' : 'inflow'));
    if (last && kind !== 'client') out.push({ t: 'quick', conf: g.why.startsWith('learned') ? 'high' : 'med', label: `Add as ${nameOf('categories', last.categoryId)} · ${g.p.name}`, sub: `Same as ${fmtDate(last.date)}: ${nameOf('departments', last.departmentId)}${+last.gstRate ? ' · GST ' + last.gstRate + '%' : ''}${+last.tdsRate ? ' · TDS ' + last.tdsRate + '%' : ''} · ${g.why}`, partyId: g.p.id, lastId: last.id, kind });
    out.push({ t: 'draft', conf: 'low', label: `New ${KIND[kind].label.toLowerCase()} entry · ${g.p.name}`, sub: 'Opens the form with the party and amount filled', partyId: g.p.id, kind });
  }
  // bank charges / interest
  if (d === 'out' && /charge|chgs|\bfee\b|sms|annual|gst on|commission|chrg/.test(txt)) {
    const bp = api.list('parties').find(p => p.kind === 'other' && /bank/i.test(p.name)); const last = lastEntry(e => e.categoryId === 'cat_bank');
    out.push({ t: 'quick', conf: 'high', label: 'Add as Bank Charges', sub: 'Looks like a bank fee', partyId: bp ? bp.id : (last ? last.partyId : ''), lastId: last ? last.id : null, kind: 'other_out', categoryId: 'cat_bank' });
  }
  if (d === 'in' && /\bint\b|interest|int pd|int\.? cr/.test(txt)) {
    const last = lastEntry(e => e.categoryId === 'cat_fdint');
    out.push({ t: 'quick', conf: 'med', label: 'Add as Interest income', sub: 'Looks like bank / FD interest', partyId: last ? last.partyId : '', lastId: last ? last.id : null, kind: 'other_in', categoryId: 'cat_fdint' });
  }
  if (!out.length) out.push({ t: 'draft', conf: 'low', label: d === 'out' ? 'Not recognised — record a payment' : 'Not recognised — record a receipt', sub: 'Pick what it was; date, amount and reference are filled', kind: null });
  return out;
}

/* ---------- actions ---------- */
async function linkLine(l, entryId, how) { l.entryId = entryId; l.status = 'matched'; l.how = how; l.matchedAt = nowISO(); l.matchedBy = api.me().id; const e = api.get('entries', entryId); if (e && e.partyId && ['manual', 'created', 'quick'].includes(how)) learnRule(l, e.partyId); api.log('update', 'bankLines', l.id, `Bank line ${fmtDate(l.date)} ${money(lineAmt(l))} matched to ${e ? describe('entries', e) : entryId}`); Store.persist(); }
async function quickCreate(l, sg) {
  const last = sg.lastId ? api.get('entries', sg.lastId) : null, d = lineDir(l), amt = lineAmt(l);
  const gr = last ? +last.gstRate || 0 : 0, tr = last ? +last.tdsRate || 0 : 0;
  const taxable = taxableForNet(amt, gr, tr);
  const input = { type: d === 'out' ? 'outflow' : 'inflow', date: l.date, categoryId: sg.categoryId || (last && last.categoryId) || '', departmentId: (last && last.departmentId) || (api.get('parties', sg.partyId) || {}).departmentId || 'dep_fin', partyId: sg.partyId || '', projectId: '', description: last ? last.description : (sg.categoryId === 'cat_bank' ? 'Bank charges' : ''), refNo: '', taxable, gstType: gr ? last.gstType : 'none', gstRate: gr, gstAmount: r2(taxable * gr / 100), itc: last ? last.itc : false, tdsRate: tr, tdsAmount: r2(taxable * tr / 100), amount: amt, paymentMode: modeOf(l), accountId: l.accountId, txnRef: refOf(l), notes: 'From bank statement: ' + l.narration, attachments: [] };
  { const diff = r2(amt - (input.taxable + input.gstAmount - input.tdsAmount)); if (diff && Math.abs(diff) <= 0.05 && gr) input.gstAmount = r2(input.gstAmount + diff); }
  const errs = api.validateEntry(api.normaliseEntry(input));
  if (Object.keys(errs).length) { openFromLine(l, sg); return null; }
  const saved = await api.saveEntry(input, null); await linkLine(l, saved.id, 'quick'); return saved;
}
function openFromLine(l, sg) {
  const d = lineDir(l), amt = lineAmt(l);
  const kind = sg && sg.kind ? sg.kind : null;
  const preset = { type: d === 'out' ? 'outflow' : 'inflow', date: l.date, accountId: l.accountId, txnRef: refOf(l), paymentMode: modeOf(l), netAmount: amt };
  if (sg && sg.partyId) { preset.partyId = sg.partyId; preset.partyKind = (api.get('parties', sg.partyId) || {}).kind; }
  const note = `From bank: <b>${fmtDate(l.date)}</b> · ${money(amt)} ${d === 'out' ? 'paid' : 'received'} · <span class="mono" style="font-size:12px">${esc(l.narration.slice(0, 90))}</span>`;
  openEntryForm({ kind, preset, note, onSaved: async saved => { if (Math.abs(saved.amount - amt) >= 1) toast(`Saved, but the net amount ${money(saved.amount)} differs from the bank ${money(amt)} — not linked`, 'error'); else { await linkLine(l, saved.id, 'created'); toast('Entry saved and matched to the bank line'); } } });
}
async function applySuggestion(l, sg) {
  if (sg.t === 'entry') { await linkLine(l, sg.entryId, 'manual'); toast('Matched'); return; }
  if (sg.t === 'quick') { const s2 = await quickCreate(l, sg); if (s2) toast('Added ' + money(s2.amount) + ' and matched'); return; }
  if (sg.t === 'recurring') {
    const rec = api.get('recurring', sg.recId); const amt = lineAmt(l);
    const taxable = taxableForNet(amt, rec.gstRate, rec.tdsRate);
    const e = entryFromRecurring(rec, sg.period, l.date, taxable); e.txnRef = refOf(l) || e.txnRef; e.paymentMode = modeOf(l) || e.paymentMode;
    const saved = await api.saveEntry(e, null); await linkLine(l, saved.id, 'recurring'); toast('Confirmed ' + rec.name + ' and matched'); return;
  }
  if (sg.t === 'pi') {
    const pi = api.get('pis', sg.piId);
    if (sg.exact) {
      const st = Sales.piState(pi); const o = Sales.orderOfPI(pi); const tax = st.outstandingTaxable || pi.taxable;
      const input = { piId: pi.id, type: 'inflow', date: l.date, categoryId: catForPI(pi), departmentId: o ? o.departmentId : 'dep_design', partyId: pi.clientId, projectId: pi.projectId || '', description: pi.milestone, refNo: pi.taxInvoiceNo || pi.piNo, taxable: tax, gstType: pi.gstType, gstRate: pi.gstRate, gstAmount: r2(tax * pi.gstRate / 100), itc: false, tdsRate: pi.tdsRate, tdsAmount: r2(tax * pi.tdsRate / 100), paymentMode: modeOf(l), accountId: l.accountId, txnRef: refOf(l), notes: '', attachments: [] };
      input.amount = r2(input.taxable + input.gstAmount - input.tdsAmount);
      const saved = await api.saveEntry(input, null); await linkLine(l, saved.id, 'pi'); toast('Receipt recorded against ' + pi.piNo + ' and matched'); return;
    }
    const note = `From bank: <b>${fmtDate(l.date)}</b> · ${money(lineAmt(l))} received · part payment against ${esc(pi.piNo)}`;
    const o = Sales.orderOfPI(pi), amt = lineAmt(l);
    openEntryForm({ preset: { type: 'inflow', partyKind: 'client', partyId: pi.clientId, projectId: pi.projectId, piId: pi.id, categoryId: catForPI(pi), departmentId: o ? o.departmentId : '', gstRate: pi.gstRate, gstType: pi.gstType, tdsRate: pi.tdsRate, refNo: pi.taxInvoiceNo || pi.piNo, description: pi.milestone, date: l.date, accountId: l.accountId, txnRef: refOf(l), paymentMode: modeOf(l), netAmount: amt }, note, onSaved: async saved => { await linkLine(l, saved.id, 'created'); } });
    return;
  }
  if (sg.t === 'transfer') {
    const d = lineDir(l), amt = lineAmt(l);
    const input = { type: 'transfer', date: l.date, amount: amt, taxable: amt, accountId: d === 'out' ? l.accountId : sg.otherId, toAccountId: d === 'out' ? sg.otherId : l.accountId, paymentMode: modeOf(l), txnRef: refOf(l), description: 'Transfer · from bank statement', notes: '', attachments: [] };
    const saved = await api.saveEntry(input, null); await linkLine(l, saved.id, 'created'); toast('Transfer recorded and matched'); return;
  }
  if (sg.t === 'draft') openFromLine(l, sg);
}

/* ---------- page ---------- */
function bankAccounts() { return api.list('accounts').filter(a => a.type === 'bank' && a.active); }
function bankData(acc) {
  const lines = Store.data.bankLines.filter(l => !l.deleted && l.accountId === acc);
  const imps = Store.data.bankImports.filter(i => !i.deleted && i.accountId === acc).sort((a, b) => a.to.localeCompare(b.to));
  const st = { open: [], matched: [], ignored: [] }; lines.forEach(l => st[lineStatus(l)].push(l));
  const from = lines.length ? lines.reduce((m, l) => l.date < m ? l.date : m, lines[0].date) : null, to = lines.length ? lines.reduce((m, l) => l.date > m ? l.date : m, lines[0].date) : null;
  const linked = new Set(lines.filter(l => lineStatus(l) === 'matched').map(l => l.entryId));
  const notInBank = from ? Calc.live().filter(e => e.date >= from && e.date <= to && !linked.has(e.id) && e.paymentMode !== 'Cash' && ((e.type !== 'transfer' && e.accountId === acc) || (e.type === 'transfer' && (e.accountId === acc || e.toAccountId === acc)))).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const last = imps[imps.length - 1];
  const closing = last && last.closing != null ? { amt: last.closing, date: last.closingDate } : null;
  const book = closing ? Calc.balance(acc, closing.date) : null;
  return { lines, imps, st, from, to, notInBank, closing, book };
}
PAGES.bank = {
  title: 'Bank reconciliation',
  render() {
    featureSettings();
    const accs = bankAccounts(); if (!accs.length) return `<div class="card"><div class="empty"><b>No bank accounts</b>Add one in Masters › Bank accounts.</div></div>`;
    if (!accs.some(a => a.id === S.bank.acc)) S.bank.acc = accs[0].id;
    const acc = S.bank.acc, D = bankData(acc), can = api.can('bank.match');
    const pctM = D.lines.length ? Math.round(100 * D.st.matched.length / Math.max(1, D.lines.length - D.st.ignored.length)) : 0;
    const diff = D.closing ? r2(D.closing.amt - D.book) : null;
    const openNet = sum(D.st.open, l => l.credit - l.debit), nibNet = sum(D.notInBank, e => e.type === 'inflow' || (e.type === 'transfer' && e.toAccountId === acc) ? e.amount : -e.amount);
    const unexpl = diff == null ? null : r2(diff - openNet + nibNet);
    const head = `<div class="bk-bar"><div class="seg">${accs.map(a => `<button class="${a.id === acc ? 'on' : ''}" data-act="bk-acc" data-id="${a.id}">${esc(a.name)}<span class="faint"> ${esc(a.number || '')}</span>${Store.data.bankLines.some(l => !l.deleted && l.accountId === a.id && lineStatus(l) === 'open') ? ` <span class="tw-n">${Store.data.bankLines.filter(l => !l.deleted && l.accountId === a.id && lineStatus(l) === 'open').length}</span>` : ''}</button>`).join('')}</div>
      <span class="spacer"></span>${api.can('bank.import') ? `<button class="btn btn-sm" data-act="bk-sample">${icon('bolt')} Try a sample statement</button><label class="btn btn-gold">${icon('upload')} Import statement<input type="file" id="bkFile" accept=".csv,.xls,.xlsx,.txt" style="display:none"></label>` : ''}</div>`;
    if (!D.lines.length) return head + `<div class="card"><div class="empty" style="padding:44px 20px"><b>No statement imported for ${esc(nameOf('accounts', acc))}</b>
      Download the account statement from net banking as <b>Excel or CSV</b> and import it here. HDFC and ICICI layouts are recognised automatically; for other banks you match the columns once.<br><br>Each line is matched to your entries. What isn't in the books yet is offered as a ready-made entry: recurring items, receipts against PIs, transfers, bank charges, and parties the app recognises from the narration.</div></div>`;
    const kpis = `<div class="grid g-kpi bk-kpis">
      <div class="card kpi"><div class="k-l">Statement period</div><div class="k-v" style="font-size:15px;white-space:normal;line-height:1.3">${fmtDate(D.from)} –<br>${fmtDate(D.to)}</div><div class="k-s">${D.lines.length} lines · ${D.imps.length} import${D.imps.length > 1 ? 's' : ''}</div></div>
      <div class="card kpi"><div class="k-l">Matched</div><div class="k-v in">${pctM}%</div><div class="k-s">${D.st.matched.length} lines</div></div>
      <div class="card kpi ${D.st.open.length ? 'warn' : ''}"><div class="k-l">To review</div><div class="k-v ${D.st.open.length ? 'out' : ''}">${D.st.open.length}</div><div class="k-s">${money(sum(D.st.open, l => l.debit))} out · ${money(sum(D.st.open, l => l.credit))} in</div></div>
      <div class="card kpi"><div class="k-l">In books, not in bank</div><div class="k-v">${D.notInBank.length}</div><div class="k-s">${money(sum(D.notInBank, e => e.amount))}</div></div>
      <div class="card kpi"><div class="k-l">Bank vs books</div><div class="k-v ${diff == null ? '' : Math.abs(diff) < 1 ? 'in' : 'out'}">${diff == null ? '—' : Math.abs(diff) < 1 ? 'Balanced' : money(diff, { sign: true })}</div><div class="k-s">${D.closing ? `Bank ${money(D.closing.amt)} · books ${money(D.book)} on ${fmtDate(D.closing.date)}${Math.abs(diff) >= 1 ? (Math.abs(unexpl) < 1 ? ' · fully explained by the lines below' : ` · <b class="out">${money(unexpl, { sign: true })} unexplained</b>`) : ''}` : 'No balance column in the file'}</div></div></div>`;
    const T = S.bank.tab;
    const tabs = `<div class="tabs" style="margin-top:4px">${[['review', 'To review', D.st.open.length], ['matched', 'Matched', D.st.matched.length], ['notinbank', 'Not in bank', D.notInBank.length], ['ignored', 'Ignored', D.st.ignored.length], ['imports', 'Imports', D.imps.length]].map(([k, l, n]) => `<button class="${T === k ? 'on' : ''}" data-act="bk-tab" data-v="${k}">${l} <span class="tw-n">${n}</span></button>`).join('')}</div>`;
    const amtCell = l => `<span class="num ${l.debit ? 'out' : 'in'}" style="font-weight:600">${l.debit ? '−' + money(l.debit) : '+' + money(l.credit)}</span>`;
    const lineCell = l => `<div class="bk-date">${fmtDate(l.date)}</div><div class="bk-narr" title="${esc(l.narration)}">${esc(l.narration)}</div>${l.ref ? `<div class="bk-ref mono">${esc(l.ref)}</div>` : ''}`;
    let body = '';
    if (T === 'review') {
      const open = D.st.open.slice().sort((a, b) => b.date.localeCompare(a.date));
      const ready = open.map(l => ({ l, sg: suggestionsFor(l) })).map(x => ({ ...x, best: x.sg.find(s => s.conf === 'high' && ['entry', 'recurring', 'quick', 'pi', 'transfer'].includes(s.t) && !(s.t === 'pi' && !s.exact)) }));
      const nReady = ready.filter(x => x.best).length;
      body = `<div class="card"><div class="card-h"><div class="grow"><h3>Lines to review</h3><div class="sub">Newest first. Green suggestions are confident; one click adds or links them.</div></div>
        ${can && nReady ? `<button class="btn btn-sm btn-navy" data-act="bk-accept-all">${icon('check')} Accept ${nReady} confident suggestion${nReady > 1 ? 's' : ''}</button>` : ''}${can ? `<button class="btn btn-sm" data-act="bk-rerun">Re-run matching</button>` : ''}</div>
        ${ready.map(({ l, sg }) => `<div class="bk-row" data-line="${l.id}"><div class="bk-l">${lineCell(l)}</div><div class="bk-a">${amtCell(l)}</div>
          <div class="bk-s">${sg.slice(0, 4).map((s, i) => `<div class="bk-sg ${s.conf}"><div class="grow"><div class="t">${esc(s.label)}</div><div class="s">${esc(s.sub)}</div></div>${can ? `<button class="btn btn-sm ${i === 0 && s.conf !== 'low' ? 'btn-gold' : ''}" data-act="bk-apply" data-id="${l.id}" data-i="${i}">${s.t === 'entry' ? 'Match' : s.t === 'draft' || (s.t === 'pi' && !s.exact) ? 'Review' : 'Add'}</button>` : ''}</div>`).join('')}
          ${can ? `<div class="bk-more"><button class="ef-link" data-act="bk-pick" data-id="${l.id}">${icon('link').replace('<svg', '<svg style="width:13px;height:13px"')} Match to another entry</button><button class="ef-link" data-act="bk-apply" data-id="${l.id}" data-i="draft">New entry</button><button class="ef-link muted" data-act="bk-ignore" data-id="${l.id}">Ignore</button></div>` : ''}</div></div>`).join('') || `<div class="empty"><b>All lines are matched</b>Nothing left to review for this account.</div>`}</div>`;
    } else if (T === 'matched') {
      const rows = D.st.matched.slice().sort((a, b) => b.date.localeCompare(a.date));
      const HOW = { auto: 'Auto', manual: 'Matched', created: 'Added', quick: 'Added', recurring: 'Recurring', pi: 'PI receipt' };
      body = `<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bank line</th><th class="num">Amount</th><th>Entry in books</th><th>How</th><th></th></tr></thead><tbody>
        ${rows.map(l => { const e = lineEntry(l); return `<tr><td style="max-width:340px">${lineCell(l)}</td><td class="num">${amtCell(l)}</td><td><a href="#" data-act="open-entry" data-id="${e.id}">${esc(entryTitle(e))}</a><div class="cell-sub">${fmtDate(e.date)} · ${esc(entryParty(e) || '')}</div></td><td><span class="chip ${l.how === 'auto' ? 'inflow' : ''}">${HOW[l.how] || 'Matched'}</span></td><td>${can ? `<button class="btn btn-sm btn-ghost" data-act="bk-unmatch" data-id="${l.id}">Unmatch</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></div>`;
    } else if (T === 'notinbank') {
      body = `<div class="card"><div class="card-h"><div class="grow"><h3>Recorded in the books but not on the statement</h3><div class="sub">Between ${fmtDate(D.from)} and ${fmtDate(D.to)}. Usually cheques not yet cleared, a wrong account or date, or a duplicate entry.</div></div></div>
        ${D.notInBank.map(e => entryListRow(e)).join('') || '<div class="empty"><b>Nothing missing</b>Every entry in this period is on the statement.</div>'}</div>`;
    } else if (T === 'ignored') {
      body = `<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bank line</th><th class="num">Amount</th><th></th></tr></thead><tbody>${D.st.ignored.map(l => `<tr><td>${lineCell(l)}</td><td class="num">${amtCell(l)}</td><td>${can ? `<button class="btn btn-sm" data-act="bk-unignore" data-id="${l.id}">Restore</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="3"><div class="empty">Nothing ignored.</div></td></tr>'}</tbody></table></div></div>`;
    } else {
      body = `<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>File</th><th>Period</th><th class="num">Lines</th><th>Imported</th><th></th></tr></thead><tbody>${D.imps.slice().reverse().map(i => `<tr><td><div class="cell-main">${esc(i.fileName)}</div><div class="cell-sub">${esc(i.layout)}${i.dupes ? ' · ' + i.dupes + ' duplicates skipped' : ''}</div></td><td>${fmtDate(i.from)} – ${fmtDate(i.to)}</td><td class="num">${i.count}</td><td>${esc(userName(i.createdBy))} · ${fmtDateTime(i.createdAt)}</td><td>${api.can('bank.import') ? `<button class="btn btn-sm btn-ghost" data-act="bk-del-import" data-id="${i.id}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>
        ${(Store.data.settings.bankRules || []).length ? `<div class="card"><div class="card-h"><div class="grow"><h3>Narrations the app has learned</h3><div class="sub">When a narration contains these words, the line is suggested for that party</div></div></div><div class="tbl-wrap"><table class="tbl"><tbody>${Store.data.settings.bankRules.map((r, i) => `<tr><td class="mono">${esc(r.key)}</td><td>${esc(nameOf('parties', r.partyId))}</td><td>${can ? `<button class="btn btn-sm btn-ghost" data-act="bk-del-rule" data-i="${i}">Forget</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
    }
    return `<div class="stack">${head}${kpis}${tabs}${body}</div>`;
  },
};
function pickEntryForLine(l) {
  const amt = lineAmt(l), d = lineDir(l), used = usedEntryIds(l.accountId, l);
  const pool = Calc.live().filter(e => !used.has(e.id) && Math.abs(diffDays(e.date, l.date)) <= 45 && (d === 'out' ? (e.type === 'outflow' || (e.type === 'transfer' && e.accountId === l.accountId)) : (e.type === 'inflow' || (e.type === 'transfer' && e.toAccountId === l.accountId)))).sort((a, b) => Math.abs(a.amount - amt) - Math.abs(b.amount - amt) || Math.abs(diffDays(a.date, l.date)) - Math.abs(diffDays(b.date, l.date))).slice(0, 12);
  const ov = openModal(`<div class="modal-h"><h2>Match to an entry</h2><span class="muted" style="font-size:12.5px">${fmtDate(l.date)} · ${money(amt)}</span></div><div class="modal-b"><div class="hint" style="margin-bottom:10px">Closest amounts within 45 days. If the amount or account differs, edit the entry after matching.</div>
    ${pool.map(e => `<div class="list-row" style="cursor:pointer" data-pick="${e.id}"><div class="type-ic ${e.type}">${icon(e.type === 'inflow' ? 'in' : e.type === 'outflow' ? 'out' : 'transfer')}</div><div class="grow"><div class="t">${esc(entryTitle(e))}</div><div class="s">${fmtDate(e.date)} · ${esc(nameOf('accounts', e.accountId))}${e.accountId !== l.accountId && e.toAccountId !== l.accountId ? ' <span class="out">· other account</span>' : ''}</div></div><div class="num ${Math.abs(e.amount - amt) < 1 ? 'in' : ''}">${money(e.amount)}</div></div>`).join('') || '<div class="empty">No entries nearby.</div>'}</div>
    <div class="modal-f"><button class="btn" data-pick="">Cancel</button></div>`, 'sm');
  ov.addEventListener('click', async ev => { const b = ev.target.closest('[data-pick]'); if (!b) return; ov.remove(); if (!b.dataset.pick) return; await linkLine(l, b.dataset.pick, 'manual'); toast('Matched'); render({ keepScroll: true }); });
}
/** A realistic HDFC-format CSV built from the books: most lines match, plus unrecorded recurring bills, a PI receipt, a transfer and bank charges. */
function sampleStatementCSV(acc) {
  const a = api.get('accounts', acc), from = addDays(TODAY, -40), to = addDays(TODAY, -1);
  const es = Calc.live().filter(e => e.date >= from && e.date <= to && ((e.type !== 'transfer' && e.accountId === acc) || (e.type === 'transfer' && (e.accountId === acc || e.toAccountId === acc))) && e.paymentMode !== 'Cash').sort((x, y) => x.date.localeCompare(y.date));
  const early = es.filter(e => e.type === 'outflow' && e.date <= addDays(to, -6) && !e.recurringId);
  const skip = early.find(e => e.paymentMode === 'Cheque') || early[Math.floor(early.length / 2)];
  const up = s => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 26);
  const rows = [];
  es.forEach((e, i) => {
    if (e === skip) return;
    const out = e.type === 'outflow' || (e.type === 'transfer' && e.accountId === acc);
    const who = e.type === 'transfer' ? (out ? 'TRF TO ' + up(nameOf('accounts', e.toAccountId)) : 'TRF FROM ' + up(nameOf('accounts', e.accountId))) : up(nameOf('parties', e.partyId));
    const md = e.paymentMode, ref = String(e.txnRef || '').replace(/^\D+/, '');
    const narr = md === 'UPI' ? `UPI-${who}-${ref.slice(0, 12)}` : md === 'Auto-debit' ? `ACH D- ${who}-${ref.slice(0, 10)}` : md === 'Cheque' ? `CHQ PAID-${who}` : md === 'IMPS' ? `IMPS-${ref.slice(0, 12)}-${who}` : `${md} ${out ? 'DR' : 'CR'}-${out ? 'ICIC0000104' : 'HDFC0000240'}-${who}-NETBANK, MUM-${e.txnRef || ''}`;
    rows.push({ date: i % 5 === 0 ? addDays(e.date, 1) : e.date, narr, ref: md === 'Cheque' ? String(e.txnRef).replace(/\D/g, '') : '0000' + ref.slice(-12), dr: out ? e.amount : 0, cr: out ? 0 : e.amount });
  });
  Calc.pendingRecurring(to).filter(p => p.rec.accountId === acc && p.dueDate >= from && p.dueDate <= to).slice(0, 3).forEach(p => {
    const amt = p.rec.variable ? r2(p.net * 1.08) : p.net; const pn = api.get('parties', p.rec.partyId);
    rows.push({ date: p.dueDate > to ? to : p.dueDate, narr: p.rec.paymentMode === 'Auto-debit' ? `ACH D- ${up(pn && pn.name).split(' ')[0]} BILLDESK-${rint(1e9, 9e9)}` : `NEFT DR-HDFC0000001-${up(pn && pn.name)}-NETBANK, MUM-N${rint(1e9, 9e9)}${rint(100, 999)}`, ref: '', dr: p.rec.type === 'outflow' ? amt : 0, cr: p.rec.type === 'inflow' ? amt : 0 });
  });
  const pi = api.list('pis').filter(p => p.status !== 'cancelled').map(p => ({ p, st: Sales.piState(p) })).filter(x => x.st.outstanding > 0).sort((x, y) => x.p.dueDate.localeCompare(y.p.dueDate))[0];
  if (pi && ((lastEntry(e => e.partyId === pi.p.clientId && e.type === 'inflow') || {}).accountId || 'acc_hdfc') === acc) { const tax = pi.st.outstandingTaxable || pi.p.taxable; const net = r2(tax * (1 + pi.p.gstRate / 100 - pi.p.tdsRate / 100)); rows.push({ date: addDays(to, -2), narr: `NEFT CR-CITI0000002-${up(nameOf('parties', pi.p.clientId))}-PAYMENT-CITIN${rint(1e7, 9e7)}`, ref: '', dr: 0, cr: net }); }
  rows.push({ date: addDays(to, -6), narr: 'CHRG: NEFT/RTGS CHARGES INCL GST', ref: '', dr: 177, cr: 0 });
  rows.push({ date: addDays(to, -1), narr: 'SMS ALERT CHGS QTR SEP26', ref: '', dr: 17.7, cr: 0 });
  const other = api.list('accounts').find(x => x.id !== acc && x.type === 'bank');
  if (other && acc === 'acc_hdfc') rows.push({ date: addDays(to, -4), narr: `FT - CR - ${String(other.number || '').replace(/\D/g, '')} - IUOVA DESIGN COMPANY SWEEP`, ref: '', dr: 0, cr: 125000 });
  rows.sort((x, y) => x.date.localeCompare(y.date));
  let bal = Calc.balance(acc, addDays(from, -1)); const fmt = d => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;
  const csv = ['HDFC BANK Ltd.,,,,,,', `Account No : XXXXXXXX${String(a.number || '').replace(/\D/g, '')},,,,,,`, `Statement From : ${fmt(from)} To : ${fmt(to)},,,,,,`, ',,,,,,', 'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance'];
  rows.forEach(r => { bal = r2(bal - r.dr + r.cr); csv.push([fmt(r.date), '"' + r.narr + '"', r.ref, fmt(r.date), r.dr ? r.dr.toFixed(2) : '', r.cr ? r.cr.toFixed(2) : '', bal.toFixed(2)].join(',')); });
  csv.push(',,,,,,', 'STATEMENT SUMMARY :-,,,,,,');
  return csv.join('\n');
}
Object.assign(ACT, {
  'bk-acc': el => { S.bank.acc = el.dataset.id; render(); },
  'bk-tab': el => { S.bank.tab = el.dataset.v; render({ keepScroll: true }); },
  'bk-sample': () => { const acc = S.bank.acc || (bankAccounts()[0] || {}).id; const csv = sampleStatementCSV(acc); const f = new File([csv], 'Sample_HDFC_statement_' + TODAY + '.csv', { type: 'text/csv' }); importStatement(f, acc); },
  'bk-apply': async el => {
    const l = Store.data.bankLines.find(x => x.id === el.dataset.id); if (!l) return;
    const sg = el.dataset.i === 'draft' ? { t: 'draft', kind: null } : suggestionsFor(l)[+el.dataset.i];
    if (!sg) return;
    el.disabled = true;
    try { await applySuggestion(l, sg); render({ keepScroll: true }); } catch (err) { toast(err.message, 'error'); el.disabled = false; }
  },
  'bk-accept-all': async () => {
    const acc = S.bank.acc; const open = Store.data.bankLines.filter(l => !l.deleted && l.accountId === acc && lineStatus(l) === 'open');
    const list = open.map(l => ({ l, s: suggestionsFor(l).find(s => s.conf === 'high' && ['entry', 'recurring', 'quick', 'pi', 'transfer'].includes(s.t) && !(s.t === 'pi' && !s.exact)) })).filter(x => x.s);
    if (!list.length) return;
    if (!await confirmBox({ title: `Accept ${list.length} suggestions?`, body: `<div style="max-height:300px;overflow:auto">${list.map(x => `<div class="list-row" style="padding:6px 0"><div class="grow"><div class="t" style="font-size:13px">${esc(x.s.label)}</div><div class="s">${fmtDate(x.l.date)} · ${esc(x.l.narration.slice(0, 60))}</div></div><span class="num">${money(lineAmt(x.l))}</span></div>`).join('')}</div><div class="hint" style="margin-top:8px">Matches link existing entries; the rest add new entries dated as on the statement. Each one can be unmatched later.</div>`, ok: 'Accept all' })) return;
    let n = 0; for (const x of list) { if (lineStatus(x.l) !== 'open') continue; const fresh = suggestionsFor(x.l).find(s => s.t === x.s.t && s.label === x.s.label); if (!fresh) continue; try { if (fresh.t === 'quick') { if (await quickCreate(x.l, fresh)) n++; } else { await applySuggestion(x.l, fresh); n++; } } catch (e) { console.warn(e); } }
    toast(`${n} lines done`); render({ keepScroll: true });
  },
  'bk-rerun': () => { const n = autoMatch(S.bank.acc); toast(n ? n + ' more lines matched' : 'No new clear matches'); render({ keepScroll: true }); },
  'bk-pick': el => { const l = Store.data.bankLines.find(x => x.id === el.dataset.id); if (l) pickEntryForLine(l); },
  'bk-ignore': el => { const l = Store.data.bankLines.find(x => x.id === el.dataset.id); if (!l) return; l.status = 'ignored'; l.entryId = null; api.log('update', 'bankLines', l.id, `Bank line ${fmtDate(l.date)} ${money(lineAmt(l))} ignored`); Store.persist(); render({ keepScroll: true }); },
  'bk-unignore': el => { const l = Store.data.bankLines.find(x => x.id === el.dataset.id); if (!l) return; l.status = 'open'; Store.persist(); render({ keepScroll: true }); },
  'bk-unmatch': el => { const l = Store.data.bankLines.find(x => x.id === el.dataset.id); if (!l) return; l.status = 'open'; l.entryId = null; l.how = null; api.log('update', 'bankLines', l.id, `Bank line ${fmtDate(l.date)} ${money(lineAmt(l))} unmatched`); Store.persist(); toast('Unmatched. The entry stays in the books.'); render({ keepScroll: true }); },
  'bk-del-import': async el => { const imp = Store.data.bankImports.find(i => i.id === el.dataset.id); if (!imp) return; if (!await confirmBox({ title: 'Remove this import?', body: `The ${imp.count} statement lines are removed. Entries you added from them stay in the books.`, ok: 'Remove', danger: true })) return; imp.deleted = true; Store.data.bankLines.forEach(l => { if (l.importId === imp.id) l.deleted = true; }); api.log('delete', 'bankImports', imp.id, 'Removed statement ' + imp.fileName); Store.persist(); render(); },
  'bk-del-rule': el => { Store.data.settings.bankRules.splice(+el.dataset.i, 1); Store.persist(); render({ keepScroll: true }); },
});
document.addEventListener('change', ev => { if (ev.target.id === 'bkFile' && ev.target.files[0]) { const f = ev.target.files[0]; ev.target.value = ''; importStatement(f, S.bank.acc); } });
/** Shown in the entry drawer. */
function bankLineFor(entryId) { return Store.data.bankLines.find(l => !l.deleted && l.entryId === entryId && l.status !== 'ignored'); }
/* ============================ COMPLIANCE CALENDAR ============================ */
/* Statutory dates for a proprietorship with monthly GST returns, payroll TDS and vendor TDS.
   Amounts come from the books; "paid" comes from statutory entries (taxPeriod); "filed" is a tick kept in Store.data.compliance[key].
   BACKEND: GET /api/compliance?fy= returns the same list; POST /api/compliance/:key {done, at, ref}. */
IC.cal = '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>';
S.comp = { view: 'list', range: 'open' };
const COMP_TYPES = {
  tds: ['TDS deposit', 'pay', 'Challan ITNS 281'], gstr1: ['GSTR-1', 'file', 'Outward supplies'], gstr3b: ['GSTR-3B + GST payment', 'both', 'Summary return and tax'],
  pt: ['Professional tax', 'pay', 'Maharashtra PT (employer)'], adv: ['Advance tax', 'pay', 'Income tax instalment'], tdsret24: ['TDS return 24Q', 'file', 'Salaries'], tdsret26: ['TDS return 26Q', 'file', 'Vendors & professionals'],
  f16a: ['Form 16A to vendors', 'file', 'TDS certificates'], gstr9: ['GSTR-9 annual return', 'file', 'GST annual'], audit: ['Tax audit report', 'file', 'Form 3CD, if audit applies'], itr: ['Income tax return', 'file', 'Proprietor, audit case'],
};
const lastDay = ym => ymDate(ym, 31);
const monthsLate = (from, to) => { if (to <= from) return 0; const a = +from.slice(0, 4) * 12 + +from.slice(5, 7), b = +to.slice(0, 4) * 12 + +to.slice(5, 7); return b - a + 1; };
function compMark(key) { return (Store.data.compliance || {})[key] || null; }
function statEntries(cat) { return Calc.live().filter(e => e.categoryId === cat); }
function tdsDeducted(months, salaryOnly) {
  if (typeof tdsMonth === 'function') return r2(sum(months.flatMap(m => tdsMonth(m).rows).filter(r => salaryOnly == null || (r.sec === '192') === salaryOnly), r => r.tds));
  const set = new Set(months), sal = new Set(['cat_sal', 'cat_ceo', 'cat_bonus']);
  return r2(sum(Calc.live().filter(e => e.type === 'outflow' && set.has(ymOf(e.date)) && e.categoryId !== 'cat_tdsdep' && +e.tdsAmount > 0 && (salaryOnly == null || sal.has(e.categoryId) === salaryOnly)), e => e.tdsAmount));
}
function gstNet(ym) { if (typeof gstMonth === 'function') return gstMonth(ym).cash.total; const es = Calc.live().filter(e => ymOf(e.date) === ym); return r2(sum(es.filter(e => e.type === 'inflow'), e => e.gstAmount) - sum(es.filter(e => e.type === 'outflow' && e.itc), e => e.gstAmount)); }
/** All obligations whose period falls between two months, with status and money. */
function complianceItems({ fromYm, toYm } = {}) {
  const cs = featureSettings().compliance, on = cs.items || {};
  const open = Store.data.settings.openingDate || '2025-04-01';
  fromYm = fromYm || ymOf(open); toYm = toYm || addMonths(ymOf(TODAY), 3);
  const out = [], add = o => { if (o.due) out.push(o); };
  const tdsPaid = {}; statEntries('cat_tdsdep').forEach(e => { const p = taxPeriodOf(e); (tdsPaid[p] = tdsPaid[p] || []).push(e); });
  const gstPaid = {}; statEntries('cat_gstpay').forEach(e => { const p = taxPeriodOf(e); (gstPaid[p] = gstPaid[p] || []).push(e); });
  const ptPaid = {}; statEntries('cat_ptax').forEach(e => { const p = e.taxPeriod || ymOf(e.date); (ptPaid[p] = ptPaid[p] || []).push(e); });
  const lastPT = lastEntry(e => e.categoryId === 'cat_ptax');
  const ptRec = api.list('recurring').find(r => r.categoryId === 'cat_ptax' && r.active);
  for (let ym = fromYm; ym <= toYm; ym = addMonths(ym, 1)) {
    const nx = addMonths(ym, 1), ended = lastDay(ym) < TODAY;
    if (on.tds !== false) { const amt = ended || ym === ymOf(TODAY) ? tdsDeducted([ym]) : null; const paid = tdsPaid[ym] || [];
      add({ key: 'tds:' + ym, type: 'tds', period: ym, label: 'TDS deposit · ' + monthLabel(ym, true), due: ym.slice(5) === '03' ? nx + '-30' : ymDate(nx, 7), amount: amt, paid: sum(paid, e => e.amount), entries: paid, taxSub: 'tds' }); }
    if (on.gstr1 !== false && cs.gstFreq === 'monthly') add({ key: 'gstr1:' + ym, type: 'gstr1', period: ym, label: 'GSTR-1 · ' + monthLabel(ym, true), due: ymDate(nx, 11), amount: null });
    if (on.gstr3b !== false && cs.gstFreq === 'monthly') { const net = ended ? gstNet(ym) : null; const paid = gstPaid[ym] || [];
      add({ key: 'gstr3b:' + ym, type: 'gstr3b', period: ym, label: 'GSTR-3B · ' + monthLabel(ym, true), due: ymDate(nx, 20), amount: net == null ? null : Math.max(0, net), credit: net == null ? 0 : typeof gstMonth === 'function' ? totH(gstMonth(ym).carryOut) : net < 0 ? -net : 0, paid: sum(paid, e => e.amount), entries: paid, taxSub: 'gst', file: true }); }
    if (on.pt !== false && cs.ptMonthly) { const paid = ptPaid[ym] || [];
      add({ key: 'pt:' + ym, type: 'pt', period: ym, label: 'Professional tax · ' + monthLabel(ym, true), due: lastDay(ym), amount: ptRec ? ptRec.taxable : lastPT ? lastPT.amount : null, paid: sum(paid, e => e.amount), entries: paid, taxSub: 'pt' }); }
  }
  // quarterly & annual items by FY
  const fy0 = fyOf(fromYm + '-01'), fy1 = fyOf(toYm + '-01');
  for (let fy = fy0; fy <= fy1; fy++) {
    for (let q = 0; q < 4; q++) {
      const ms = quarterMonths(fy, q); if (ms[2] < fromYm || ms[0] > toYm) continue;
      const due = q === 3 ? (fy + 1) + '-05-31' : q === 2 ? (fy + 1) + '-01-31' : fy + (q === 0 ? '-07-31' : '-10-31');
      const qLabel = `${FY_Q(q)} ${fyLabel(fy).replace('FY ', '')}`;
      const sal = tdsDeducted(ms, true), ven = tdsDeducted(ms, false);
      if (on.tdsret !== false) {
        if (sal > 0 || ms[2] >= ymOf(TODAY)) add({ key: 'tdsret24Q:' + fy + 'Q' + (q + 1), type: 'tdsret24', period: ms[2], label: 'TDS return 24Q · ' + qLabel, due, amount: null, tdsBase: sal, file: true });
        if (ven > 0 || ms[2] >= ymOf(TODAY)) add({ key: 'tdsret26Q:' + fy + 'Q' + (q + 1), type: 'tdsret26', period: ms[2], label: 'TDS return 26Q · ' + qLabel, due, amount: null, tdsBase: ven, file: true });
      }
      if (on.f16a !== false && (ven > 0 || ms[2] >= ymOf(TODAY))) add({ key: 'f16a:' + fy + 'Q' + (q + 1), type: 'f16a', period: ms[2], label: 'Form 16A to vendors · ' + qLabel, due: addDays(due, 15), amount: null, tdsBase: ven, file: true });
    }
    if (on.adv !== false) {
      const est = +((cs.advTaxByFy || {})[fy] ?? (fy === fyOf(TODAY) ? cs.advTaxEstimate : 0)) || 0; const paidAll = statEntries('cat_advtax').filter(e => fyOf(e.date) === fy);
      if (!est && fy < fyOf(TODAY)) continue;
      [['06-15', 15], ['09-15', 45], ['12-15', 75], ['03-15', 100]].forEach(([md, cum], i) => {
        const due = (i === 3 ? fy + 1 : fy) + '-' + md; if (ymOf(due) < fromYm || ymOf(due) > toYm) return;
        const paidBy = sum(paidAll.filter(e => e.date <= addDays(due, 3)), e => e.amount), need = est ? r2(est * cum / 100) : null;
        const inst = paidAll.filter(e => e.date <= addDays(due, 3) && e.date > (i ? (i === 3 ? fy + 1 : fy) + '-' + ['06-15', '09-15', '12-15'][i - 1] : fy + '-04-01'));
        add({ key: 'adv:' + fy + ':' + (i + 1), type: 'adv', period: ymOf(due), label: `Advance tax · instalment ${i + 1} (${cum}%) · ${fyLabel(fy)}`, due, amount: need == null ? null : Math.max(0, r2(need - (paidBy - sum(inst, e => e.amount)))), cum: need, paid: sum(inst, e => e.amount), paidToDate: paidBy, entries: inst, taxSub: 'adv', noEstimate: !est });
      });
    }
    if (on.pt !== false && !cs.ptMonthly) { const due = (fy + 1) + '-03-31'; if (ymOf(due) >= fromYm && ymOf(due) <= toYm) { const paid = statEntries('cat_ptax').filter(e => fyOf(e.date) === fy); const per = ptRec ? ptRec.taxable : lastPT ? lastPT.amount : null;
      add({ key: 'pt:' + fy, type: 'pt', period: ymOf(due), label: 'Professional tax · ' + fyLabel(fy), due, amount: per == null ? null : per * 12, paid: sum(paid, e => e.amount), entries: paid, taxSub: 'pt' }); } }
    if (on.gstr9 !== false && cs.gstFreq) { const due = (fy + 1) + '-12-31'; if (ymOf(due) >= fromYm && ymOf(due) <= toYm) add({ key: 'gstr9:' + fy, type: 'gstr9', period: ymOf(due), label: 'GSTR-9 · ' + fyLabel(fy), due, amount: null, file: true }); }
    if (on.itr !== false) {
      [['audit', (fy + 1) + '-09-30', 'Tax audit report · '], ['itr', (fy + 1) + '-10-31', 'Income tax return · ']].forEach(([t, due, l]) => { if (ymOf(due) >= fromYm && ymOf(due) <= toYm) add({ key: t + ':' + fy, type: t, period: ymOf(due), label: l + fyLabel(fy), due, amount: null, file: true }); });
    }
  }
  out.forEach(o => {
    const mk = compMark(o.key); o.mark = mk;
    const payKind = ['tds', 'gstr3b', 'pt', 'adv'].includes(o.type);
    o.balance = payKind && o.amount != null ? Math.max(0, r2(o.amount - (o.paid || 0))) : null;
    const paidOk = !payKind || (o.amount != null && o.balance < 1) || (o.type === 'adv' && o.noEstimate && o.paid > 0);
    const filedOk = !(o.file || COMP_TYPES[o.type][1] === 'file') || !!(mk && mk.done);
    o.needsFile = (o.file || COMP_TYPES[o.type][1] === 'file');
    o.done = (paidOk && filedOk) || !!(mk && mk.done && !payKind) || (payKind && o.amount === 0 && filedOk);
    const days = diffDays(o.due, TODAY);
    o.days = days;
    o.status = o.done ? 'done' : days < 0 ? 'overdue' : days <= 10 ? 'soon' : 'upcoming';
    o.penalty = o.status === 'overdue' ? penaltyFor(o) : null;
  });
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.label.localeCompare(b.label));
}
/** Rough cost of being late if settled today, with the rule used. */
function penaltyFor(o) {
  const late = -o.days;
  if (o.type === 'tds' && o.balance > 0) { const m = monthsLate(o.period + '-01', TODAY); return { amt: Math.round(o.balance * 0.015 * m), rule: `1.5% a month × ${m} months on ${money(o.balance)} (s.201(1A))` }; }
  if (o.type === 'gstr3b') { const intr = o.balance > 0 ? Math.round(o.balance * 0.18 * late / 365) : 0; const fee = (o.mark && o.mark.done) ? 0 : Math.min(late * (o.amount ? 50 : 20), o.amount ? 10000 : 500); return { amt: intr + fee, rule: `${intr ? `18% a year interest ${money(intr)} + ` : ''}late fee ₹${o.amount ? 50 : 20}/day${fee ? ' = ' + money(fee) : ''}` }; }
  if (o.type === 'gstr1') { const fee = Math.min(late * 50, 10000); return { amt: fee, rule: `Late fee ₹50/day (max ₹10,000)` }; }
  if (o.type === 'tdsret24' || o.type === 'tdsret26') { const fee = Math.min(late * 200, o.tdsBase || 0); return { amt: fee, rule: `₹200/day, capped at the TDS of ${money(o.tdsBase || 0)} (s.234E)` }; }
  if (o.type === 'f16a') { const fee = Math.min(late * 100, o.tdsBase || 0); return { amt: fee, rule: '₹100/day per certificate, capped at the TDS (s.272A(2)(g))' }; }
  if (o.type === 'adv' && o.balance > 0) { return { amt: Math.round(o.balance * 0.01 * 3), rule: '1% a month for 3 months on the shortfall (s.234C)' }; }
  if (o.type === 'pt' && o.balance > 0) { const m = monthsLate(o.due, TODAY); return { amt: Math.round(o.balance * 0.0125 * m), rule: '1.25% a month on the unpaid tax' }; }
  if (o.type === 'gstr9') return { amt: Math.min(late * 200, 0.005 * 3e7), rule: '₹200/day, max 0.5% of turnover' };
  if (o.type === 'itr') return { amt: 5000, rule: 'Late fee ₹5,000 (s.234F) + 1%/month interest on unpaid tax' };
  if (o.type === 'audit') return { amt: null, rule: 'Penalty up to ₹1.5 lakh (s.271B)' };
  return null;
}
const COMP_STATUS = { done: ['Done', 'inflow'], overdue: ['Overdue', 'overdue'], soon: ['Due soon', 'gold'], upcoming: ['Upcoming', ''] };
function compRow(o, can) {
  const st = COMP_STATUS[o.status], payKind = o.balance != null || ['tds', 'gstr3b', 'pt', 'adv'].includes(o.type);
  const money1 = o.amount == null ? (o.type === 'adv' && o.noEstimate ? '<span class="muted">Set estimate in Settings</span>' : o.needsFile && !payKind ? '<span class="muted">Filing</span>' : '<span class="faint">After month end</span>') : o.amount === 0 ? `<span class="muted">${o.type === 'gstr3b' && o.credit ? 'Nil · ' + money(o.credit) + ' credit c/f' : 'Nothing to pay'}</span>` : `<b class="num">${money(o.amount)}</b>`;
  const paidTxt = payKind && o.paid ? `<div class="cell-sub">Paid ${money(o.paid)}${o.entries && o.entries.length ? ' · ' + o.entries.map(e => fmtDate(e.date)).join(', ') : ''}${o.balance > 0 ? ` · <span class="out">${money(o.balance)} left</span>` : ''}</div>` : '';
  const filed = o.needsFile ? (o.mark && o.mark.done ? `<div class="cell-sub in">Filed ${fmtDate((o.mark.at || '').slice(0, 10))}${o.mark.ref ? ' · ' + esc(o.mark.ref) : ''}</div>` : o.status !== 'upcoming' || o.days < 30 ? '<div class="cell-sub">Not filed yet</div>' : '') : '';
  const acts = !can ? '' : [
    payKind && o.balance > 0 && o.type !== 'gstr1' ? `<button class="btn btn-sm ${o.status === 'overdue' || o.status === 'soon' ? 'btn-gold' : ''}" data-act="cp-pay" data-key="${o.key}">Record payment</button>` : '',
    o.needsFile && !(o.mark && o.mark.done) ? `<button class="btn btn-sm" data-act="cp-file" data-key="${o.key}">Mark filed</button>` : '',
    o.mark && o.mark.done ? `<button class="btn btn-sm btn-ghost" data-act="cp-unfile" data-key="${o.key}">Undo</button>` : '',
  ].join('');
  return `<div class="cp-row ${o.status}"><div class="cp-date"><b>${fmtDate(o.due).slice(0, 6)}</b><span>${o.status === 'done' ? '' : o.days < 0 ? -o.days + 'd late' : o.days === 0 ? 'today' : 'in ' + o.days + 'd'}</span></div>
    <div class="cp-main"><div class="t">${esc(o.label)} <span class="chip ${st[1]}">${st[0]}</span></div><div class="s">${esc(COMP_TYPES[o.type][2])}</div>${paidTxt}${filed}${o.penalty && o.penalty.amt != null ? `<div class="cp-pen">${icon('alert').replace('<svg', '<svg style="width:13px;height:13px"')} If settled today: about <b>${money(o.penalty.amt)}</b> · ${esc(o.penalty.rule)}</div>` : o.penalty ? `<div class="cp-pen">${esc(o.penalty.rule)}</div>` : ''}</div>
    <div class="cp-amt">${money1}</div><div class="cp-acts">${acts}</div></div>`;
}
PAGES.compliance = {
  title: 'Compliance calendar',
  render() {
    const can = api.can('compliance.mark') || api.can('entry.create');
    const [fyF] = fyRange(S.fy);
    const items = complianceItems({ fromYm: ymOf(Store.data.settings.openingDate || fyF), toYm: addMonths(ymOf(TODAY), 4) });
    const over = items.filter(o => o.status === 'overdue'), soon = items.filter(o => !o.done && o.days >= 0 && o.days <= 30);
    const doneFY = items.filter(o => o.done && fyOf(o.due) === fyOf(TODAY));
    const toPay = sum(soon, o => o.balance || 0) + sum(over, o => o.balance || 0);
    const kpis = `<div class="grid g-kpi cp-kpis">
      <div class="card kpi ${over.length ? 'warn' : ''}"><div class="k-l">Overdue</div><div class="k-v ${over.length ? 'out' : 'in'}">${over.length}</div><div class="k-s">${over.length ? 'About ' + money(sum(over, o => (o.penalty && o.penalty.amt) || 0)) + ' in fees & interest if settled today' : 'Nothing late'}</div></div>
      <div class="card kpi"><div class="k-l">Due in 30 days</div><div class="k-v">${soon.length}</div><div class="k-s">${money(toPay)} to pay incl. overdue</div></div>
      <div class="card kpi"><div class="k-l">Next deadline</div><div class="k-v" style="font-size:18px">${soon[0] ? fmtDate(soon[0].due) : '—'}</div><div class="k-s">${soon[0] ? esc(soon[0].label) : ''}</div></div>
      <div class="card kpi"><div class="k-l">Done · ${esc(fyLabel(fyOf(TODAY)))}</div><div class="k-v in">${doneFY.length}</div><div class="k-s">paid or filed on record</div></div></div>`;
    const V = S.comp.view;
    const tabs = `<div class="row" style="gap:10px;flex-wrap:wrap"><div class="seg">${[['list', 'To do'], ['year', 'Year view'], ['done', 'Done']].map(([k, l]) => `<button class="${V === k ? 'on' : ''}" data-act="cp-view" data-v="${k}">${l}</button>`).join('')}</div><span class="spacer"></span><a class="btn btn-sm" href="#/settings" data-act="cp-settings">${icon('gear')} Compliance settings</a></div>`;
    let body = '';
    if (V === 'list') {
      const list = items.filter(o => !o.done && o.days <= 60);
      const groups = [['Overdue', list.filter(o => o.status === 'overdue')], ['Next 10 days', list.filter(o => o.status === 'soon')], ['Later', list.filter(o => o.status === 'upcoming')]].filter(g => g[1].length);
      body = groups.map(([g, l]) => `<div class="card"><div class="card-h"><h3 class="grow">${g} <span class="tw-n">${l.length}</span></h3></div>${l.map(o => compRow(o, can)).join('')}</div>`).join('') || `<div class="card"><div class="empty"><b>All caught up</b>Nothing due in the next 60 days.</div></div>`;
    } else if (V === 'done') {
      const list = items.filter(o => o.done).reverse().slice(0, 80);
      body = `<div class="card">${list.map(o => compRow(o, can)).join('') || '<div class="empty">Nothing recorded yet.</div>'}</div>`;
    } else {
      const fy = S.fy, months = fyMonths(fy);
      const yi = complianceItems({ fromYm: months[0], toYm: addMonths(months[11], 2) }).filter(o => fyOf(o.period + '-01') === fy || (o.type === 'adv' && o.key.startsWith('adv:' + fy)));
      const rowsT = [['tds', 'TDS deposit'], ['gstr1', 'GSTR-1'], ['gstr3b', 'GSTR-3B'], ['pt', 'Professional tax'], ['adv', 'Advance tax'], ['tdsret24', 'TDS return 24Q'], ['tdsret26', 'TDS return 26Q'], ['f16a', 'Form 16A']];
      const cell = o => { if (!o) return '<td class="cp-cell"></td>'; const st = COMP_STATUS[o.status]; return `<td class="cp-cell"><span class="cp-dot ${o.status}" title="${esc(o.label)} · due ${fmtDate(o.due)} · ${st[0]}${o.amount ? ' · ' + money(o.amount) : ''}">${o.status === 'done' ? icon('check') : ''}</span>${o.amount ? `<div class="cp-mini num">${shortMoney(o.amount)}</div>` : ''}</td>`; };
      body = `<div class="card"><div class="card-h"><div class="grow"><h3>${esc(fyLabel(fy))} at a glance</h3><div class="sub">By the month the obligation is for. Hover a dot for details.</div></div><div class="cp-legend">${Object.entries(COMP_STATUS).map(([k, [l]]) => `<span><i class="cp-dot ${k}"></i>${l}</span>`).join('')}</div></div>
        <div class="tbl-wrap"><table class="tbl cp-year"><thead><tr><th></th>${months.map(m => `<th class="num">${monthLabel(m)}</th>`).join('')}</tr></thead><tbody>
        ${rowsT.map(([t, l]) => `<tr><td class="cell-main">${l}</td>${months.map(m => cell(yi.find(o => o.type === t && o.period === m))).join('')}</tr>`).join('')}</tbody></table></div></div>`;
    }
    return `<div class="stack">${kpis}${tabs}${body}<div class="muted" style="font-size:12px">Amounts come from your entries: TDS deducted on payments, GST collected less input credit, PT from the recurring template. Penalties are estimates from the statutory rates; check exact amounts on the portal. Dates follow monthly GST filing; change it in Settings.</div></div>`;
  },
};
const shortMoney = n => n >= 1e7 ? (n / 1e7).toFixed(1) + 'Cr' : n >= 1e5 ? (n / 1e5).toFixed(1) + 'L' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : Math.round(n);
function compByKey(key) { const [, p] = key.split(':'); const ym = /^\d{4}-\d{2}$/.test(p) ? p : null; return complianceItems(ym ? { fromYm: ym, toYm: ym } : {}).find(o => o.key === key); }
function markFiled(key) {
  const o = compByKey(key); if (!o) return;
  const ov = openModal(`<div class="modal-h"><h2>Mark as filed</h2></div><div class="modal-b"><div style="font-weight:600;margin-bottom:12px">${esc(o.label)}</div><div class="fgrid c2">
    <div class="field"><label>Filed on</label><input class="input" type="date" id="cpDate" value="${TODAY}"></div><div class="field"><label>ARN / acknowledgement no.</label><input class="input" id="cpRef" placeholder="Optional"></div></div></div>
    <div class="modal-f"><button class="btn" data-x="no">Cancel</button><button class="btn btn-gold" data-x="yes">Mark filed</button></div>`, 'sm');
  ov.addEventListener('click', ev => {
    const b = ev.target.closest('[data-x]'); if (!b) return; if (b.dataset.x === 'no') return ov.remove();
    const d = $('#cpDate', ov).value || TODAY;
    featureSettings(); Store.data.compliance[key] = { done: true, at: d + 'T12:00:00.000Z', by: api.me().id, ref: $('#cpRef', ov).value.trim() };
    api.log('update', 'compliance', key, `${o.label} marked filed on ${fmtDate(d)}`); Store.persist(); ov.remove(); toast('Marked filed'); render({ keepScroll: true });
  });
}
Object.assign(ACT, {
  'cp-view': el => { S.comp.view = el.dataset.v; render({ keepScroll: true }); },
  'cp-settings': () => { location.hash = '#/settings'; setTimeout(() => $('#compSettings')?.scrollIntoView({ block: 'start' }), 200); },
  'cp-file': el => markFiled(el.dataset.key),
  'cp-unfile': el => { const key = el.dataset.key; delete Store.data.compliance[key]; api.log('update', 'compliance', key, 'Filing tick removed for ' + key); Store.persist(); render({ keepScroll: true }); },
  'cp-pay': el => {
    const o = compByKey(el.dataset.key); if (!o) return;
    const note = `Paying <b>${esc(o.label)}</b> · due ${fmtDate(o.due)}${o.balance ? ' · ' + money(o.balance) + ' outstanding' : ''}`;
    openEntryForm({ kind: 'tax', note, preset: { type: 'outflow', taxSub: o.taxSub, taxPeriod: o.type === 'adv' ? null : o.period, amountOverride: o.balance || null } });
  },
});
/** Small dashboard card. */
function complianceCard() {
  const items = complianceItems({ fromYm: addMonths(ymOf(TODAY), -14), toYm: addMonths(ymOf(TODAY), 2) }).filter(o => !o.done && o.days <= 21);
  const over = items.filter(o => o.status === 'overdue');
  return `<div class="card"><div class="card-h"><div class="grow"><h3>Compliance</h3><div class="sub">${over.length ? `<span class="out">${over.length} overdue</span> · ` : ''}next 3 weeks</div></div><a class="btn btn-sm" href="#/compliance">Calendar</a></div>
    ${items.slice(0, 6).map(o => `<div class="list-row"><div class="cp-date sm ${o.status}"><b>${fmtDate(o.due).slice(0, 6)}</b></div><div class="grow"><div class="t">${esc(o.label)}</div><div class="s">${o.days < 0 ? `<span class="out">${-o.days} days late</span>` : o.days === 0 ? 'Due today' : 'In ' + o.days + ' days'}${o.penalty && o.penalty.amt ? ' · ~' + money(o.penalty.amt) + ' if paid today' : ''}</div></div><div class="num">${o.balance ? money(o.balance) : o.needsFile ? '<span class="muted" style="font-size:12px">File</span>' : ''}</div></div>`).join('') || '<div class="empty"><b>Nothing due</b>No statutory deadlines in the next 3 weeks.</div>'}</div>`;
}
function complianceSettingsCard() {
  const cs = featureSettings().compliance, owner = api.can('settings.edit'), dis = owner ? '' : 'disabled';
  const items = [['tds', 'TDS deposit (7th)'], ['gstr1', 'GSTR-1 (11th)'], ['gstr3b', 'GSTR-3B (20th)'], ['pt', 'Professional tax'], ['adv', 'Advance tax'], ['tdsret', 'TDS returns 24Q / 26Q'], ['f16a', 'Form 16A to vendors'], ['gstr9', 'GSTR-9 annual'], ['itr', 'Tax audit & ITR']];
  return `<div class="card" id="compSettings"><div class="card-h"><div class="grow"><h3>Compliance calendar</h3><div class="sub">Which deadlines to track and how</div></div></div><div class="card-b"><form id="cpForm" class="fgrid">
    <div class="field"><label>GST returns</label><select class="select" name="gstFreq" ${dis}>${opts([['monthly', 'Monthly (GSTR-1 11th, GSTR-3B 20th)']], cs.gstFreq)}</select><div class="hint">Quarterly (QRMP) can be added if you switch</div></div>
    <div class="field"><label>Professional tax</label><select class="select" name="ptMonthly" ${dis}>${opts([['1', 'Monthly, by month end'], ['0', 'Annual, by 31 March']], cs.ptMonthly ? '1' : '0')}</select><div class="hint">Monthly if yearly PT is ₹50,000 or more</div></div>
    <div class="field"><label>Estimated income tax for ${esc(fyLabel(fyOf(TODAY)))} (₹)</label><input class="input" name="advTaxEstimate" type="number" step="1000" min="0" value="${cs.advTaxEstimate || ''}" ${dis}><div class="hint">Advance-tax instalments are 15 / 45 / 75 / 100% of this</div></div>
    <div class="field span3"><label>Track</label><div class="row" style="gap:6px 16px;flex-wrap:wrap">${items.map(([k, l]) => `<label class="check"><input type="checkbox" name="it_${k}" ${cs.items[k] !== false ? 'checked' : ''} ${dis}> ${l}</label>`).join('')}</div></div>
    </form>${owner ? '<div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn btn-navy" data-act="cp-save-settings">Save</button></div>' : ''}</div></div>`;
}
ACT['cp-save-settings'] = () => {
  const f = $('#cpForm'), cs = featureSettings().compliance;
  const items = {}; ['tds', 'gstr1', 'gstr3b', 'pt', 'adv', 'tdsret', 'f16a', 'gstr9', 'itr'].forEach(k => items[k] = f['it_' + k].checked);
  Object.assign(cs, { gstFreq: f.gstFreq.value, ptMonthly: f.ptMonthly.value === '1', advTaxEstimate: +f.advTaxEstimate.value || 0, items }); cs.advTaxByFy = Object.assign({}, cs.advTaxByFy, { [fyOf(TODAY)]: +f.advTaxEstimate.value || 0 });
  api.log('update', 'settings', 'compliance', 'Compliance settings updated'); Store.persist(); toast('Compliance settings saved'); render({ keepScroll: true });
};
/* ============================ COLLECTIONS: automatic PI reminders, statements of account ============================ */
/* Reminder schedule (settings.reminders): offsets in days from the PI due date, e.g. -3, 0, 7, 15, then every `repeatDays`
   until paid or `maxReminders` is reached. Each run queues at most one reminder per PI (the latest stage reached) and never
   two within 3 days. Sent reminders are kept on the PI: pi.reminders = [{stage, offset, at, emailId}].
   BACKEND: run runReminders() hourly from a server cron (Asia/Kolkata) so reminders go out with no browser open. */
IC.bell = '<path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/>';
function reminderPlan(pi) {
  const R = featureSettings().reminders, offs = [...new Set((R.offsets || []).map(Number))].sort((a, b) => a - b);
  const plan = offs.map(o => ({ offset: o, date: addDays(pi.dueDate, o) }));
  let last = offs.length ? offs[offs.length - 1] : 0;
  while (R.repeatDays > 0 && plan.length < (R.maxReminders || 8)) { last += +R.repeatDays; plan.push({ offset: last, date: addDays(pi.dueDate, last) }); }
  return plan.slice(0, R.maxReminders || 8).map((p, i) => ({ ...p, stage: i }));
}
function remindersPaused(pi) { const R = featureSettings().reminders; return !!pi.remindersOff || (R.pausedClients || []).includes(pi.clientId); }
/** What would happen for this PI right now: {plan, sent, next, dueNow, reason} */
function reminderState(pi) {
  const st = Sales.piState(pi), plan = reminderPlan(pi), sent = pi.reminders || [];
  const out = { plan, sent, st };
  if (pi.status === 'cancelled' || st.outstanding <= 0) return { ...out, reason: 'paid' };
  if (remindersPaused(pi)) return { ...out, reason: 'paused' };
  const reached = plan.filter(p => p.date <= TODAY && p.date >= pi.date);
  const sentStages = new Set(sent.map(s => s.stage));
  const latest = reached[reached.length - 1];
  out.next = plan.find(p => p.date > TODAY && !sentStages.has(p.stage));
  if (!latest || sentStages.has(latest.stage) || sent.some(s => s.stage > latest.stage)) return out;
  const lastSent = sent[sent.length - 1];
  if (lastSent && diffDays(TODAY, lastSent.at.slice(0, 10)) < 3) return out;
  out.dueNow = latest; return out;
}
function reminderVars(pi, offset) {
  const st = Sales.piState(pi), v = piEmailVars(pi), days = diffDays(TODAY, pi.dueDate), udyam = Store.data.settings.udyamNo;
  return { ...v, pi_balance: money(st.outstanding), days_overdue: Math.max(0, days),
    status_line: days < 0 ? `is due on ${fmtDate(pi.dueDate)}` : days === 0 ? 'is due today' : `is now ${days} days past its due date of ${fmtDate(pi.dueDate)}`,
    subject_prefix: days < 0 ? 'Reminder' : days === 0 ? 'Due today' : `Overdue ${days} days`,
    msme_line: udyam ? `As a registered micro/small enterprise (${udyam}), payments to us are due within 45 days under the MSMED Act, 2006.\n\n` : '' };
}
async function sendReminder(pi, stage, { manual = false } = {}) {
  const c = api.get('parties', pi.clientId), R = featureSettings().reminders;
  const r = emailRoute(c, 'pi_reminder'); if (!r.to.length) throw new Error('No email saved for ' + (c ? c.name : 'this client'));
  const days = diffDays(TODAY, pi.dueDate);
  const mgmt = days >= (R.escalateAfter || 15) ? partyContacts(c).filter(x => x.email && (x.tags || []).includes('management')).map(x => x.email) : [];
  const t = emailSettings().templates.pi_reminder || DEFAULT_EMAIL_TEMPLATES.pi_reminder, vars = reminderVars(pi, stage ? stage.offset : days);
  const m = await api.queueEmail({ kind: 'pi_reminder', entity: 'pis', entityId: pi.id, partyId: pi.clientId, to: r.to, cc: [...new Set([...r.cc, ...mgmt, ...(emailSettings().cc || [])])].filter(x => !r.to.includes(x)), subject: fillTemplate(t.subject, vars), body: fillTemplate(t.body, vars), attachments: pi.attachments || [] });
  pi.reminders = [...(pi.reminders || []), { stage: stage ? stage.stage : -1, offset: stage ? stage.offset : days, at: nowISO(), emailId: m.id, manual }];
  api.log('update', 'pis', pi.id, `Reminder ${manual ? 'sent' : 'queued automatically'} for PI ${pi.piNo} → ${r.to.join(', ')}`);
  Store.persist(); return m;
}
let lastReminderRun = null;
async function runReminders() {
  const R = featureSettings().reminders; if (!R.enabled || !api.can('email.queue')) return 0;
  let n = 0;
  for (const pi of api.list('pis')) {
    const rs = reminderState(pi); if (!rs.dueNow) continue;
    try { await sendReminder(pi, rs.dueNow); n++; pi.reminderIssue = ''; }
    catch (err) { if (pi.reminderIssue !== err.message) { pi.reminderIssue = err.message; Store.persist(); } }
  }
  lastReminderRun = { at: nowISO(), n };
  if (n) toast(`${n} payment reminder${n > 1 ? 's' : ''} queued to clients`);
  return n;
}
AUTOMATIONS.push(runReminders);
function reminderSectionHTML(pi) {
  const rs = reminderState(pi), can = api.can('pi.edit');
  const c = api.get('parties', pi.clientId);
  const sent = (pi.reminders || []).slice().reverse();
  const head = rs.reason === 'paid' ? 'No reminders — PI is settled' : rs.reason === 'paused' ? (pi.remindersOff ? 'Paused for this PI' : 'Paused for ' + (c ? c.name : 'this client')) : rs.next ? `Next: ${fmtDate(rs.next.date)} (${rs.next.offset < 0 ? -rs.next.offset + ' days before due' : rs.next.offset === 0 ? 'on the due date' : rs.next.offset + ' days after due'})` : 'Reminder schedule finished';
  return `<div class="fsec-h" style="margin-top:22px">Payment reminders</div>
    <div class="rm-box"><div class="row" style="gap:8px;flex-wrap:wrap"><span class="chip ${rs.reason === 'paused' ? 'gold' : rs.reason === 'paid' ? 'inflow' : ''}">${icon('bell').replace('<svg', '<svg style="width:12px;height:12px"')} ${esc(head)}</span>${pi.reminderIssue ? `<span class="chip overdue">${esc(pi.reminderIssue)}</span>` : ''}</div>
    <div class="rm-plan">${rs.plan.map(p => { const s = (pi.reminders || []).find(x => x.stage === p.stage); return `<span class="rm-step ${s ? 'sent' : p.date <= TODAY ? 'missed' : ''}" title="${fmtDate(p.date)}">${p.offset < 0 ? p.offset : p.offset === 0 ? 'Due' : '+' + p.offset}</span>`; }).join('')}</div>
    ${sent.length ? sent.map(s => `<div class="list-row" style="padding:6px 0;cursor:pointer" data-act="view-email" data-id="${s.emailId}"><span class="faint" style="font-size:12px;width:120px">${fmtDateTime(s.at)}</span><span class="grow" style="font-size:13px">${s.manual ? 'Sent manually' : 'Automatic'} · ${s.offset < 0 ? -s.offset + ' days before due' : s.offset === 0 ? 'due date' : s.offset + ' days overdue'}</span></div>`).join('') : '<div class="muted" style="font-size:12.5px;margin-top:6px">None sent yet.</div>'}
    ${can && rs.reason !== 'paid' ? `<div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">${rs.reason !== 'paused' ? `<button class="btn btn-sm" data-act="rm-now" data-id="${pi.id}">${icon('send')} Send reminder now</button>` : ''}<button class="btn btn-sm btn-ghost" data-act="rm-pause" data-id="${pi.id}">${pi.remindersOff ? 'Resume for this PI' : 'Pause for this PI'}</button><button class="btn btn-sm btn-ghost" data-act="rm-pause-client" data-id="${pi.clientId}" data-pi="${pi.id}">${(featureSettings().reminders.pausedClients || []).includes(pi.clientId) ? 'Resume for client' : 'Pause for client'}</button></div>` : ''}</div>`;
}

/* ---------- statement of account ---------- */
function openPIsFor(clientId) {
  return api.list('pis').filter(p => p.clientId === clientId && p.status !== 'cancelled').map(p => ({ p, st: Sales.piState(p) })).filter(x => x.st.outstanding > 0).sort((a, b) => a.p.dueDate.localeCompare(b.p.dueDate));
}
function statementVars(clientId) {
  const rows = openPIsFor(clientId), c = api.get('parties', clientId);
  const pad = (s, n, r) => { s = String(s); return r ? s.padStart(n) : s.padEnd(n); };
  const table = [`${pad('PI no.', 22)}${pad('PI date', 13)}${pad('Due', 13)}${pad('Balance', 14, 1)}  Status`, '-'.repeat(76),
    ...rows.map(({ p, st }) => `${pad(p.piNo.split('/').slice(-2).join('/'), 22)}${pad(fmtDate(p.date), 13)}${pad(fmtDate(p.dueDate), 13)}${pad(money(st.outstanding), 14, 1)}  ${st.overdueDays ? st.overdueDays + ' days overdue' : 'Not yet due'}`)].join('\n');
  const total = sum(rows, x => x.st.outstanding), udyam = Store.data.settings.udyamNo;
  return { party: c ? c.name : '', date: fmtDate(TODAY), statement_table: table, total_due: money(total), company: Store.data.settings.company, msme_line: udyam ? `As a registered micro/small enterprise (${udyam}), payments to us are due within 45 days under the MSMED Act, 2006.\n\n` : '' };
}
function openStatement(clientId) {
  const c = api.get('parties', clientId); if (!c) return;
  const rows = openPIsFor(clientId), total = sum(rows, x => x.st.outstanding), over = sum(rows.filter(x => x.st.overdueDays), x => x.st.outstanding);
  const recent = Calc.live().filter(e => e.partyId === clientId && e.type === 'inflow').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  closeDrawer();
  const ov = openModal(`<div class="modal-h"><h2>Statement of account</h2><span class="muted" style="font-size:12.5px">${esc(c.name)} · as of ${fmtDate(TODAY)}</span><span class="spacer"></span><button class="icon-btn" data-s="close">${icon('x')}</button></div><div class="modal-b">
    <div class="mini-kpis"><div><span>Outstanding</span><b>${money(total)}</b></div><div><span>Overdue</span><b class="${over ? 'out' : ''}">${money(over)}</b></div><div><span>Open PIs</span><b>${rows.length}</b></div><div><span>Credit terms</span><b>${c.creditDays != null && c.creditDays !== '' ? c.creditDays + ' days' : '—'}</b></div></div>
    <div class="tbl-wrap" style="margin-top:14px"><table class="tbl"><thead><tr><th>PI</th><th>Milestone</th><th>Date</th><th>Due</th><th class="num">PI total</th><th class="num">Received</th><th class="num">Balance</th></tr></thead><tbody>
    ${rows.map(({ p, st }) => `<tr><td class="mono" style="font-size:12px">${esc(p.piNo)}</td><td>${esc(p.milestone || '')}<div class="cell-sub">${esc(nameOf('projects', p.projectId))}</div></td><td>${fmtDate(p.date)}</td><td>${fmtDate(p.dueDate)}${st.overdueDays ? `<div class="cell-sub out">${st.overdueDays} days overdue</div>` : ''}</td><td class="num">${money(p.total)}</td><td class="num in">${st.gross ? money(st.gross) : '–'}</td><td class="num" style="font-weight:600">${money(st.outstanding)}</td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">Nothing outstanding.</div></td></tr>'}
    </tbody>${rows.length ? `<tfoot><tr><td colspan="6">Total outstanding</td><td class="num">${money(total)}</td></tr></tfoot>` : ''}</table></div>
    ${recent.length ? `<div class="fsec-h" style="margin-top:18px">Recent payments received</div>${recent.map(e => `<div class="list-row" style="padding:6px 0"><span class="grow" style="font-size:13px">${fmtDate(e.date)} · ${esc(e.refNo || e.description || '')}</span><span class="num in">${money(e.amount)}</span></div>`).join('')}` : ''}
    </div><div class="modal-f"><button class="btn" data-s="print">${icon('file')} Print / PDF</button>${rows.length && api.can('email.queue') ? `<button class="btn btn-gold" data-s="email">${icon('mail')} Email to client</button>` : ''}</div>`, 'xl');
  ov.addEventListener('click', ev => {
    const b = ev.target.closest('[data-s]'); if (!b) return;
    if (b.dataset.s === 'close') return ov.remove();
    if (b.dataset.s === 'email') { ov.remove(); return composeCustom({ kind: 'statement', partyId: clientId, vars: () => statementVars(clientId), context: `Statement for ${c.name} · ${money(total)} outstanding`, entity: 'parties', entityId: clientId }); }
    if (b.dataset.s === 'print') {
      let root = $('#printRoot'); if (!root) { root = document.createElement('div'); root.id = 'printRoot'; document.body.appendChild(root); }
      root.innerHTML = `<div class="print-page soa"><h1 style="font:600 22px var(--f-head)">${esc(Store.data.settings.company)}</h1><div class="muted">Statement of account · ${fmtDate(TODAY)}</div><h2 style="margin-top:18px">${esc(c.name)}</h2><div class="muted">${esc([c.address, c.pincode].filter(Boolean).join(' – '))}${c.gstin ? ' · GSTIN ' + esc(c.gstin) : ''}</div>${$('.modal-b .tbl-wrap', ov).innerHTML}${Store.data.settings.udyamNo ? `<p style="margin-top:16px;font-size:12px">Registered MSME ${esc(Store.data.settings.udyamNo)} — payments due within 45 days under the MSMED Act, 2006.</p>` : ''}</div>`;
      document.body.classList.add('print-mode');
      const done = () => { document.body.classList.remove('print-mode'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done); setTimeout(() => { window.print(); setTimeout(() => { if (document.body.classList.contains('print-mode') && !window.matchMedia('print').matches) done(); }, 1500); }, 60);
    }
  });
}
/** Generic review-and-queue composer for emails that aren't tied to an entry or PI form. */
function composeCustom({ kind, partyId, vars, context, entity, entityId, docs = [], onQueued }) {
  if (!api.can('email.queue')) return toast('Not allowed for your role', 'error');
  const E = initEmail(kind, partyId, true); E.on = true;
  const ov = openModal(`<div class="modal-h"><h2>${esc(EMAIL_KINDS[kind])}</h2><button class="icon-btn" data-c="close">${icon('x')}</button></div><div class="modal-b" id="emBody"></div>
    <div class="modal-f"><button class="btn" data-c="close">Cancel</button><button class="btn" data-c="mailapp">Open in mail app</button><button class="btn btn-gold" data-c="queue">${icon('send')} Queue email</button></div>`);
  const body = $('#emBody', ov); const draw = () => { refreshEmail(E, vars()); body.innerHTML = `<div class="muted" style="font-size:13px;margin-bottom:12px">${esc(context || '')}</div>` + emailBoxHTML(E, { docs: docs.length, standalone: true }); };
  draw(); bindEmailEvents(body, () => E, draw);
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-c]'); if (!b) return;
    if (b.dataset.c === 'close') return ov.remove();
    try {
      checkEmail(E);
      const m = await finalizeEmail(E, { entity, entityId, docs });
      if (b.dataset.c === 'mailapp') { window.location.href = mailtoHref(m); await api.setEmailStatus(m.id, 'mailapp', 'Opened in mail app by ' + api.me().name); }
      ov.remove(); toast(b.dataset.c === 'mailapp' ? 'Opened in your mail app · logged in the outbox' : 'Email queued to ' + m.to.join(', '));
      if (onQueued) await onQueued(m); afterWrite();
    } catch (err) { toast(err.message, 'error'); }
  });
}
Object.assign(ACT, {
  'rm-now': async el => { const pi = api.get('pis', el.dataset.id); try { const m = await sendReminder(pi, null, { manual: true }); toast('Reminder queued to ' + m.to.join(', ')); openPI(pi.id); } catch (err) { toast(err.message, 'error'); } },
  'rm-pause': async el => { const pi = api.get('pis', el.dataset.id); pi.remindersOff = !pi.remindersOff; api.log('update', 'pis', pi.id, `Reminders ${pi.remindersOff ? 'paused' : 'resumed'} for PI ${pi.piNo}`); Store.persist(); openPI(pi.id); },
  'rm-pause-client': el => { const R = featureSettings().reminders, id = el.dataset.id; R.pausedClients = (R.pausedClients || []).includes(id) ? R.pausedClients.filter(x => x !== id) : [...(R.pausedClients || []), id]; api.log('update', 'settings', 'reminders', `Reminders ${R.pausedClients.includes(id) ? 'paused' : 'resumed'} for ${nameOf('parties', id)}`); Store.persist(); toast(R.pausedClients.includes(id) ? 'Reminders paused for ' + nameOf('parties', id) : 'Reminders resumed'); if (el.dataset.pi) openPI(el.dataset.pi); else render({ keepScroll: true }); },
  'soa': el => openStatement(el.dataset.id),
});

/* ============================ WEEKLY DIGEST ============================ */
/* Queued every week on settings.digest.weekday at settings.digest.hour (default Monday 09:00) to settings.digest.to.
   BACKEND: same schedule from cron; the HTML preview below mirrors the plain-text email. */
const weekKey = d => { const x = new Date(d + 'T00:00:00'); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return isoDate(x); };
function digestData() {
  const from7 = addDays(TODAY, -7), to7 = addDays(TODAY, 7);
  const last = Calc.inRange(from7, addDays(TODAY, -1)).filter(e => e.type !== 'transfer');
  const pis = api.list('pis').filter(p => p.status !== 'cancelled').map(p => ({ p, st: Sales.piState(p) })).filter(x => x.st.outstanding > 0);
  const overdue = pis.filter(x => x.st.overdueDays > 0).sort((a, b) => b.st.outstanding - a.st.outstanding);
  const dueSoon = pis.filter(x => !x.st.overdueDays && x.p.dueDate <= to7);
  const recur = Calc.pendingRecurring(to7).filter(p => p.rec.type === 'outflow');
  const comp = complianceItems({ fromYm: addMonths(ymOf(TODAY), -14), toYm: addMonths(ymOf(TODAY), 1) }).filter(o => !o.done && o.days <= 14);
  const remSent = api.list('emails').filter(m => m.kind === 'pi_reminder' && m.createdAt >= from7);
  const bankOpen = Store.data.bankLines.filter(l => !l.deleted && lineStatus(l) === 'open');
  const lastImport = {}; Store.data.bankImports.filter(i => !i.deleted).forEach(i => { if (!lastImport[i.accountId] || i.to > lastImport[i.accountId]) lastImport[i.accountId] = i.to; });
  const ym = ymOf(TODAY), billed = sum(api.list('pis').filter(p => p.status !== 'cancelled' && ymOf(p.date) === ym), p => p.taxable), target = sum(api.list('departments'), d => Sales.targetForMonth(ym, d.id));
  const tds = typeof tdsSummary === 'function' ? tdsSummary(fyOf(TODAY)) : null;
  return { cash: Calc.cash(TODAY), cashPrev: Calc.cash(from7), inflow: sum(last.filter(e => e.type === 'inflow'), e => e.amount), outflow: sum(last.filter(e => e.type === 'outflow'), e => e.amount),
    topIn: last.filter(e => e.type === 'inflow').sort((a, b) => b.amount - a.amount).slice(0, 3), overdue, dueSoon, recur, comp, remSent, bankOpen, lastImport, billed, target, tds };
}
function digestText(D) {
  const L = [], h = s => { L.push(''); L.push(s.toUpperCase()); };
  L.push(`Weekly summary · ${Store.data.settings.company} · ${fmtDate(TODAY)}`);
  h('Cash'); L.push(`Bank, FD and cash today: ${money(D.cash)} (${money(D.cash - D.cashPrev, { sign: true })} in 7 days)`); L.push(`Last 7 days: received ${money(D.inflow)}, paid ${money(D.outflow)}`);
  D.topIn.forEach(e => L.push(`  + ${money(e.amount)} · ${entryParty(e) || entryTitle(e)} · ${fmtDate(e.date)}`));
  h('Money to collect'); L.push(`Overdue PIs: ${D.overdue.length} · ${money(sum(D.overdue, x => x.st.outstanding))}`);
  D.overdue.slice(0, 5).forEach(x => L.push(`  ${nameOf('parties', x.p.clientId)} · ${x.p.piNo} · ${money(x.st.outstanding)} · ${x.st.overdueDays} days`));
  if (D.dueSoon.length) L.push(`Due this week: ${D.dueSoon.length} PIs · ${money(sum(D.dueSoon, x => x.st.outstanding))}`);
  L.push(`Reminders sent automatically in the last 7 days: ${D.remSent.length}`);
  h('Money going out this week'); L.push(`Recurring items due: ${D.recur.length} · ${money(sum(D.recur, p => p.net))}`); D.recur.slice(0, 6).forEach(p => L.push(`  ${fmtDate(p.dueDate)} · ${p.rec.name} · ${money(p.net)}${p.overdue ? ' (overdue)' : ''}`));
  h('Compliance (next 14 days)'); if (!D.comp.length) L.push('Nothing due.'); D.comp.forEach(o => L.push(`  ${fmtDate(o.due)} · ${o.label}${o.balance ? ' · ' + money(o.balance) : ''}${o.days < 0 ? ` · ${-o.days} DAYS LATE` : ''}`));
  h('Bank'); L.push(D.bankOpen.length ? `${D.bankOpen.length} statement lines waiting for review` : 'All imported statement lines are matched');
  bankAccounts().forEach(a => L.push(`  ${a.name}: ${D.lastImport[a.id] ? 'statement imported up to ' + fmtDate(D.lastImport[a.id]) : 'no statement imported yet'}`));
  if (D.tds) { h('TDS deducted by clients'); L.push(`${fyLabel(fyOf(TODAY))}: ${money(D.tds.books)} deducted · ${money(D.tds.gap)} not yet in 26AS · ${D.tds.pending16A} Form 16A pending`); }
  h('Sales this month'); L.push(`PIs issued: ${money(D.billed)}${D.target ? ` of ${money(D.target)} target (${Math.round(100 * D.billed / D.target)}%)` : ''}`);
  L.push(''); L.push('Open the app for details.');
  return L.join('\n');
}
function digestHTML(D) {
  const li = (a, b, cls = '') => `<div class="dg-li"><span>${a}</span><b class="num ${cls}">${b}</b></div>`;
  return `<div class="dg">
    <div class="dg-sec"><h4>Cash</h4>${li('Bank, FD and cash today', money(D.cash))}${li('Change in 7 days', money(D.cash - D.cashPrev, { sign: true }), D.cash >= D.cashPrev ? 'in' : 'out')}${li('Received last 7 days', money(D.inflow), 'in')}${li('Paid last 7 days', money(D.outflow), 'out')}</div>
    <div class="dg-sec"><h4>To collect</h4>${li('Overdue PIs · ' + D.overdue.length, money(sum(D.overdue, x => x.st.outstanding)), D.overdue.length ? 'out' : '')}${D.overdue.slice(0, 4).map(x => li(`<span class="muted">${esc(nameOf('parties', x.p.clientId))} · ${x.st.overdueDays}d</span>`, money(x.st.outstanding))).join('')}${li('Due this week · ' + D.dueSoon.length, money(sum(D.dueSoon, x => x.st.outstanding)))}${li('Reminders sent (7 days)', D.remSent.length)}</div>
    <div class="dg-sec"><h4>Going out this week</h4>${li('Recurring items · ' + D.recur.length, money(sum(D.recur, p => p.net)))}${D.comp.slice(0, 5).map(o => li(`${fmtDate(o.due).slice(0, 6)} · ${esc(o.label)}${o.days < 0 ? ' <span class="out">late</span>' : ''}`, o.balance ? money(o.balance) : 'file')).join('')}</div>
    <div class="dg-sec"><h4>Bank & tax</h4>${li('Statement lines to review', D.bankOpen.length, D.bankOpen.length ? 'out' : 'in')}${bankAccounts().map(a => li(esc(a.name) + ' imported to', D.lastImport[a.id] ? fmtDate(D.lastImport[a.id]) : 'never', !D.lastImport[a.id] || diffDays(TODAY, D.lastImport[a.id]) > 10 ? 'out' : '')).join('')}${D.tds ? li('TDS not yet in 26AS', money(D.tds.gap), D.tds.gap ? 'out' : '') + li('Form 16A pending', D.tds.pending16A) : ''}${li('PIs issued this month', money(D.billed) + (D.target ? ` · ${Math.round(100 * D.billed / D.target)}% of target` : ''))}</div></div>`;
}
async function queueDigest(manual) {
  const G = featureSettings().digest; if (!G.to || !G.to.length) throw new Error('Add at least one recipient for the weekly digest in Settings');
  const D = digestData();
  const m = await api.queueEmail({ kind: 'digest', entity: 'digest', entityId: weekKey(TODAY), partyId: null, to: G.to, cc: [], subject: `Weekly summary · ${fmtDate(TODAY)} · cash ${money(D.cash)} · ${D.overdue.length} overdue PIs`, body: digestText(D), attachments: [] });
  if (!manual) G.lastWeek = weekKey(TODAY); G.lastSentAt = nowISO(); Store.persist(); return m;
}
async function runDigest() {
  const G = featureSettings().digest; if (!G.enabled || !G.to || !G.to.length || !api.can('email.queue')) return;
  const wk = weekKey(TODAY); if (G.lastWeek === wk) return;
  const now = new Date(), dow = (now.getDay() + 6) % 7 + 1; // Mon=1..Sun=7
  if (dow < (G.weekday || 1) || (dow === (G.weekday || 1) && now.getHours() < (G.hour ?? 9))) return;
  await queueDigest(false); toast('Weekly digest queued to ' + G.to.join(', '));
}
AUTOMATIONS.push(runDigest);
function openDigestPreview() {
  const D = digestData(), G = featureSettings().digest;
  const ov = openModal(`<div class="modal-h"><h2>Weekly digest</h2><span class="muted" style="font-size:12.5px">as it would go out today</span><span class="spacer"></span><button class="icon-btn" data-d="close">${icon('x')}</button></div><div class="modal-b">${digestHTML(D)}
    <details style="margin-top:14px"><summary class="muted" style="cursor:pointer;font-size:13px">Email text</summary><pre class="dg-pre">${esc(digestText(D))}</pre></details></div>
    <div class="modal-f"><span class="muted" style="font-size:12px;margin-right:auto">${G.to.length ? 'To ' + esc(G.to.join(', ')) : 'No recipient set'}</span>${api.can('email.queue') && G.to.length ? `<button class="btn btn-gold" data-d="send">${icon('send')} Send now</button>` : ''}</div>`, 'xl');
  ov.addEventListener('click', async ev => { const b = ev.target.closest('[data-d]'); if (!b) return; if (b.dataset.d === 'close') return ov.remove(); try { const m = await queueDigest(true); ov.remove(); toast('Digest queued to ' + m.to.join(', ')); render({ keepScroll: true }); } catch (err) { toast(err.message, 'error'); } });
}
function automationSettingsCard() {
  const R = featureSettings().reminders, G = featureSettings().digest, owner = api.can('settings.edit'), dis = owner ? '' : 'disabled';
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return `<div class="card" id="autoSettings"><div class="card-h"><div class="grow"><h3>Reminders & weekly digest</h3><div class="sub">Automatic emails. They are queued in the outbox; the backend sends them.</div></div><button class="btn btn-sm" data-act="dg-preview">Preview digest</button></div><div class="card-b"><form id="auForm">
    <div class="fsec-h">PI payment reminders</div><div class="fgrid">
      <div class="field" style="justify-content:flex-end"><label class="check" style="height:38px"><input type="checkbox" name="rEnabled" ${R.enabled ? 'checked' : ''} ${dis}> Send reminders automatically</label></div>
      <div class="field"><label>Days from due date</label><input class="input mono" name="rOffsets" value="${esc((R.offsets || []).join(', '))}" ${dis}><div class="hint">Negative = before due. Default −3, 0, 7, 15</div></div>
      <div class="field"><label>Then repeat every (days)</label><input class="input" type="number" min="0" name="rRepeat" value="${R.repeatDays}" ${dis}><div class="hint">0 = stop after the list · max ${R.maxReminders} reminders per PI</div></div>
      <div class="field"><label>Copy Management contacts after (days overdue)</label><input class="input" type="number" min="0" name="rEsc" value="${R.escalateAfter}" ${dis}></div>
      <div class="field"><label>Your Udyam registration no.</label><input class="input mono" name="udyam" value="${esc(Store.data.settings.udyamNo || '')}" placeholder="UDYAM-MH-00-0000000" ${dis}><div class="hint">Adds the MSMED Act 45-day line to reminders and statements</div></div>
      <div class="field"><label>Paused clients</label><div style="font-size:13px;padding-top:8px">${(R.pausedClients || []).map(id => esc(nameOf('parties', id))).join(', ') || '<span class="muted">None</span>'}</div></div>
    </div>
    <div class="fsec-h" style="margin-top:18px">Weekly digest to the owner</div><div class="fgrid">
      <div class="field" style="justify-content:flex-end"><label class="check" style="height:38px"><input type="checkbox" name="gEnabled" ${G.enabled ? 'checked' : ''} ${dis}> Send every week</label></div>
      <div class="field"><label>Day & time</label><div class="row" style="flex-wrap:nowrap;gap:6px"><select class="select" name="gDay" ${dis}>${opts(days.map((d, i) => [i + 1, d]), G.weekday)}</select><select class="select" name="gHour" style="max-width:100px" ${dis}>${opts(Array.from({ length: 24 }, (_, h) => [h, pad2(h) + ':00']), G.hour)}</select></div></div>
      <div class="field"><label>Send to</label><input class="input" name="gTo" value="${esc((G.to || []).join(', '))}" placeholder="you@iuova.in" ${dis}><div class="hint">${G.lastSentAt ? 'Last queued ' + fmtDateTime(G.lastSentAt) : 'Not sent yet'}</div></div>
    </div></form>${owner ? '<div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn btn-navy" data-act="au-save">Save</button></div>' : ''}</div></div>`;
}
Object.assign(ACT, {
  'dg-preview': () => openDigestPreview(),
  'au-save': () => {
    const f = $('#auForm'), R = featureSettings().reminders, G = featureSettings().digest;
    const offs = String(f.rOffsets.value).split(/[,\s]+/).filter(Boolean).map(Number);
    if (!offs.length || offs.some(x => isNaN(x) || Math.abs(x) > 365)) return toast('Days from due date should be numbers like -3, 0, 7, 15', 'error');
    const to = splitEmails(f.gTo.value), bad = to.filter(x => !validEmail(x)); if (bad.length) return toast('Not a valid email: ' + bad.join(', '), 'error');
    Object.assign(R, { enabled: f.rEnabled.checked, offsets: offs, repeatDays: Math.max(0, +f.rRepeat.value || 0), escalateAfter: Math.max(0, +f.rEsc.value || 0) });
    Object.assign(G, { enabled: f.gEnabled.checked, weekday: +f.gDay.value, hour: +f.gHour.value, to });
    Store.data.settings.udyamNo = f.udyam.value.trim();
    api.log('update', 'settings', 'automation', 'Reminder and digest settings updated'); Store.persist(); toast('Saved'); render({ keepScroll: true });
  },
});
/** Dashboard row: compliance + collections at a glance. */
function dashActionCards() {
  const pis = api.list('pis').filter(p => p.status !== 'cancelled').map(p => ({ p, st: Sales.piState(p), rs: reminderState(p) })).filter(x => x.st.outstanding > 0);
  const over = pis.filter(x => x.st.overdueDays > 0).sort((a, b) => b.st.overdueDays - a.st.overdueDays);
  const today = api.list('emails').filter(m => m.kind === 'pi_reminder' && (m.createdAt || '').slice(0, 10) === TODAY).length;
  const nextR = pis.map(x => x.rs.next).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date))[0];
  const coll = `<div class="card"><div class="card-h"><div class="grow"><h3>Collections</h3><div class="sub">${today ? `${today} reminder${today > 1 ? 's' : ''} queued today` : 'Reminders run automatically'}${nextR ? ' · next ' + fmtDate(nextR.date) : ''}</div></div><a class="btn btn-sm" href="#/pis">PIs</a></div>
    ${over.slice(0, 5).map(x => `<div class="list-row" style="cursor:pointer" data-act="open-pi" data-id="${x.p.id}"><div class="grow"><div class="t">${esc(nameOf('parties', x.p.clientId))}</div><div class="s">${esc(x.p.piNo.split('/').slice(-2).join('/'))} · <span class="out">${x.st.overdueDays} days overdue</span>${x.rs.reason === 'paused' ? ' · reminders paused' : (x.p.reminders || []).length ? ' · ' + x.p.reminders.length + ' reminder' + (x.p.reminders.length > 1 ? 's' : '') + ' sent' : ''}</div></div><div class="num" style="font-weight:600">${money(x.st.outstanding)}</div><button class="btn btn-sm btn-ghost" data-act="soa" data-id="${x.p.clientId}" title="Statement of account">SOA</button></div>`).join('') || '<div class="empty"><b>Nothing overdue</b>All PIs are within their due dates.</div>'}</div>`;
  return `<div class="grid g-2">${complianceCard()}${coll}</div>`;
}
/* ============================ TDS RECEIVABLE: deducted by clients vs Form 26AS / AIS, Form 16A tracking ============================ */
/* Books: inflow entries with tdsAmount, grouped by payer and FY quarter (by receipt date).
   26AS: Store.data.tds26 rows {fy, tan, name, date, section, amount, tds, status, importId, partyId} from a TRACES text file or AIS / 26AS Excel/CSV.
   16A: Store.data.tdsCerts {clientId, fy, q, received, receivedAt, certNo, note}.
   BACKEND: POST /api/tds26/import (file); GET /api/tds/summary?fy=. */
S.tdsr = { open: null };
const TAN_RX = /^[A-Z]{4}\d{5}[A-Z]$/;
const tdsPayers = () => api.list('parties').filter(p => p.kind === 'client' || p.kind === 'other');
/* ---------- parsing ---------- */
function parse26ASText(text) {
  const rows = [], lines = text.replace(/\r/g, '').split('\n'); let cur = null, inPart1 = false, sawPart = false;
  for (const raw of lines) {
    const f = raw.split('^').map(x => x.trim());
    const joined = f.join(' ').toUpperCase();
    if (/PART[\s\-]*I\b(?!I)/.test(joined) && !/PART[\s\-]*I[IV]/.test(joined)) { inPart1 = true; sawPart = true; continue; }
    if (/PART[\s\-]*(II|III|IV|V|VI|VII|VIII|IX|X)\b/.test(joined) && sawPart) { inPart1 = false; cur = null; continue; }
    if (sawPart && !inPart1) continue;
    const ti = f.findIndex(x => TAN_RX.test(x));
    if (ti > 0) { cur = { tan: f[ti], name: f[ti - 1] || f.slice(0, ti).filter(Boolean).pop() || '' }; continue; }
    const si = f.findIndex(x => /^19\d[A-Z]{0,3}$/.test(x));
    const di = f.findIndex(x => parseBankDate(x));
    if (cur && si >= 0 && di >= 0) {
      const nums = f.slice(di + 1).map(x => x.replace(/,/g, '')).filter(x => /^-?\d+(\.\d+)?$/.test(x)).map(Number);
      if (nums.length >= 2) rows.push({ tan: cur.tan, name: cur.name, section: f[si], date: parseBankDate(f[di]), status: (f.find((x, i) => i > di && /^[FUPOZ]$/.test(x)) || ''), amount: nums[nums.length - 3] ?? nums[0], tds: nums.length >= 3 ? nums[nums.length - 1] : nums[nums.length - 1] });
    }
  }
  return rows;
}
function parse26ASSheet(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const c = rows[i].map(x => String(x).toLowerCase().replace(/\s+/g, ' ').trim());
    const ix = rx => c.findIndex(x => rx.test(x));
    const m = { tan: ix(/tan/), name: ix(/name of (the )?deductor|deductor name|^name$|information source/), section: ix(/section/), date: ix(/transaction date|date of (payment|credit|booking)|^date/), amount: ix(/amount (paid|credited)|paid ?\/ ?credited|transaction amount|^amount/), tds: ix(/tds deposited|tax deposited|tax deducted|tds deducted|^tds/) };
    if (m.tan >= 0 && m.date >= 0 && m.tds >= 0) {
      const out = [];
      for (let j = i + 1; j < rows.length; j++) {
        const r = rows[j]; const tan = String(r[m.tan] || '').trim().toUpperCase(); const date = parseBankDate(r[m.date]);
        if (!TAN_RX.test(tan) || !date) continue;
        out.push({ tan, name: m.name >= 0 ? String(r[m.name] || '').trim() : tan, section: m.section >= 0 ? String(r[m.section] || '').trim() : '', date, status: '', amount: Math.abs(parseBankAmt(r[m.amount]) || 0), tds: Math.abs(parseBankAmt(r[m.tds]) || 0) });
      }
      return out;
    }
  }
  return null;
}
const NAME_GENERIC = new Set(['pvt', 'ltd', 'limited', 'private', 'india', 'co', 'the', 'and', 'llp', 'inc', 'company']);
const nameToks = s => normTxt(s).split(' ').filter(x => x.length >= 2 && !NAME_GENERIC.has(x));
const nameSim = (a, b) => { const A = new Set(nameToks(a)), B = new Set(nameToks(b)); if (!A.size || !B.size) return 0; let n = 0; A.forEach(t => { if (B.has(t)) n++; }); return n / Math.min(A.size, B.size); };
function payerForTan(tan, name) {
  const byTan = tdsPayers().find(p => (p.tan || '').toUpperCase() === tan); if (byTan) return { p: byTan, how: 'tan' };
  const cands = tdsPayers().filter(p => !p.tan).map(p => ({ p, s: nameSim(name, p.name) })).filter(x => x.s >= 0.6).sort((a, b) => b.s - a.s);
  if (cands.length === 1 || (cands.length > 1 && cands[0].s - cands[1].s >= 0.3)) return { p: cands[0].p, how: 'name' };
  return null;
}
async function import26AS(file) {
  if (!api.can('tds.edit')) return toast('Not allowed for your role', 'error');
  let rows = null;
  try {
    if (/\.(xlsx|xls)$/i.test(file.name)) rows = parse26ASSheet(await readSheetRows(file));
    else { const text = await file.text(); rows = text.includes('^') ? parse26ASText(text) : parse26ASSheet(parseCSV(text)); }
  } catch (err) { return toast(err.message, 'error'); }
  if (!rows || !rows.length) return toast('No TDS entries found. Use the 26AS text file from TRACES, or the AIS / 26AS export as Excel or CSV.', 'error');
  featureSettings();
  const fys = [...new Set(rows.map(r => fyOf(r.date)))];
  const tans = [...new Map(rows.map(r => [r.tan, r.name])).entries()];
  const map = tans.map(([tan, name]) => ({ tan, name, m: payerForTan(tan, name), tds: sum(rows.filter(r => r.tan === tan), r => r.tds) }));
  const ov = openModal(`<div class="modal-h"><h2>Import Form 26AS</h2><span class="muted" style="font-size:12.5px">${esc(file.name)}</span></div><div class="modal-b">
    <div class="bk-prev"><div><span>Financial year</span><b>${fys.map(fyLabel).join(', ')}</b></div><div><span>TDS entries</span><b>${rows.length}</b></div><div><span>Deductors</span><b>${tans.length}</b></div><div><span>Total TDS credited</span><b>${money(sum(rows, r => r.tds))}</b></div></div>
    <div class="fsec-h" style="margin-top:16px">Who deducted it</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Deductor in 26AS</th><th class="num">TDS</th><th>Payer in your books</th></tr></thead><tbody>
    ${map.map((x, i) => `<tr><td><div class="cell-main">${esc(x.name)}</div><div class="cell-sub mono">${esc(x.tan)}</div></td><td class="num">${money(x.tds)}</td><td><select class="select sel-sm" data-tmap="${i}"><option value="">Not a client / skip</option>${tdsPayers().map(p => `<option value="${p.id}"${x.m && x.m.p.id === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>${x.m ? `<div class="cell-sub">${x.m.how === 'tan' ? 'Matched by TAN' : 'Matched by name · TAN will be saved'}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <div class="hint" style="margin-top:8px">Re-importing replaces the earlier 26AS data for the same year.</div></div>
    <div class="modal-f"><button class="btn" data-t="no">Cancel</button><button class="btn btn-gold" data-t="yes">Import</button></div>`, 'xl');
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-t]'); if (!b) return; if (b.dataset.t === 'no') return ov.remove();
    const pick = {}; $$('[data-tmap]', ov).forEach(s => { const x = map[+s.dataset.tmap]; pick[x.tan] = s.value || null; });
    const impId = uid('t26');
    Store.data.tds26 = Store.data.tds26.filter(r => !fys.includes(r.fy));
    rows.forEach(r => Store.data.tds26.push({ id: uid('t26'), importId: impId, fy: fyOf(r.date), ...r, partyId: pick[r.tan] || null }));
    let saved = 0;
    for (const [tan, pid] of Object.entries(pick)) { const p = api.get('parties', pid); if (p && (p.tan || '').toUpperCase() !== tan) { await api.update('parties', p.id, { tan }, { summary: `TAN ${tan} saved for ${p.name} from 26AS` }); saved++; } }
    Store.data.settings.tds26Imports = [...(Store.data.settings.tds26Imports || []).filter(i => !fys.includes(i.fy)), ...fys.map(fy => ({ fy, at: nowISO(), file: file.name, by: api.me().id }))];
    api.log('create', 'tds26', impId, `Imported 26AS · ${fys.map(fyLabel).join(', ')} · ${rows.length} TDS entries`);
    Store.persist(); ov.remove(); if (fys.length) S.fy = fys.includes(S.fy) ? S.fy : fys[fys.length - 1];
    location.hash = '#/tdsr'; render(); toast(`26AS imported · ${rows.length} entries${saved ? ` · TAN saved for ${saved} client${saved > 1 ? 's' : ''}` : ''}`);
  });
}
/* ---------- reconciliation ---------- */
function tds16ADue(fy, q) { return q === 3 ? (fy + 1) + '-06-15' : q === 2 ? (fy + 1) + '-02-15' : fy + (q === 0 ? '-08-15' : '-11-15'); }
function tdsGrid(fy) {
  const [f, t] = fyRange(fy);
  const recs = Calc.inRange(f, t).filter(e => e.type === 'inflow' && +e.tdsAmount > 0 && e.partyId);
  const as26 = (Store.data.tds26 || []).filter(r => r.fy === fy);
  const imported = (Store.data.settings.tds26Imports || []).find(i => i.fy === fy);
  const payers = [...new Set([...recs.map(e => e.partyId), ...as26.filter(r => r.partyId).map(r => r.partyId)])].map(id => api.get('parties', id)).filter(Boolean);
  const rows = payers.map(p => {
    const qs = [0, 1, 2, 3].map(q => {
      const ms = new Set(quarterMonths(fy, q)), qEnd = ymDate(quarterMonths(fy, q)[2], 31);
      const rr = recs.filter(e => e.partyId === p.id && ms.has(ymOf(e.date))), aa = as26.filter(r => r.partyId === p.id && ms.has(ymOf(r.date)));
      const books = r2(sum(rr, e => e.tdsAmount)), in26 = r2(sum(aa, r => r.tds));
      const cert = (Store.data.tdsCerts || []).find(c => !c.deleted && c.clientId === p.id && c.fy === fy && c.q === q);
      const due16 = tds16ADue(fy, q), started = quarterMonths(fy, q)[0] <= ymOf(TODAY);
      let st = 'none';
      if (books || in26) {
        if (qEnd >= TODAY) st = 'running'; else if (!imported) st = 'unchecked'; else if (imported.at.slice(0, 10) < addDays(qEnd, 31)) st = 'early';
        else st = Math.abs(books - in26) <= 10 ? 'ok' : books > in26 ? 'short' : 'extra';
      }
      return { q, rr, aa, books, in26, cert, due16, st, started, gap: ['ok', 'short', 'extra'].includes(st) ? r2(books - in26) : null, certLate: books > 0 && !(cert && cert.received) && due16 < TODAY };
    });
    return { p, qs, books: sum(qs, x => x.books), in26: sum(qs, x => x.in26) };
  }).filter(r => r.books || r.in26).sort((a, b) => b.books - a.books);
  const unmapped = [...new Map(as26.filter(r => !r.partyId).map(r => [r.tan, { tan: r.tan, name: r.name, tds: 0 }])).values()].map(x => ({ ...x, tds: sum(as26.filter(r => r.tan === x.tan), r => r.tds) }));
  return { rows, imported, unmapped, as26 };
}
function tdsSummary(fy) {
  const G = tdsGrid(fy); const cells = G.rows.flatMap(r => r.qs);
  return { books: sum(G.rows, r => r.books), in26: sum(G.rows, r => r.in26), gap: sum(cells.filter(c => c.st === 'short'), c => c.gap), pending16A: cells.filter(c => c.certLate).length, short: cells.filter(c => c.st === 'short').length, imported: G.imported };
}
const TDS_ST = { ok: ['Matched', 'inflow'], short: ['Short in 26AS', 'overdue'], extra: ['More in 26AS', 'gold'], unchecked: ['Not checked', ''], early: ['Return not due yet', ''], running: ['Quarter running', ''], none: ['', ''] };
PAGES.tdsr = {
  title: 'TDS receivable',
  render() {
    const fy = S.fy, G = tdsGrid(fy), can = api.can('tds.edit'), cells = G.rows.flatMap(r => r.qs.map(c => ({ ...c, p: r.p })));
    const books = sum(G.rows, r => r.books), in26 = sum(G.rows, r => r.in26), short = cells.filter(c => c.st === 'short'), late16 = cells.filter(c => c.certLate);
    const head = `<div class="bk-bar"><div><div style="font:600 15px var(--f-head)">${esc(fyLabel(fy))}</div><div class="muted" style="font-size:12.5px">${G.imported ? `26AS imported ${fmtDateTime(G.imported.at)} · ${esc(G.imported.file)}` : 'No 26AS imported for this year yet'}</div></div><span class="spacer"></span>
      ${can ? `<button class="btn btn-sm" data-act="td-sample">${icon('bolt')} Try a sample 26AS</button><label class="btn btn-gold">${icon('upload')} Import 26AS / AIS<input type="file" id="tdFile" accept=".txt,.csv,.xls,.xlsx" style="display:none"></label>` : ''}</div>`;
    const kpis = `<div class="grid g-kpi cp-kpis">
      <div class="card kpi"><div class="k-l">Deducted by payers</div><div class="k-v">${money(books)}</div><div class="k-s">TDS on receipts in your books</div></div>
      <div class="card kpi"><div class="k-l">Credited in 26AS</div><div class="k-v ${G.imported ? 'in' : ''}">${G.imported ? money(in26) : '—'}</div><div class="k-s">${G.imported ? 'Claimable against your tax' : 'Import 26AS to check'}</div></div>
      <div class="card kpi ${short.length ? 'warn' : ''}"><div class="k-l">Missing from 26AS</div><div class="k-v ${short.length ? 'out' : ''}">${G.imported ? money(sum(short, c => c.gap)) : '—'}</div><div class="k-s">${short.length} client-quarter${short.length === 1 ? '' : 's'} to chase</div></div>
      <div class="card kpi"><div class="k-l">Form 16A overdue</div><div class="k-v ${late16.length ? 'out' : ''}">${late16.length}</div><div class="k-s">certificates past the issue date</div></div></div>`;
    const cell = (r, c) => {
      if (!c.books && !c.in26) return `<td class="td-cell empty"><span class="faint">${c.started ? '—' : ''}</span></td>`;
      const [l, cls] = TDS_ST[c.st];
      return `<td class="td-cell" data-act="td-open" data-id="${r.p.id}" data-q="${c.q}"><div class="num" style="font-weight:600">${money(c.books)}</div>${G.imported && !['running'].includes(c.st) ? `<div class="cell-sub num">26AS ${money(c.in26)}</div>` : ''}<div class="td-tags">${l ? `<span class="chip ${cls}">${l}</span>` : ''}${c.books ? (c.cert && c.cert.received ? '<span class="chip inflow">16A ✓</span>' : c.certLate ? '<span class="chip overdue">16A due</span>' : '') : ''}</div></td>`;
    };
    const table = `<div class="card"><div class="card-h"><div class="grow"><h3>By payer and quarter</h3><div class="sub">Click a quarter for the receipts, 26AS lines and Form 16A. Quarters follow the receipt date; a deductor may report a payment in the next quarter.</div></div>${can && (short.length || late16.length) ? `<button class="btn btn-sm btn-navy" data-act="td-chase-all">${icon('mail')} Request from ${new Set([...short, ...late16].map(c => c.p.id)).size} payer${new Set([...short, ...late16].map(c => c.p.id)).size > 1 ? 's' : ''}</button>` : ''}</div>
      <div class="tbl-wrap"><table class="tbl td-tbl"><thead><tr><th>Payer</th>${[0, 1, 2, 3].map(q => `<th class="num">${FY_Q(q)}<div class="cell-sub" style="text-transform:none;letter-spacing:0">16A by ${fmtDate(tds16ADue(fy, q)).slice(0, 6)}</div></th>`).join('')}<th class="num">Year</th></tr></thead><tbody>
      ${G.rows.map(r => `<tr><td><a href="#" class="cell-main pd-link" data-act="open-party" data-id="${r.p.id}">${esc(r.p.name)}</a><div class="cell-sub mono">${esc(r.p.tan || 'TAN not saved')}</div></td>${r.qs.map(c => cell(r, c)).join('')}<td class="num"><b>${money(r.books)}</b>${G.imported ? `<div class="cell-sub">26AS ${money(r.in26)}</div>` : ''}</td></tr>`).join('') || `<tr><td colspan="6"><div class="empty">No TDS deducted on receipts in ${esc(fyLabel(fy))}.</div></td></tr>`}
      </tbody></table></div></div>`;
    const unm = G.unmapped.length ? `<div class="card"><div class="card-h"><div class="grow"><h3>In 26AS but not linked to a payer</h3><div class="sub">Link them so their TDS counts against the right client</div></div></div>${G.unmapped.map(u => `<div class="list-row"><div class="grow"><div class="t">${esc(u.name)}</div><div class="s mono">${esc(u.tan)}</div></div><span class="num">${money(u.tds)}</span>${can ? `<select class="select sel-sm" data-act-chg="td-link" data-tan="${u.tan}" style="max-width:220px"><option value="">Link to…</option>${tdsPayers().map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>` : ''}</div>`).join('')}</div>` : '';
    return `<div class="stack">${head}${kpis}${table}${unm}<div class="muted" style="font-size:12px">Download Form 26AS from TRACES (View Tax Credit → export as Text) or the AIS / TIS from the income-tax portal as Excel/CSV. Matching is by the deductor's TAN; the first time, the app matches by name and saves the TAN on the client.</div></div>`;
  },
};
function openTdsCell(pid, q) {
  const fy = S.fy, G = tdsGrid(fy), r = G.rows.find(x => x.p.id === pid); if (!r) return; const c = r.qs[q], p = r.p, can = api.can('tds.edit');
  const ov = openModal(`<div class="modal-h"><h2>${esc(p.name)}</h2><span class="muted" style="font-size:12.5px">${FY_Q(q)} · ${esc(fyLabel(fy))}</span><span class="spacer"></span><button class="icon-btn" data-z="close">${icon('x')}</button></div><div class="modal-b">
    <div class="mini-kpis"><div><span>In books</span><b>${money(c.books)}</b></div><div><span>In 26AS</span><b>${G.imported ? money(c.in26) : '—'}</b></div><div><span>Difference</span><b class="${c.gap > 10 ? 'out' : ''}">${c.gap == null ? '—' : money(c.gap, { sign: true })}</b></div><div><span>Form 16A</span><b class="${c.cert && c.cert.received ? 'in' : c.certLate ? 'out' : ''}">${c.cert && c.cert.received ? 'Received' : c.certLate ? 'Overdue' : 'Due ' + fmtDate(c.due16)}</b></div></div>
    <div class="fsec-h" style="margin-top:16px">Receipts with TDS (${c.rr.length})</div>${c.rr.map(e => `<div class="list-row" style="cursor:pointer" data-act="open-entry" data-id="${e.id}"><div class="grow"><div class="t" style="font-size:13px">${fmtDate(e.date)} · ${esc(e.refNo || e.description || '')}</div><div class="s">Taxable ${money(e.taxable)} · TDS ${e.tdsRate}%</div></div><span class="num">${money(e.tdsAmount)}</span></div>`).join('') || '<div class="muted" style="font-size:13px">None.</div>'}
    <div class="fsec-h" style="margin-top:16px">Credits in 26AS (${c.aa.length})</div>${c.aa.map(a => `<div class="list-row" style="padding:6px 0"><div class="grow"><div class="t" style="font-size:13px">${fmtDate(a.date)} · ${esc(a.section)} ${a.status ? '· status ' + esc(a.status) : ''}</div><div class="s">Paid / credited ${money(a.amount)}</div></div><span class="num">${money(a.tds)}</span></div>`).join('') || `<div class="muted" style="font-size:13px">${G.imported ? 'Nothing reported by this deductor for the quarter.' : 'Import 26AS to compare.'}</div>`}
    ${can ? `<div class="fsec-h" style="margin-top:16px">Form 16A</div><div class="fgrid c4"><div class="field" style="justify-content:flex-end"><label class="check" style="height:38px"><input type="checkbox" id="tdRec" ${c.cert && c.cert.received ? 'checked' : ''}> Received</label></div><div class="field"><label>Received on</label><input class="input" type="date" id="tdDate" value="${(c.cert && c.cert.receivedAt) || TODAY}"></div><div class="field span2"><label>Certificate no.</label><input class="input mono" id="tdNo" value="${esc((c.cert && c.cert.certNo) || '')}" placeholder="From the TRACES certificate"></div></div>` : ''}
    </div><div class="modal-f">${can ? `<button class="btn" data-z="request">${icon('mail')} Request from ${esc(p.name.split(' ')[0])}</button><button class="btn btn-gold" data-z="save">Save</button>` : '<button class="btn" data-z="close">Close</button>'}</div>`);
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-z]'); if (!b) return;
    if (b.dataset.z === 'close') return ov.remove();
    if (b.dataset.z === 'request') { ov.remove(); return requestTds(p.id, fy, [q]); }
    if (b.dataset.z === 'save') {
      const rec = $('#tdRec', ov).checked, data = { clientId: p.id, fy, q, received: rec, receivedAt: rec ? $('#tdDate', ov).value : null, certNo: $('#tdNo', ov).value.trim(), note: '' };
      if (c.cert) await api.update('tdsCerts', c.cert.id, data, { summary: `Form 16A ${rec ? 'received' : 'not received'} · ${p.name} · ${FY_Q(q)} ${fyLabel(fy)}` });
      else await api.create('tdsCerts', data, { summary: `Form 16A ${rec ? 'received' : 'tracked'} · ${p.name} · ${FY_Q(q)} ${fyLabel(fy)}` });
      ov.remove(); toast('Saved'); render({ keepScroll: true });
    }
  });
}
function tdsRequestVars(pid, fy, qs) {
  const G = tdsGrid(fy), r = G.rows.find(x => x.p.id === pid), p = api.get('parties', pid);
  const cells = r ? r.qs.filter(c => qs.includes(c.q)) : [];
  const pad = (s, n, rt) => { s = String(s); return rt ? s.padStart(n) : s.padEnd(n); };
  const lines = [`${pad('Date', 13)}${pad('Invoice / ref', 26)}${pad('Amount', 14, 1)}${pad('TDS', 12, 1)}`, '-'.repeat(65), ...cells.flatMap(c => c.rr).map(e => `${pad(fmtDate(e.date), 13)}${pad((e.refNo || e.description || '').slice(0, 24), 26)}${pad(money(e.taxable), 14, 1)}${pad(money(e.tdsAmount), 12, 1)}`), '-'.repeat(65), `${pad('Total TDS', 53)}${pad(money(sum(cells, c => c.books)), 12, 1)}`];
  const gap = sum(cells.filter(c => c.gap > 10), c => c.gap);
  return { party: p.name, quarter: cells.map(c => FY_Q(c.q)).join(', ') + ' ' + fyLabel(fy), tds_table: lines.join('\n'), tds_gap: gap > 0 ? `As per our Form 26AS, ${money(gap)} of this TDS is not yet reflected against our PAN${Store.data.settings.gstin ? '' : ''}. Kindly check your TDS return and file a correction if needed.\n\n` : '', company: Store.data.settings.company };
}
function requestTds(pid, fy, qs) { composeCustom({ kind: 'tds_request', partyId: pid, vars: () => tdsRequestVars(pid, fy, qs), context: `TDS certificate request · ${nameOf('parties', pid)} · ${qs.map(FY_Q).join(', ')} ${fyLabel(fy)}`, entity: 'parties', entityId: pid }); }
/** A realistic TRACES 26AS text file built from the books, with one shortfall and one payer missing a TAN. */
function sample26AS(fy) {
  const [f, t] = fyRange(fy);
  const recs = Calc.inRange(f, t).filter(e => e.type === 'inflow' && +e.tdsAmount > 0 && e.partyId).sort((a, b) => a.date.localeCompare(b.date));
  const byP = {}; recs.forEach(e => (byP[e.partyId] = byP[e.partyId] || []).push(e));
  const L = ['Form 26AS^^^^', 'Annual Tax Statement^^^', `Permanent Account Number (PAN)^ABCDE1234F^Current Status of PAN^Active^Financial Year^${fyLabel(fy).replace('FY ', '')}^Assessment Year^${fy + 1}-${String(fy + 2).slice(2)}`, `Name of Assessee^${Store.data.settings.company.toUpperCase()}`, '', 'PART-I - Details of Tax Deducted at Source^^', 'Sr. No.^Name of Deductor^TAN of Deductor^^^^^Total Amount Paid / Credited(Rs.)^Total Tax Deducted #(Rs.)^Total TDS Deposited(Rs.)'];
  let sr = 0; const shortP = Object.keys(byP).find(id => id === 'cl_vl') || Object.keys(byP)[0];
  for (const [pid, es] of Object.entries(byP)) {
    const p = api.get('parties', pid); const tan = p.tan || (pid === 'ot_hdfc' ? 'MUMH03189E' : 'XXXX' + String(10000 + sr * 791).slice(-5) + 'X');
    let list = es.map(e => ({ e, tds: e.tdsAmount }));
    if (pid === shortP) { const last = list.filter(x => x.e.date <= addDays(TODAY, -45)).slice(-1)[0]; if (last) list = list.filter(x => x !== last); }
    const tot = sum(list, x => x.e.taxable + x.e.gstAmount), tds = sum(list, x => x.tds);
    sr++; L.push(`${sr}^${p.name.toUpperCase()}${pid === 'cl_zp' ? ' (INDIA)' : ''}^${pid === 'cl_zp' ? 'CHEZ06617B' : tan}^^^^^${tot.toFixed(2)}^${tds.toFixed(2)}^${tds.toFixed(2)}`);
    L.push('^Sr. No.^Section 1^Transaction Date^Status of Booking*^Date of Booking^Remarks**^Amount Paid / Credited(Rs.)^Tax Deducted ##(Rs.)^TDS Deposited(Rs.)');
    list.forEach((x, i) => { const d = x.e.date; L.push(`^${i + 1}^${pid === 'ot_hdfc' ? '194A' : '194J'}^${d.slice(8)}-${MON[+d.slice(5, 7) - 1]}-${d.slice(0, 4)}^F^${addDays(d, 40).slice(8)}-${MON[+addDays(d, 40).slice(5, 7) - 1]}-${addDays(d, 40).slice(0, 4)}^-^${(x.e.taxable + x.e.gstAmount).toFixed(2)}^${x.tds.toFixed(2)}^${x.tds.toFixed(2)}`); });
  }
  L.push('', 'PART-II - Details of Tax Deducted at Source for 15G / 15H^^', 'No Transactions Present', 'PART-III - Details of Transactions under Proviso to section 194B^^');
  return L.join('\n');
}
Object.assign(ACT, {
  'td-open': el => openTdsCell(el.dataset.id, +el.dataset.q),
  'td-sample': () => { const fy = S.fy; const txt = sample26AS(fy); import26AS(new File([txt], `ABCDE1234F-${fy + 1}.txt`, { type: 'text/plain' })); },
  'td-chase-all': async () => {
    const fy = S.fy, G = tdsGrid(fy); const by = {};
    G.rows.forEach(r => r.qs.forEach(c => { if (c.st === 'short' || c.certLate) (by[r.p.id] = by[r.p.id] || []).push(c.q); }));
    const ids = Object.keys(by).filter(id => emailRoute(api.get('parties', id), 'tds_request').to.length);
    const noMail = Object.keys(by).filter(id => !ids.includes(id));
    if (!await confirmBox({ title: `Request TDS certificates from ${ids.length} payer${ids.length > 1 ? 's' : ''}?`, body: `${ids.map(id => `<div>${esc(nameOf('parties', id))} · ${by[id].map(FY_Q).join(', ')}</div>`).join('')}${noMail.length ? `<div class="out" style="margin-top:8px">No email saved for ${noMail.map(id => esc(nameOf('parties', id))).join(', ')}</div>` : ''}<div class="hint" style="margin-top:8px">One email each goes to their Accounts contacts, listing the receipts and any amount missing from 26AS.</div>`, ok: 'Queue emails' })) return;
    const t = emailSettings().templates.tds_request || DEFAULT_EMAIL_TEMPLATES.tds_request; let n = 0;
    for (const id of ids) { const v = tdsRequestVars(id, fy, by[id]); const r = emailRoute(api.get('parties', id), 'tds_request'); await api.queueEmail({ kind: 'tds_request', entity: 'parties', entityId: id, partyId: id, to: r.to, cc: emailSettings().cc || [], subject: fillTemplate(t.subject, v), body: fillTemplate(t.body, v), attachments: [] }); n++; }
    toast(`${n} request${n > 1 ? 's' : ''} queued`); render({ keepScroll: true });
  },
});
document.addEventListener('change', async ev => {
  if (ev.target.id === 'tdFile' && ev.target.files[0]) { const f = ev.target.files[0]; ev.target.value = ''; import26AS(f); }
  const s = ev.target.closest && ev.target.closest('[data-act-chg="td-link"]');
  if (s && s.value) { const tan = s.dataset.tan, p = api.get('parties', s.value); (Store.data.tds26 || []).forEach(r => { if (r.tan === tan) r.partyId = p.id; }); if (!p.tan) await api.update('parties', p.id, { tan }, { summary: `TAN ${tan} saved for ${p.name}` }); Store.persist(); toast('Linked to ' + p.name); render({ keepScroll: true }); }
});
/* ============================ GST RETURNS: sales & purchase registers, GSTR-3B working, GSTR-2B match, CA pack ============================ */
/* Sales (outward) month = tax invoice date on the PI. A receipt before the invoice is an advance (GST due in the receipt month)
   and is adjusted in the invoice month. Credit notes reduce output tax in their own month. Exports (client state 99, no GST) are zero-rated under LUT.
   Purchases (inward) month = bill date on the vendor payment (entry.billDate, else payment date) plus bills logged before payment (gstBills).
   ITC set-off follows Rule 88A order; unused credit carries forward by head. Months go draft → sent → confirmed; a confirmed month rejects changes.
   BACKEND: GET /api/gst/:ym returns gstMonth(ym); POST /api/gst/:ym/send, /confirm, /reopen; POST /api/gst2b/:ym (file). */
IC.gst = '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h5M15 15l2 2 3-4"/>';
S.gst = { ym: null, tab: 'summary' };
const GST_STATUS = { draft: ['Draft', ''], sent: ['Sent to CA', 'gold'], confirmed: ['Confirmed', 'inflow'] };
const headsOf = (gstType, amt) => gstType === 'inter' ? { igst: r2(amt), cgst: 0, sgst: 0 } : gstType === 'none' ? { igst: 0, cgst: 0, sgst: 0 } : { igst: 0, cgst: r2(amt / 2), sgst: r2(amt - r2(amt / 2)) };
const ZERO = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });
const addH = (a, b, sign = 1) => { a.taxable = r2(a.taxable + sign * (b.taxable || 0)); a.igst = r2(a.igst + sign * b.igst); a.cgst = r2(a.cgst + sign * b.cgst); a.sgst = r2(a.sgst + sign * b.sgst); return a; };
const totH = h => r2(h.igst + h.cgst + h.sgst);
const normInv = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '').replace(/([A-Z])0+(\d)/g, '$1$2');
function gstState() { featureSettings(); return Store.data.settings.gst; }
function piSac(pi) { const c = api.get('categories', catForPI(pi)); return (c && c.sac) || '998391'; }
const isExportParty = p => p && (p.stateCode === '99' || (!p.gstin && p.gstType === 'none' && /usa|uae|uk|europe|inc\.?$|llc|gmbh/i.test(p.name + ' ' + (p.address || ''))));
const posOf = p => p ? (p.stateCode === '99' ? 'Outside India (96)' : p.stateCode ? `${IN_STATES[p.stateCode] || ''} (${p.stateCode})` : (p.gstin ? `${IN_STATES[p.gstin.slice(0, 2)] || ''} (${p.gstin.slice(0, 2)})` : '—')) : '—';
/** Outward rows for a month. */
function salesRows(ym) {
  const rows = [];
  const pis = api.list('pis').filter(p => p.status !== 'cancelled');
  for (const pi of pis) {
    const c = api.get('parties', pi.clientId), exp = (+pi.gstRate === 0 && isExportParty(c));
    if (pi.taxInvoiceDate && ymOf(pi.taxInvoiceDate) === ym) {
      const h = { taxable: +pi.taxable, ...headsOf(pi.gstType, +pi.gstAmount) };
      rows.push({ kind: exp ? 'export' : c && c.gstin ? 'b2b' : 'b2c', date: pi.taxInvoiceDate, no: pi.taxInvoiceNo || pi.piNo, piId: pi.id, party: c, sac: piSac(pi), rate: +pi.gstRate, ...h });
    }
    // receipts before the tax invoice month = advances; adjusted when the invoice is issued
    const recs = Calc.live().filter(e => e.type === 'inflow' && e.piId === pi.id && +e.gstAmount > 0);
    for (const e of recs) {
      const invYm = pi.taxInvoiceDate ? ymOf(pi.taxInvoiceDate) : null;
      if (!invYm || ymOf(e.date) < invYm) {
        if (ymOf(e.date) === ym) rows.push({ kind: 'advance', date: e.date, no: 'Receipt ' + (e.txnRef || e.refNo || ''), piId: pi.id, entryId: e.id, party: c, sac: piSac(pi), rate: +e.gstRate, taxable: +e.taxable, ...headsOf(e.gstType, +e.gstAmount) });
        if (invYm === ym) rows.push({ kind: 'adjust', date: pi.taxInvoiceDate, no: 'Advance adjusted · ' + (pi.taxInvoiceNo || ''), piId: pi.id, entryId: e.id, party: c, sac: piSac(pi), rate: +e.gstRate, taxable: -e.taxable, ...Object.fromEntries(Object.entries(headsOf(e.gstType, +e.gstAmount)).map(([k, v]) => [k, -v])) });
      }
    }
  }
  // receipts from clients with GST that aren't linked to any PI: treated as advances (no invoice yet)
  Calc.live().filter(e => e.type === 'inflow' && !e.piId && +e.gstAmount > 0 && ymOf(e.date) === ym).forEach(e => {
    const c = api.get('parties', e.partyId); rows.push({ kind: 'advance', date: e.date, no: 'Receipt ' + (e.refNo || e.txnRef || ''), entryId: e.id, party: c, sac: (api.get('categories', e.categoryId) || {}).sac || '998391', rate: +e.gstRate, taxable: +e.taxable, ...headsOf(e.gstType, +e.gstAmount), noPI: true });
  });
  (Store.data.creditNotes || []).filter(x => !x.deleted && ymOf(x.date) === ym).forEach(cn => {
    const pi = api.get('pis', cn.piId), c = api.get('parties', cn.clientId);
    rows.push({ kind: 'cn', date: cn.date, no: cn.cnNo + (pi ? ' (against ' + (pi.taxInvoiceNo || pi.piNo) + ')' : ''), piId: cn.piId, cnId: cn.id, party: c, sac: pi ? piSac(pi) : '998391', rate: +cn.gstRate, taxable: -cn.taxable, ...Object.fromEntries(Object.entries(headsOf(cn.gstType, +cn.gstAmount)).map(([k, v]) => [k, -v])) });
  });
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
/** Inward rows for a month: paid bills by bill date, plus bills logged before payment. */
function purchaseRows(ym) {
  const es = Calc.live().filter(e => e.type === 'outflow' && +e.gstAmount > 0 && ymOf(e.billDate || e.date) === ym);
  const rows = es.map(e => { const p = api.get('parties', e.partyId); return { src: 'entry', id: e.id, entryId: e.id, date: e.billDate || e.date, paidOn: e.date, no: e.refNo || '', party: p, gstin: p ? p.gstin : '', category: nameOf('categories', e.categoryId), rate: +e.gstRate, taxable: +e.taxable, ...headsOf(e.gstType, +e.gstAmount), eligible: !!e.itc }; });
  const paidKeys = new Set(Calc.live().filter(e => e.type === 'outflow' && e.refNo).map(e => e.partyId + '|' + normInv(e.refNo)));
  (Store.data.gstBills || []).filter(b => !b.deleted && ymOf(b.billDate) === ym && !paidKeys.has(b.vendorId + '|' + normInv(b.billNo))).forEach(b => {
    const p = api.get('parties', b.vendorId); rows.push({ src: 'bill', id: b.id, billId: b.id, date: b.billDate, paidOn: null, no: b.billNo, party: p, gstin: p ? p.gstin : (b.gstin || ''), category: nameOf('categories', b.categoryId) || 'Bill (unpaid)', rate: +b.gstRate, taxable: +b.taxable, ...headsOf(b.gstType, +b.gstAmount), eligible: b.itc !== false });
  });
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
const _gstCache = new Map();
/** Full working for a month, including credit carried in from earlier months. */
function gstMonth(ym) {
  const key = ym + '|' + Store.data.audit.length + '|' + (Store.data.gst2b || []).length;
  if (_gstCache.has(key)) return _gstCache.get(key);
  const G = gstState(), start = ymOf(Store.data.settings.openingDate || '2025-04-01');
  let carry = { igst: +G.openingCredit.igst || 0, cgst: +G.openingCredit.cgst || 0, sgst: +G.openingCredit.sgst || 0 };
  let res = null;
  for (let m = start; m <= ym; m = addMonths(m, 1)) {
    const prevKey = m + '|' + Store.data.audit.length + '|' + (Store.data.gst2b || []).length;
    let r = _gstCache.get(prevKey);
    if (!r || m === ym) r = computeGstMonth(m, carry);
    _gstCache.set(prevKey, r); carry = r.carryOut; res = r;
  }
  if (_gstCache.size > 200) _gstCache.clear();
  return res;
}
function computeGstMonth(ym, carryIn) {
  const sales = salesRows(ym), purch = purchaseRows(ym);
  const by = k => sales.filter(r => r.kind === k).reduce((a, r) => addH(a, r), ZERO());
  const inv = addH(by('b2b'), by('b2c')), adv = by('advance'), adj = by('adjust'), cn = by('cn'), exp = by('export');
  const out = addH(addH(addH(addH(ZERO(), inv), adv), adj), cn);
  const itc = purch.filter(r => r.eligible).reduce((a, r) => addH(a, r), ZERO()), blocked = purch.filter(r => !r.eligible).reduce((a, r) => addH(a, r), ZERO());
  // Rule 88A set-off: IGST credit → IGST, CGST, SGST; CGST credit → CGST, IGST; SGST credit → SGST, IGST
  const L = { igst: Math.max(0, out.igst), cgst: Math.max(0, out.cgst), sgst: Math.max(0, out.sgst) };
  const C = { igst: r2(carryIn.igst + itc.igst + Math.max(0, -out.igst)), cgst: r2(carryIn.cgst + itc.cgst + Math.max(0, -out.cgst)), sgst: r2(carryIn.sgst + itc.sgst + Math.max(0, -out.sgst)) };
  const used = { igst: { igst: 0, cgst: 0, sgst: 0 }, cgst: { igst: 0, cgst: 0, sgst: 0 }, sgst: { igst: 0, cgst: 0, sgst: 0 } };
  const use = (from, to) => { const x = Math.min(C[from], L[to]); C[from] = r2(C[from] - x); L[to] = r2(L[to] - x); used[from][to] = r2(used[from][to] + x); };
  use('igst', 'igst'); use('igst', 'cgst'); use('igst', 'sgst'); use('cgst', 'cgst'); use('cgst', 'igst'); use('sgst', 'sgst'); use('sgst', 'igst');
  const cash = { igst: r2(L.igst), cgst: r2(L.cgst), sgst: r2(L.sgst) }; cash.total = r2(cash.igst + cash.cgst + cash.sgst);
  const paidE = Calc.live().filter(e => e.categoryId === 'cat_gstpay' && taxPeriodOf(e) === ym);
  const st = (Store.data.gstMonths || {})[ym] || { status: 'draft' };
  return { ym, sales, purch, inv, adv, adj, cn, exp, out, itc, blocked, carryIn: { ...carryIn }, used, cash, carryOut: { igst: C.igst, cgst: C.cgst, sgst: C.sgst }, paid: r2(sum(paidE, e => e.amount)), paidEntries: paidE, status: st };
}
/** Points the CA should see before filing. */
function gstChecks(M) {
  const out = [];
  M.purch.filter(r => r.eligible && (!r.party || !r.party.gstin)).forEach(r => out.push({ sev: 'high', t: `GST claimed on a bill from ${r.party ? r.party.name : 'a vendor'} with no GSTIN`, d: `${r.no || 'No bill no.'} · ${fmtDate(r.date)} · ITC ${money(totH(r))}. An unregistered vendor can't charge GST; correct the bill or mark ITC ineligible.`, act: r.entryId ? ['open-entry', r.entryId] : null }));
  M.purch.filter(r => r.party && r.party.gstin && r.party.gstin.length >= 2).forEach(r => { const same = r.party.gstin.slice(0, 2) === HOME_STATE; if ((same && r.igst) || (!same && (r.cgst || r.sgst))) out.push({ sev: 'med', t: `Tax type looks wrong on ${r.party.name}'s bill`, d: `${r.no} · vendor is in ${IN_STATES[r.party.gstin.slice(0, 2)] || 'another state'}, bill shows ${r.igst ? 'IGST' : 'CGST + SGST'}.`, act: r.entryId ? ['open-entry', r.entryId] : null }); });
  M.purch.filter(r => !r.no).forEach(r => out.push({ sev: 'med', t: `Bill no. missing · ${r.party ? r.party.name : ''}`, d: `${fmtDate(r.date)} · ${money(r.taxable)}. Needed to match GSTR-2B.`, act: r.entryId ? ['open-entry', r.entryId] : null }));
  M.sales.filter(r => r.kind === 'advance' && !(r.piId && (api.get('pis', r.piId) || {}).taxInvoiceDate)).forEach(r => out.push({ sev: 'med', t: `Advance received without a tax invoice · ${r.party ? r.party.name : ''}`, d: `${fmtDate(r.date)} · GST ${money(totH(r))} is payable this month as an advance. Issue the tax invoice to adjust it.`, act: r.piId ? ['open-pi', r.piId] : null }));
  M.sales.filter(r => r.kind === 'b2c' && r.party && !isExportParty(r.party)).forEach(r => out.push({ sev: 'low', t: `Invoice to ${r.party.name} has no client GSTIN`, d: `${r.no} will be reported as B2C. Add their GSTIN if they are registered.`, act: ['open-party', r.party.id] }));
  if (M.exp.taxable && !gstState().lut) out.push({ sev: 'high', t: 'Export invoices without an LUT on record', d: 'Zero-rated exports without GST need a valid LUT for the year. Add the LUT ARN in GST settings.', act: null });
  const b2 = (Store.data.gst2b || []).filter(x => x.ym === M.ym);
  if (!b2.length && M.ym < ymOf(TODAY)) out.push({ sev: 'low', t: 'GSTR-2B not uploaded', d: 'Upload it to confirm every input credit appears on the portal before filing.', act: ['gst-tab', '2b'] });
  else if (b2.length) { const R = match2B(M); if (R.booksOnly.length) out.push({ sev: 'high', t: `${R.booksOnly.length} bill${R.booksOnly.length > 1 ? 's' : ''} not in GSTR-2B · ITC at risk ${money(sum(R.booksOnly, r => totH(r)))}`, d: 'Credit is allowed only when the bill appears in GSTR-2B (Rule 36(4)). Ask the vendors to file.', act: ['gst-tab', '2b'] }); if (R.portalOnly.length) out.push({ sev: 'med', t: `${R.portalOnly.length} bill${R.portalOnly.length > 1 ? 's' : ''} in GSTR-2B but not in the books`, d: `ITC ${money(sum(R.portalOnly, x => x.igst + x.cgst + x.sgst))} you may be missing.`, act: ['gst-tab', '2b'] }); }
  if (M.cash.total > 0 && M.paid && Math.abs(M.paid - M.cash.total) > 1) out.push({ sev: 'med', t: `GST paid ${money(M.paid)} differs from the working ${money(M.cash.total)}`, d: 'Check the challan or the entries in this month.', act: null });
  return out;
}
/* ---------- GSTR-2B ---------- */
function parse2B(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const c = rows[i].map(x => String(x).toLowerCase().replace(/\s+/g, ' ').trim());
    const ix = rx => c.findIndex(x => rx.test(x));
    const m = { gstin: ix(/gstin/), name: ix(/trade|legal name|supplier name|name of supplier/), no: ix(/invoice (number|no)|note (number|no)|document (number|no)/), date: ix(/invoice date|note date|document date|^date/), taxable: ix(/taxable/), igst: ix(/integrated|igst/), cgst: ix(/central|cgst/), sgst: ix(/state|sgst|ut tax/), avail: ix(/itc availab/) };
    if (m.gstin >= 0 && m.no >= 0 && m.taxable >= 0) {
      const out = [];
      for (let j = i + 1; j < rows.length; j++) {
        const r = rows[j], g = String(r[m.gstin] || '').trim().toUpperCase(); if (!GSTIN_RE.test(g)) continue;
        const num = k => m[k] >= 0 ? Math.abs(parseBankAmt(r[m[k]]) || 0) : 0;
        out.push({ gstin: g, name: m.name >= 0 ? String(r[m.name] || '').trim() : '', no: String(r[m.no] || '').trim(), date: m.date >= 0 ? parseBankDate(r[m.date]) : null, taxable: num('taxable'), igst: num('igst'), cgst: num('cgst'), sgst: num('sgst'), avail: m.avail >= 0 ? String(r[m.avail] || '').trim() : 'Yes' });
      }
      return out;
    }
  }
  return null;
}
function match2B(M) {
  const portal = (Store.data.gst2b || []).filter(x => x.ym === M.ym);
  const books = M.purch.filter(r => r.eligible);
  const used = new Set(), res = { matched: [], booksOnly: [], portalOnly: [] };
  for (const r of books) {
    const g = r.party && r.party.gstin; let hit = null;
    if (g) hit = portal.find(x => !used.has(x.id) && x.gstin === g && normInv(x.no) === normInv(r.no)) || portal.find(x => !used.has(x.id) && x.gstin === g && Math.abs(x.taxable - r.taxable) <= 1);
    if (hit) { used.add(hit.id); const diff = r2(totH(r) - (hit.igst + hit.cgst + hit.sgst)); res.matched.push({ r, x: hit, diff, byNo: normInv(hit.no) === normInv(r.no) }); } else res.booksOnly.push(r);
  }
  res.portalOnly = portal.filter(x => !used.has(x.id));
  return res;
}
async function import2B(file, ym) {
  let rows; try { const raw = await readSheetRows(file); rows = parse2B(raw); } catch (err) { return toast(err.message, 'error'); }
  if (!rows || !rows.length) return toast('No B2B invoices found. Use the GSTR-2B Excel downloaded from the GST portal.', 'error');
  Store.data.gst2b = (Store.data.gst2b || []).filter(x => x.ym !== ym);
  rows.forEach(r => Store.data.gst2b.push({ id: uid('g2b'), ym, ...r }));
  api.log('create', 'gst2b', ym, `GSTR-2B uploaded for ${monthLabel(ym, true)} · ${rows.length} invoices`); Store.persist();
  S.gst.tab = '2b'; render({ keepScroll: true }); toast(`GSTR-2B for ${monthLabel(ym, true)}: ${rows.length} invoices`);
}
function sample2B(ym) {
  const M = gstMonth(ym), rows = [['', '', '', 'Invoice details', '', '', '', '', '', 'Tax amount'], ['GSTIN of supplier', 'Trade/Legal name', 'Invoice number', 'Invoice type', 'Invoice Date', 'Invoice Value(₹)', 'Place of supply', 'Supply Attract Reverse Charge', 'Taxable Value (₹)', 'Integrated Tax(₹)', 'Central Tax(₹)', 'State/UT Tax(₹)', 'Cess(₹)', 'GSTR-1/IFF/GSTR-5 Period', 'GSTR-1/IFF/GSTR-5 Filing Date', 'ITC Availability']];
  const elig = M.purch.filter(r => r.eligible && r.party && r.party.gstin);
  elig.forEach((r, i) => {
    if (i === Math.floor(elig.length / 2)) return;
    const no = i === 1 ? String(r.no).replace(/\//g, '-') : r.no, d = r.date;
    rows.push([r.party.gstin, r.party.name.toUpperCase(), no, 'Regular', `${d.slice(8)}-${d.slice(5, 7)}-${d.slice(0, 4)}`, (r.taxable + totH(r)).toFixed(2), IN_STATES[r.party.gstin.slice(0, 2)] || '', 'No', r.taxable.toFixed(2), r.igst.toFixed(2), r.cgst.toFixed(2), r.sgst.toFixed(2), '0.00', monthLabel(ym, true), addDays(ymDate(addMonths(ym, 1), 11), 0), 'Yes']);
  });
  rows.push(['27AAPCA1234K1Z9', 'APEX STATIONERS LLP', 'APX/2627/0412', 'Regular', `14-${ym.slice(5)}-${ym.slice(0, 4)}`, '7080.00', 'Maharashtra', 'No', '6000.00', '0.00', '540.00', '540.00', '0.00', monthLabel(ym, true), '', 'Yes']);
  return rows.map(r => r.map(c => /[",]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c).join(',')).join('\n');
}
/* ---------- tax invoices & credit notes ---------- */
function nextDocNo(prefix, fy, list) {
  const yy = `${String(fy % 100).padStart(2, '0')}-${String((fy + 1) % 100).padStart(2, '0')}`;
  const nums = list.filter(n => n && n.includes(yy)).map(n => +(String(n).match(/(\d+)\s*$/) || [0, 0])[1] || 0);
  return `${prefix}${yy}/${String(Math.max(0, ...nums) + 1).padStart(3, '0')}`;
}
const nextInvoiceNo = date => nextDocNo(gstState().invPrefix || 'INV/', fyOf(date), api.list('pis').map(p => p.taxInvoiceNo).filter(n => /^INV|^TI/.test(n || '')));
const nextCNNo = date => nextDocNo(gstState().cnPrefix || 'CN/', fyOf(date), (Store.data.creditNotes || []).map(c => c.cnNo));
function gstLocked(ym) { const s = (Store.data.gstMonths || {})[ym]; return s && s.status === 'confirmed'; }
function assertGstOpen(yms, what) { const y = [...new Set(yms.filter(Boolean))].find(gstLocked); if (y) throw new Error(`GST for ${monthLabel(y, true)} is confirmed by the CA. Reopen it in GST returns before changing ${what}.`); }
async function issueTaxInvoice(piId, date, no) {
  const pi = api.get('pis', piId); if (!pi) return;
  assertGstOpen([ymOf(date)], 'this invoice');
  no = no || nextInvoiceNo(date);
  if (api.list('pis').some(p => p.id !== piId && p.taxInvoiceNo === no)) throw new Error('Tax invoice no. ' + no + ' is already used');
  await api.update('pis', piId, { taxInvoiceNo: no, taxInvoiceDate: date }, { summary: `Tax invoice ${no} issued for PI ${pi.piNo} · ${fmtDate(date)}` });
  return no;
}
function taxInvoiceModal(piId) {
  const pi = api.get('pis', piId); const d0 = (Sales.piCollected(pi).entries[0] || {}).date || TODAY;
  const ov = openModal(`<div class="modal-h"><h2>Issue tax invoice</h2><span class="muted" style="font-size:12.5px">${esc(pi.piNo)}</span></div><div class="modal-b"><div class="fgrid c2">
    <div class="field"><label>Invoice date</label><input class="input" type="date" id="tiDate" value="${d0 > TODAY ? TODAY : d0}"><div class="hint">GST on ${money(pi.taxable)} falls in this month</div></div>
    <div class="field"><label>Invoice no.</label><input class="input mono" id="tiNo" value="${esc(nextInvoiceNo(d0))}"></div></div></div>
    <div class="modal-f"><button class="btn" data-x="no">Cancel</button><button class="btn btn-gold" data-x="yes">Issue</button></div>`, 'sm');
  $('#tiDate', ov).addEventListener('change', ev => { $('#tiNo', ov).value = nextInvoiceNo(ev.target.value); });
  ov.addEventListener('click', async ev => { const b = ev.target.closest('[data-x]'); if (!b) return; if (b.dataset.x === 'no') return ov.remove(); try { const no = await issueTaxInvoice(piId, $('#tiDate', ov).value, $('#tiNo', ov).value.trim()); ov.remove(); toast('Tax invoice ' + no + ' issued'); openPI(piId); } catch (err) { toast(err.message, 'error'); } });
}
function creditNoteModal(piId) {
  const pi = api.get('pis', piId);
  const done = sum((Store.data.creditNotes || []).filter(x => !x.deleted && x.piId === piId), x => x.taxable);
  const ov = openModal(`<div class="modal-h"><h2>Credit note</h2><span class="muted" style="font-size:12.5px">against ${esc(pi.taxInvoiceNo)}</span></div><div class="modal-b"><div class="fgrid c2">
    <div class="field"><label>Date</label><input class="input" type="date" id="cnDate" value="${TODAY}"></div><div class="field"><label>Credit note no.</label><input class="input mono" id="cnNo" value="${esc(nextCNNo(TODAY))}"></div>
    <div class="field"><label>Value before GST (₹)</label><input class="input num" type="number" id="cnAmt" min="0" max="${pi.taxable - done}" step="0.01"><div class="hint">Up to ${money(pi.taxable - done)} · GST ${pi.gstRate}% added</div></div>
    <div class="field"><label>Reason</label><select class="select" id="cnWhy">${opts([['Discount', 'Discount after invoice'], ['Scope reduced', 'Scope reduced'], ['Cancelled', 'Invoice cancelled'], ['Correction', 'Correction of value']], 'Discount')}</select></div></div>
    <div class="hint">Reduces output GST in the credit note's month and the balance due on the PI.</div></div>
    <div class="modal-f"><button class="btn" data-x="no">Cancel</button><button class="btn btn-gold" data-x="yes">Save credit note</button></div>`, 'sm');
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-x]'); if (!b) return; if (b.dataset.x === 'no') return ov.remove();
    const amt = r2(+$('#cnAmt', ov).value || 0), date = $('#cnDate', ov).value;
    if (!(amt > 0) || amt > pi.taxable - done + 0.01) return toast('Enter a value up to ' + money(pi.taxable - done), 'error');
    try { assertGstOpen([ymOf(date)], 'credit notes');
      await api.create('creditNotes', { piId, clientId: pi.clientId, date, cnNo: $('#cnNo', ov).value.trim(), taxable: amt, gstRate: pi.gstRate, gstType: pi.gstType, gstAmount: r2(amt * pi.gstRate / 100), reason: $('#cnWhy', ov).value, deleted: false }, { summary: `Credit note ${$('#cnNo', ov).value.trim()} · ${money(amt)} against ${pi.taxInvoiceNo}` });
      ov.remove(); toast('Credit note saved'); openPI(piId); } catch (err) { toast(err.message, 'error'); }
  });
}
function gstSectionHTML(pi) {
  if (pi.status === 'cancelled') return '';
  const can = api.can('gst.edit'), cns = (Store.data.creditNotes || []).filter(x => !x.deleted && x.piId === pi.id);
  return `<div class="fsec-h" style="margin-top:22px">GST</div><div class="rm-box">${pi.taxInvoiceNo && pi.taxInvoiceDate ? `<div class="row" style="gap:8px;flex-wrap:wrap"><span class="chip inflow">Tax invoice ${esc(pi.taxInvoiceNo)}</span><span class="muted" style="font-size:12.5px">${fmtDate(pi.taxInvoiceDate)} · GST in ${monthLabel(ymOf(pi.taxInvoiceDate), true)}${gstLocked(ymOf(pi.taxInvoiceDate)) ? ' · confirmed' : ''}</span></div>` : `<div class="muted" style="font-size:13px">No tax invoice yet. ${Sales.piCollected(pi).entries.length ? '<span class="out">Payment received — GST is due as an advance until you issue it.</span>' : 'Issue it when the client pays (or earlier if agreed).'}</div>`}
    ${cns.map(c => `<div class="list-row" style="padding:6px 0"><span class="grow" style="font-size:13px">Credit note ${esc(c.cnNo)} · ${fmtDate(c.date)} · ${esc(c.reason)}</span><span class="num out">−${money(c.taxable + c.gstAmount)}</span></div>`).join('')}
    ${can ? `<div class="row" style="gap:8px;margin-top:8px">${!pi.taxInvoiceDate ? `<button class="btn btn-sm" data-act="gst-ti" data-id="${pi.id}">Issue tax invoice</button>` : `<button class="btn btn-sm btn-ghost" data-act="gst-cn" data-id="${pi.id}">Issue credit note</button>`}</div>` : ''}</div>`;
}
/* lock: entries that touch a confirmed GST month */
(() => {
  const gm = e => !e ? [] : e.type === 'outflow' && +e.gstAmount > 0 ? [ymOf(e.billDate || e.date)] : e.type === 'inflow' && +e.gstAmount > 0 ? (() => { const pi = e.piId && api.get('pis', e.piId); return [!pi || !pi.taxInvoiceDate || ymOf(e.date) < ymOf(pi.taxInvoiceDate) ? ymOf(e.date) : null]; })() : [];
  const save = api.saveEntry.bind(api), del = api.softDelete.bind(api);
  api.saveEntry = async (input, id) => { const old = id ? api.get('entries', id) : null; const n = api.normaliseEntry(input); const touches = old ? ['gstAmount', 'taxable', 'gstRate', 'gstType', 'itc', 'billDate', 'date', 'refNo', 'partyId', 'piId'].some(k => String(old[k] ?? '') !== String(n[k] ?? '')) : true; if (touches) assertGstOpen([...gm(old), ...gm(n)], 'this entry'); return save(input, id); };
  api.softDelete = async id => { assertGstOpen(gm(api.get('entries', id)), 'this entry'); return del(id); };
})();
/* ---------- Excel pack ---------- */
function gstPackSheets(ym) {
  const M = gstMonth(ym), co = Store.data.settings.company, gstin = Store.data.settings.gstin || '';
  const H = h => [h.taxable, h.igst, h.cgst, h.sgst, r2(h.igst + h.cgst + h.sgst)];
  const summary = [[`${co} · GSTIN ${gstin}`], [`GST working for ${monthLabel(ym, true)} · prepared ${fmtDate(TODAY)} · status ${GST_STATUS[M.status.status || 'draft'][0]}`], [],
    ['Section', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Total tax'],
    ['3.1(a) Tax invoices (B2B + B2C)', ...H(M.inv)], ['  Advances received (no invoice yet)', ...H(M.adv)], ['  Less: advances adjusted', ...H(M.adj)], ['  Less: credit notes', ...H(M.cn)], ['Net output tax', ...H(M.out)],
    ['3.1(b) Zero-rated exports under LUT', M.exp.taxable, 0, 0, 0, 0], [],
    ['4(A)(5) Eligible ITC (bills)', ...H(M.itc)], ['4(D) Ineligible / blocked ITC', ...H(M.blocked)], ['Credit brought forward', '', M.carryIn.igst, M.carryIn.cgst, M.carryIn.sgst, r2(M.carryIn.igst + M.carryIn.cgst + M.carryIn.sgst)], [],
    ['Payable in cash', '', M.cash.igst, M.cash.cgst, M.cash.sgst, M.cash.total], ['Credit carried forward', '', M.carryOut.igst, M.carryOut.cgst, M.carryOut.sgst, r2(M.carryOut.igst + M.carryOut.cgst + M.carryOut.sgst)], ['GST paid (challans recorded)', '', '', '', '', M.paid], [],
    ['Set-off (credit used)', 'From IGST', 'From CGST', 'From SGST'], ['Against IGST', M.used.igst.igst, M.used.cgst.igst, M.used.sgst.igst], ['Against CGST', M.used.igst.cgst, M.used.cgst.cgst, 0], ['Against SGST', M.used.igst.sgst, 0, M.used.sgst.sgst]];
  const KIND = { b2b: 'B2B', b2c: 'B2C', export: 'Export (LUT)', advance: 'Advance', adjust: 'Advance adjusted', cn: 'Credit note' };
  const sales = [['Type', 'Date', 'Invoice / document', 'Client', 'Client GSTIN', 'Place of supply', 'SAC', 'Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Invoice value'], ...M.sales.map(r => [KIND[r.kind], fmtDate(r.date), r.no, r.party ? r.party.name : '', r.party ? r.party.gstin || '' : '', posOf(r.party), r.sac, r.rate, r.taxable, r.igst, r.cgst, r.sgst, r2(r.taxable + totH(r))]), ['', '', 'Total', '', '', '', '', '', ...H(M.sales.reduce((a, r) => addH(a, r), ZERO())).slice(0, 4), '']];
  const pur = [['Bill date', 'Bill no.', 'Vendor', 'Vendor GSTIN', 'Category', 'Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST', 'ITC', 'Paid on'], ...M.purch.map(r => [fmtDate(r.date), r.no, r.party ? r.party.name : '', r.party ? r.party.gstin || '' : '', r.category, r.rate, r.taxable, r.igst, r.cgst, r.sgst, r.eligible ? 'Eligible' : 'Ineligible', r.paidOn ? fmtDate(r.paidOn) : 'Unpaid'])];
  const sac = {}; M.sales.filter(r => r.kind !== 'export').forEach(r => { const k = r.sac + '|' + r.rate; sac[k] = addH(sac[k] || ZERO(), r); });
  M.sales.filter(r => r.kind === 'export').forEach(r => { const k = r.sac + '|0'; sac[k] = addH(sac[k] || ZERO(), r); });
  const hsn = [['SAC', 'Description', 'Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Total tax'], ...Object.entries(sac).map(([k, h]) => { const [code, rate] = k.split('|'); return [code, SAC_DESC[code] || '', +rate, h.taxable, h.igst, h.cgst, h.sgst, totH(h)]; })];
  const parties = [['Clients', 'GSTIN', 'Taxable value', 'Output tax'], ...partyTotals(M.sales).map(x => [x.p ? x.p.name : '', x.p ? x.p.gstin || '' : '', x.h.taxable, totH(x.h)]), [], ['Vendors', 'GSTIN', 'Taxable value', 'ITC eligible', 'ITC ineligible'], ...vendorTotals(M.purch).map(x => [x.p ? x.p.name : '', x.p ? x.p.gstin || '' : '', x.t, x.e, x.b])];
  const sheets = [['Summary 3B', summary], ['Sales register', sales], ['Purchase register', pur], ['SAC summary', hsn], ['Party-wise', parties]];
  if ((Store.data.gst2b || []).some(x => x.ym === ym)) { const R = match2B(M); sheets.push(['GSTR-2B match', [['Status', 'Vendor', 'GSTIN', 'Bill no. (books)', 'Invoice no. (2B)', 'Taxable', 'Tax (books)', 'Tax (2B)'], ...R.matched.map(m => ['Matched', m.r.party.name, m.r.party.gstin, m.r.no, m.x.no, m.r.taxable, totH(m.r), r2(m.x.igst + m.x.cgst + m.x.sgst)]), ...R.booksOnly.map(r => ['Not in 2B', r.party ? r.party.name : '', r.party ? r.party.gstin : '', r.no, '', r.taxable, totH(r), '']), ...R.portalOnly.map(x => ['Only in 2B', x.name, x.gstin, '', x.no, x.taxable, '', r2(x.igst + x.cgst + x.sgst)])]]); }
  const ch = gstChecks(M); if (ch.length) sheets.push(['Open points', [['Priority', 'Point', 'Detail'], ...ch.map(c => [c.sev, c.t, c.d])]]);
  return sheets;
}
const SAC_DESC = { '998391': 'Specialty design services (incl. industrial design)', '998333': 'Industrial engineering services', '998393': 'Technical consulting', '998331': 'Engineering advisory services', '998311': 'Management consulting' };
function partyTotals(rows) { const m = new Map(); rows.forEach(r => { const k = r.party ? r.party.id : '_'; const x = m.get(k) || { p: r.party, h: ZERO() }; addH(x.h, r); m.set(k, x); }); return [...m.values()].sort((a, b) => b.h.taxable - a.h.taxable); }
function vendorTotals(rows) { const m = new Map(); rows.forEach(r => { const k = r.party ? r.party.id : '_'; const x = m.get(k) || { p: r.party, t: 0, e: 0, b: 0 }; x.t = r2(x.t + r.taxable); if (r.eligible) x.e = r2(x.e + totH(r)); else x.b = r2(x.b + totH(r)); m.set(k, x); }); return [...m.values()].sort((a, b) => b.t - a.t); }
const xmlEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
async function gstPackFile(ym) {
  const sheets = gstPackSheets(ym), name = `GST-working-${ym}-${(Store.data.settings.company || 'IUOVA').split(' ')[0]}`;
  try {
    await loadXLSX();
    const wb = XLSX.utils.book_new();
    sheets.forEach(([n, aoa]) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = (aoa[3] || aoa[0] || []).map((_, i) => ({ wch: i === 0 ? 34 : i < 6 ? 18 : 14 })); XLSX.utils.book_append_sheet(wb, ws, n.slice(0, 31)); });
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new File([buf], name + '.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  } catch (e) {
    // offline fallback: Excel 2003 XML workbook (opens in Excel with all sheets)
    const cell = v => typeof v === 'number' ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>` : `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`;
    const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets.map(([n, aoa]) => `<Worksheet ss:Name="${xmlEsc(n.slice(0, 31))}"><Table>${aoa.map(r => `<Row>${r.map(cell).join('')}</Row>`).join('')}</Table></Worksheet>`).join('')}</Workbook>`;
    return new File([xml], name + '.xml', { type: 'application/vnd.ms-excel' });
  }
}
function downloadFile(f) { const url = URL.createObjectURL(f); const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500); }
function gstEmailVars(ym) {
  const M = gstMonth(ym), pad = (s, n, r) => { s = String(s); return r ? s.padStart(n) : s.padEnd(n); };
  const line = (l, h) => `${pad(l, 34)}${pad(money(h.igst), 13, 1)}${pad(money(h.cgst), 13, 1)}${pad(money(h.sgst), 13, 1)}`;
  const tbl = [`${pad('', 34)}${pad('IGST', 13, 1)}${pad('CGST', 13, 1)}${pad('SGST', 13, 1)}`, line('Output tax (net)', M.out), line('Eligible ITC', M.itc), line('Credit brought forward', M.carryIn), line('Payable in cash', M.cash), line('Credit carried forward', M.carryOut), '', `Sales (taxable): ${money(M.inv.taxable)} · Exports under LUT: ${money(M.exp.taxable)} · Purchases (taxable): ${money(sum(M.purch, r => r.taxable))}`, `Total GST payable in cash: ${money(M.cash.total)}`].join('\n');
  const ch = gstChecks(M).filter(c => c.sev !== 'low');
  return { month: monthLabel(ym, true), company: Store.data.settings.company, gst_summary: tbl, gst_checks: ch.length ? 'Points to note:\n' + ch.map(c => '• ' + c.t).join('\n') + '\n\n' : '' };
}
async function sendGstToCA(ym) {
  if (!api.can('gst.send')) return toast('Not allowed for your role', 'error');
  const G = gstState(); if (!G.caEmails || !G.caEmails.length) return toast('Add the CA\'s email in GST settings first', 'error');
  const f = await gstPackFile(ym); const meta = { id: uid('f'), name: f.name, type: f.type, size: f.size }; await FileStore.put({ ...meta, blob: f });
  const E = { kind: 'gst_pack', partyId: null, on: true, to: G.caEmails.slice(), newTo: '', saveNew: false, cc: (emailSettings().cc || []).join(', '), subject: '', body: '', edited: false, attachDocs: true, files: [], err: '' };
  refreshEmail(E, gstEmailVars(ym));
  const ov = openModal(`<div class="modal-h"><h2>Send GST working to CA</h2><span class="muted" style="font-size:12.5px">${monthLabel(ym, true)}</span><span class="spacer"></span><button class="icon-btn" data-c="close">${icon('x')}</button></div><div class="modal-b" id="gEm"></div>
    <div class="modal-f"><button class="btn" data-c="dl">${icon('file')} Download Excel</button><span class="spacer"></span><button class="btn" data-c="close">Cancel</button><button class="btn btn-gold" data-c="send">${icon('send')} Queue email</button></div>`, 'xl');
  const body = $('#gEm', ov); const draw = () => { body.innerHTML = `<div class="muted" style="font-size:13px;margin-bottom:10px">Attached: <b>${esc(f.name)}</b> (${Math.round(f.size / 1024)} KB · ${gstPackSheets(ym).length} sheets)</div>` + emailBoxHTML(E, { docs: 1, standalone: true }); };
  draw(); bindEmailEvents(body, () => E, draw);
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-c]'); if (!b) return;
    if (b.dataset.c === 'close') return ov.remove();
    if (b.dataset.c === 'dl') return downloadFile(f);
    try {
      checkEmail(E);
      const m = await api.queueEmail({ kind: 'gst_pack', entity: 'gstMonths', entityId: ym, partyId: null, to: E.to, cc: splitEmails(E.cc), subject: E.subject, body: E.body, attachments: [meta] });
      Store.data.gstMonths[ym] = { ...(Store.data.gstMonths[ym] || {}), status: 'sent', sentAt: nowISO(), emailId: m.id, by: api.me().id, snapshot: gstSnapshot(ym) };
      api.log('update', 'gstMonths', ym, `GST working for ${monthLabel(ym, true)} sent to CA (${E.to.join(', ')})`); Store.persist();
      ov.remove(); toast('Queued to ' + E.to.join(', ')); render({ keepScroll: true });
    } catch (err) { toast(err.message, 'error'); }
  });
}
function gstSnapshot(ym) { const M = gstMonth(ym); return { out: totH(M.out), itc: totH(M.itc), cash: M.cash.total, sales: M.sales.length, purch: M.purch.length, at: nowISO() }; }
/* ---------- page ---------- */
const gstMoney = v => v ? money(v) : '<span class="faint">–</span>';
PAGES.gst = {
  title: 'GST returns',
  render() {
    featureSettings();
    if (!S.gst.ym) S.gst.ym = addMonths(ymOf(TODAY), -1);
    const ym = S.gst.ym, M = gstMonth(ym), st = M.status.status || 'draft', can = api.can('gst.edit'), T = S.gst.tab;
    const fy = fyOf(ym + '-01'), months = fyMonths(fy).filter(m => m <= ymOf(TODAY));
    const strip = `<div class="gst-strip">${months.map(m => { const X = gstMonth(m), s2 = (X.status.status || 'draft'); return `<button class="gst-m ${m === ym ? 'on' : ''} ${s2}" data-act="gst-month" data-v="${m}"><span>${monthLabel(m)}</span><b class="num">${X.cash.total ? shortMoney(X.cash.total) : X.out.igst + X.out.cgst + X.out.sgst ? 'Nil' : '—'}</b><i class="gst-dot ${s2}"></i></button>`; }).join('')}</div>`;
    const changed = st !== 'draft' && M.status.snapshot && Math.abs(M.status.snapshot.cash - M.cash.total) > 1;
    const ch = gstChecks(M);
    const head = `<div class="bk-bar"><div class="row gst-nav" style="gap:8px"><button class="icon-btn" data-act="gst-step" data-v="-1" title="Previous month">${icon('chev').replace('<svg', '<svg style="transform:rotate(180deg)"')}</button><div><div style="font:600 18px var(--f-head)">${monthLabel(ym, true)}</div><div class="muted" style="font-size:12.5px">GSTR-1 due ${fmtDate(ymDate(addMonths(ym, 1), 11))} · GSTR-3B due ${fmtDate(ymDate(addMonths(ym, 1), 20))}</div></div><button class="icon-btn" data-act="gst-step" data-v="1" title="Next month" ${ym >= ymOf(TODAY) ? 'disabled' : ''}>${icon('chev')}</button>
      <span class="chip ${GST_STATUS[st][1]}" style="margin-left:6px">${GST_STATUS[st][0]}${st === 'sent' && M.status.sentAt ? ' · ' + fmtDate(M.status.sentAt.slice(0, 10)) : ''}${st === 'confirmed' && M.status.confirmedAt ? ' · ' + fmtDate(M.status.confirmedAt.slice(0, 10)) : ''}</span></div><span class="spacer"></span>
      <button class="btn btn-sm" data-act="gst-dl">${icon('file')} Download Excel</button>
      ${st !== 'confirmed' && api.can('gst.send') ? `<button class="btn btn-sm ${st === 'draft' ? 'btn-gold' : ''}" data-act="gst-send">${icon('send')} ${st === 'sent' ? 'Send again' : 'Send to CA'}</button>` : ''}
      ${st === 'sent' && api.can('gst.confirm') ? `<button class="btn btn-sm btn-navy" data-act="gst-confirm">${icon('check')} CA confirmed</button>` : ''}
      ${st === 'confirmed' && api.can('settings.edit') ? `<button class="btn btn-sm btn-ghost" data-act="gst-reopen">Reopen</button>` : ''}</div>`;
    const kpis = `<div class="grid g-kpi gst-kpis">
      <div class="card kpi"><div class="k-l">Output GST</div><div class="k-v">${money(totH(M.out))}</div><div class="k-s">on ${money(M.inv.taxable + M.adv.taxable + M.adj.taxable + M.cn.taxable)} taxable${M.exp.taxable ? ' + ' + money(M.exp.taxable) + ' exports' : ''}</div></div>
      <div class="card kpi"><div class="k-l">Input credit (ITC)</div><div class="k-v in">${money(totH(M.itc))}</div><div class="k-s">${M.purch.filter(r => r.eligible).length} bills${totH(M.blocked) ? ' · ' + money(totH(M.blocked)) + ' blocked' : ''}</div></div>
      <div class="card kpi accent"><div class="k-l">Payable in cash</div><div class="k-v">${money(M.cash.total)}</div><div class="k-s">after ${money(totH(M.carryIn))} credit b/f</div></div>
      <div class="card kpi"><div class="k-l">Paid</div><div class="k-v ${M.paid >= M.cash.total - 1 ? 'in' : 'out'}">${M.paid ? money(M.paid) : M.cash.total ? 'Not yet' : '—'}</div><div class="k-s">${M.paidEntries.map(e => fmtDate(e.date)).join(', ') || (M.cash.total ? 'Record it from Compliance' : 'Nothing to pay')}</div></div>
      <div class="card kpi"><div class="k-l">Credit carried forward</div><div class="k-v">${money(totH(M.carryOut))}</div><div class="k-s">IGST ${shortMoney(M.carryOut.igst)} · CGST ${shortMoney(M.carryOut.cgst)} · SGST ${shortMoney(M.carryOut.sgst)}</div></div></div>`;
    const banner = changed ? `<div class="notice" style="border-color:#F0C9C3;background:var(--out-soft)">${icon('alert')}<div><b>Figures changed after ${st === 'confirmed' ? 'confirmation' : 'sending'}.</b> Cash payable was ${money(M.status.snapshot.cash)}, now ${money(M.cash.total)}. ${st === 'sent' ? 'Send the working again.' : 'Reopen the month to review.'}</div></div>` : st === 'confirmed' ? `<div class="notice info">${icon('lock')}<div>Confirmed by the CA${M.status.note ? ' · ' + esc(M.status.note) : ''}. Entries, invoices and credit notes in this GST month can't be changed until the Owner reopens it.</div></div>` : '';
    const tabs = `<div class="tabs" style="margin-top:2px">${[['summary', 'GSTR-3B working'], ['sales', 'Sales', M.sales.length], ['purchases', 'Purchases', M.purch.length], ['sac', 'SAC summary'], ['party', 'Party-wise'], ['2b', 'GSTR-2B', (Store.data.gst2b || []).filter(x => x.ym === ym).length || ''], ['checks', 'Checks', ch.length]].map(([k, l, n]) => `<button class="${T === k ? 'on' : ''}" data-act="gst-tab" data-v="${k}">${l}${n !== undefined && n !== '' ? ` <span class="tw-n">${n}</span>` : ''}</button>`).join('')}</div>`;
    const hRow = (l, h, cls = '', taxable = true) => `<tr class="${cls}"><td>${l}</td><td class="num">${taxable ? gstMoney(h.taxable) : ''}</td><td class="num">${gstMoney(h.igst)}</td><td class="num">${gstMoney(h.cgst)}</td><td class="num">${gstMoney(h.sgst)}</td><td class="num"><b>${gstMoney(totH(h))}</b></td></tr>`;
    let body = '';
    if (T === 'summary') {
      body = `<div class="card"><div class="tbl-wrap"><table class="tbl gst-3b"><thead><tr><th></th><th class="num">Taxable</th><th class="num">IGST</th><th class="num">CGST</th><th class="num">SGST</th><th class="num">Total tax</th></tr></thead><tbody>
        <tr class="grp"><td colspan="6">Outward supplies · 3.1</td></tr>
        ${hRow('Tax invoices issued (B2B + B2C)', M.inv)}${M.adv.taxable ? hRow('Advances received, no invoice yet', M.adv) : ''}${M.adj.taxable ? hRow('Less: advances adjusted on invoicing', M.adj) : ''}${M.cn.taxable ? hRow('Less: credit notes', M.cn) : ''}
        ${hRow('Net output tax', M.out, 'tot')}
        <tr><td>Zero-rated exports under LUT · 3.1(b)</td><td class="num">${gstMoney(M.exp.taxable)}</td><td class="num" colspan="4"><span class="muted" style="font-size:12px">${gstState().lut ? 'LUT ' + esc(gstState().lut) : '<span class="out">No LUT on record</span>'}</span></td></tr>
        <tr class="grp"><td colspan="6">Input tax credit · 4</td></tr>
        ${hRow('Eligible ITC on bills · 4(A)(5)', M.itc)}${totH(M.blocked) ? hRow('Ineligible ITC (not claimed) · 4(D)', M.blocked, 'muted-row') : ''}
        ${hRow('Credit brought forward', { taxable: 0, ...M.carryIn }, '', false)}
        <tr class="grp"><td colspan="6">Set-off (Rule 88A order)</td></tr>
        <tr><td>Credit used against IGST</td><td></td><td class="num">${gstMoney(r2(M.used.igst.igst + M.used.cgst.igst + M.used.sgst.igst))}</td><td colspan="3" class="muted" style="font-size:12px">from IGST ${money(M.used.igst.igst)} · CGST ${money(M.used.cgst.igst)} · SGST ${money(M.used.sgst.igst)}</td></tr>
        <tr><td>Credit used against CGST</td><td></td><td></td><td class="num">${gstMoney(r2(M.used.igst.cgst + M.used.cgst.cgst))}</td><td colspan="2" class="muted" style="font-size:12px">from IGST ${money(M.used.igst.cgst)} · CGST ${money(M.used.cgst.cgst)}</td></tr>
        <tr><td>Credit used against SGST</td><td></td><td></td><td></td><td class="num">${gstMoney(r2(M.used.igst.sgst + M.used.sgst.sgst))}</td><td class="muted" style="font-size:12px">from IGST ${money(M.used.igst.sgst)} · SGST ${money(M.used.sgst.sgst)}</td></tr>
        ${hRow('Payable in cash', { taxable: 0, ...M.cash }, 'net', false)}${hRow('Credit carried forward', { taxable: 0, ...M.carryOut }, '', false)}
        </tbody></table></div></div>${ch.length ? `<div class="card"><div class="card-h"><div class="grow"><h3>Before sending to the CA</h3><div class="sub">${ch.length} point${ch.length > 1 ? 's' : ''} found in this month's records</div></div><button class="btn btn-sm" data-act="gst-tab" data-v="checks">See all</button></div>${ch.slice(0, 4).map(gstCheckRow).join('')}</div>` : ''}`;
    } else if (T === 'sales') {
      const KL = { b2b: ['B2B', 'inflow'], b2c: ['B2C', ''], export: ['Export · LUT', 'transfer'], advance: ['Advance', 'gold'], adjust: ['Adv. adjusted', ''], cn: ['Credit note', 'overdue'] };
      body = `<div class="card"><div class="card-h"><div class="grow"><h3>Sales register</h3><div class="sub">Tax invoices by invoice date, advances by receipt date, credit notes by their date</div></div></div><div class="tbl-wrap"><table class="tbl gst-reg"><thead><tr><th>Date</th><th>Document</th><th>Client · GSTIN</th><th>SAC</th><th class="num">Taxable</th><th class="num">IGST</th><th class="num">CGST</th><th class="num">SGST</th><th></th></tr></thead><tbody>
        ${M.sales.map(r => `<tr ${r.piId ? `data-act="open-pi" data-id="${r.piId}" style="cursor:pointer"` : r.entryId ? `data-act="open-entry" data-id="${r.entryId}" style="cursor:pointer"` : ''}><td class="nowrap">${fmtDate(r.date)}</td><td class="mono" style="font-size:12px">${esc(r.no)}</td><td><div class="cell-main">${esc(r.party ? r.party.name : '—')}</div><div class="cell-sub mono">${esc(r.party ? r.party.gstin || (isExportParty(r.party) ? 'Overseas' : 'Unregistered') : '')} · ${esc(posOf(r.party))}</div></td><td class="mono" style="font-size:12px">${esc(r.sac)}</td><td class="num">${money(r.taxable)}</td><td class="num">${gstMoney(r.igst)}</td><td class="num">${gstMoney(r.cgst)}</td><td class="num">${gstMoney(r.sgst)}</td><td><span class="chip ${KL[r.kind][1]}">${KL[r.kind][0]}</span></td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">No sales documents in this month.</div></td></tr>'}
        </tbody>${M.sales.length ? `<tfoot><tr><td colspan="4">Total</td><td class="num">${money(sum(M.sales, r => r.taxable))}</td><td class="num">${money(sum(M.sales, r => r.igst))}</td><td class="num">${money(sum(M.sales, r => r.cgst))}</td><td class="num">${money(sum(M.sales, r => r.sgst))}</td><td></td></tr></tfoot>` : ''}</table></div></div>`;
    } else if (T === 'purchases') {
      const R = (Store.data.gst2b || []).some(x => x.ym === ym) ? match2B(M) : null; const s2b = r => !R ? '' : R.matched.some(m => m.r === r) ? '<span class="chip inflow">In 2B</span>' : r.eligible ? '<span class="chip overdue">Not in 2B</span>' : '';
      body = `<div class="card"><div class="card-h"><div class="grow"><h3>Purchase register</h3><div class="sub">By bill date. Untick ITC for blocked credits (food, gifts, personal use).</div></div>${can ? `<button class="btn btn-sm" data-act="gst-bill">${icon('plus')} Log an unpaid bill</button>` : ''}</div><div class="tbl-wrap"><table class="tbl gst-reg"><thead><tr><th>Bill date</th><th>Bill no.</th><th>Vendor · GSTIN</th><th>Category</th><th class="num">Taxable</th><th class="num">IGST</th><th class="num">CGST</th><th class="num">SGST</th><th>ITC</th><th></th></tr></thead><tbody>
        ${M.purch.map(r => `<tr><td class="nowrap">${fmtDate(r.date)}<div class="cell-sub">${r.paidOn ? 'paid ' + fmtDate(r.paidOn) : '<span class="out">unpaid</span>'}</div></td><td class="mono" style="font-size:12px">${r.entryId ? `<a href="#" data-act="open-entry" data-id="${r.entryId}">${esc(r.no || '—')}</a>` : esc(r.no)}</td><td><div class="cell-main">${esc(r.party ? r.party.name : '—')}</div><div class="cell-sub mono ${r.party && r.party.gstin ? '' : 'out'}">${esc(r.party && r.party.gstin ? r.party.gstin : 'No GSTIN')}</div></td><td style="font-size:12.5px">${esc(r.category)}</td><td class="num">${money(r.taxable)}</td><td class="num">${gstMoney(r.igst)}</td><td class="num">${gstMoney(r.cgst)}</td><td class="num">${gstMoney(r.sgst)}</td>
          <td>${can && st !== 'confirmed' ? `<label class="check" style="font-size:12.5px"><input type="checkbox" data-gst-itc="${r.src}:${r.id}" ${r.eligible ? 'checked' : ''}> ${r.eligible ? 'Claim' : 'Blocked'}</label>` : r.eligible ? 'Claim' : 'Blocked'}</td><td>${s2b(r)}</td></tr>`).join('') || '<tr><td colspan="10"><div class="empty">No purchase bills with GST in this month.</div></td></tr>'}
        </tbody>${M.purch.length ? `<tfoot><tr><td colspan="4">Total · eligible ITC ${money(totH(M.itc))}</td><td class="num">${money(sum(M.purch, r => r.taxable))}</td><td class="num">${money(sum(M.purch, r => r.igst))}</td><td class="num">${money(sum(M.purch, r => r.cgst))}</td><td class="num">${money(sum(M.purch, r => r.sgst))}</td><td colspan="2"></td></tr></tfoot>` : ''}</table></div></div>`;
    } else if (T === 'sac') {
      const rows = gstPackSheets(ym).find(s => s[0] === 'SAC summary')[1].slice(1);
      body = `<div class="card"><div class="card-h"><div class="grow"><h3>SAC summary (GSTR-1 table 12)</h3><div class="sub">Outward supplies by service code. Codes come from the receipt category; change them in Masters › Categories.</div></div></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>SAC</th><th>Description</th><th class="num">Rate</th><th class="num">Taxable</th><th class="num">IGST</th><th class="num">CGST</th><th class="num">SGST</th><th class="num">Total tax</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td class="mono">${esc(r[0])}</td><td>${esc(r[1])}</td><td class="num">${r[2]}%</td><td class="num">${money(r[3])}</td><td class="num">${gstMoney(r[4])}</td><td class="num">${gstMoney(r[5])}</td><td class="num">${gstMoney(r[6])}</td><td class="num"><b>${gstMoney(r[7])}</b></td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">No sales this month.</div></td></tr>'}</tbody></table></div></div>`;
    } else if (T === 'party') {
      body = `<div class="grid g-2"><div class="card"><div class="card-h"><h3 class="grow">Clients</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Client</th><th class="num">Taxable</th><th class="num">Output tax</th></tr></thead><tbody>${partyTotals(M.sales).map(x => `<tr><td><div class="cell-main">${esc(x.p ? x.p.name : '—')}</div><div class="cell-sub mono">${esc(x.p ? x.p.gstin || '' : '')}</div></td><td class="num">${money(x.h.taxable)}</td><td class="num">${money(totH(x.h))}</td></tr>`).join('') || '<tr><td colspan="3"><div class="empty">None</div></td></tr>'}</tbody></table></div></div>
        <div class="card"><div class="card-h"><h3 class="grow">Vendors</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Vendor</th><th class="num">Taxable</th><th class="num">ITC</th><th class="num">Blocked</th></tr></thead><tbody>${vendorTotals(M.purch).map(x => `<tr><td><div class="cell-main">${esc(x.p ? x.p.name : '—')}</div><div class="cell-sub mono">${esc(x.p ? x.p.gstin || 'No GSTIN' : '')}</div></td><td class="num">${money(x.t)}</td><td class="num in">${gstMoney(x.e)}</td><td class="num">${gstMoney(x.b)}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">None</div></td></tr>'}</tbody></table></div></div></div>`;
    } else if (T === '2b') {
      const has = (Store.data.gst2b || []).some(x => x.ym === ym), R = has ? match2B(M) : null;
      body = `<div class="card"><div class="card-h"><div class="grow"><h3>GSTR-2B · ${monthLabel(ym, true)}</h3><div class="sub">Download GSTR-2B as Excel from the GST portal (Returns › GSTR-2B) and upload it here. Bills match on vendor GSTIN and bill no.</div></div>${can ? `<button class="btn btn-sm" data-act="gst-2b-sample">${icon('bolt')} Try a sample 2B</button><label class="btn btn-sm btn-gold">${icon('upload')} Upload GSTR-2B<input type="file" id="g2bFile" accept=".xlsx,.xls,.csv" style="display:none"></label>` : ''}</div>
        ${!has ? '<div class="empty"><b>Not uploaded yet</b>Upload the month\'s GSTR-2B to see which bills are on the portal.</div>' : `<div class="gst-2b-k"><div><span>Matched</span><b class="in">${R.matched.length}</b><em>${money(sum(R.matched, m => totH(m.r)))} ITC</em></div><div><span>In books, not in 2B</span><b class="${R.booksOnly.length ? 'out' : ''}">${R.booksOnly.length}</b><em>${money(sum(R.booksOnly, r => totH(r)))} ITC at risk</em></div><div><span>In 2B, not in books</span><b class="${R.portalOnly.length ? 'out' : ''}">${R.portalOnly.length}</b><em>${money(sum(R.portalOnly, x => x.igst + x.cgst + x.sgst))} ITC</em></div></div>
        ${R.booksOnly.length ? `<div class="fsec-h" style="margin:14px 18px 6px">In books, not in GSTR-2B — ask these vendors to file</div>${R.booksOnly.map(r => `<div class="list-row"><div class="grow"><div class="t">${esc(r.party ? r.party.name : '')} · ${esc(r.no)}</div><div class="s">${fmtDate(r.date)} · ${esc(r.party ? r.party.gstin || 'No GSTIN' : '')}</div></div><span class="num">${money(totH(r))}</span></div>`).join('')}` : ''}
        ${R.portalOnly.length ? `<div class="fsec-h" style="margin:14px 18px 6px">In GSTR-2B, not in the books</div>${R.portalOnly.map(x => `<div class="list-row"><div class="grow"><div class="t">${esc(x.name)} · ${esc(x.no)}</div><div class="s mono">${esc(x.gstin)} · ${x.date ? fmtDate(x.date) : ''} · taxable ${money(x.taxable)}</div></div><span class="num">${money(x.igst + x.cgst + x.sgst)}</span>${can ? `<button class="btn btn-sm" data-act="gst-2b-add" data-id="${x.id}">Log bill</button>` : ''}</div>`).join('')}` : ''}
        ${R.matched.length ? `<details style="margin:10px 18px 16px"><summary class="muted" style="cursor:pointer;font-size:13px">${R.matched.length} matched bills</summary>${R.matched.map(m => `<div class="list-row" style="padding:6px 0"><div class="grow" style="font-size:13px">${esc(m.r.party.name)} · ${esc(m.r.no)}${!m.byNo ? ` <span class="muted">(2B: ${esc(m.x.no)})</span>` : ''}</div><span class="num ${Math.abs(m.diff) > 1 ? 'out' : ''}">${money(totH(m.r))}${Math.abs(m.diff) > 1 ? ' · 2B ' + money(m.x.igst + m.x.cgst + m.x.sgst) : ''}</span></div>`).join('')}</details>` : ''}`}</div>`;
    } else {
      body = `<div class="card"><div class="card-h"><div class="grow"><h3>Checks</h3><div class="sub">Things the CA will ask about. Fix them before sending, or they're listed in the Excel as open points.</div></div></div>${ch.map(gstCheckRow).join('') || '<div class="empty"><b>No issues found</b>The records for this month look complete.</div>'}</div>`;
    }
    return `<div class="stack">${strip}${head}${banner}${kpis}${tabs}${body}</div>`;
  },
};
function gstCheckRow(c) { return `<div class="list-row gst-ck ${c.sev}"><span class="gst-sev ${c.sev}">${c.sev === 'high' ? 'Fix' : c.sev === 'med' ? 'Check' : 'Note'}</span><div class="grow"><div class="t">${esc(c.t)}</div><div class="s">${esc(c.d)}</div></div>${c.act ? `<button class="btn btn-sm btn-ghost" data-act="${c.act[0]}" data-id="${c.act[1]}" data-v="${c.act[1]}">Open</button>` : ''}</div>`; }
function logBillModal(pre = {}) {
  const ym = S.gst.ym, v = { vendorId: pre.vendorId || '', billNo: pre.billNo || '', billDate: pre.billDate || ymDate(ym, 15), taxable: pre.taxable || '', gstRate: pre.gstRate ?? 18, categoryId: pre.categoryId || '' };
  const ov = openModal(`<div class="modal-h"><h2>Log an unpaid bill</h2></div><div class="modal-b"><div class="hint" style="margin-bottom:12px">Counts the GST as input credit in the bill's month before you pay. When you later record the payment with the same vendor and bill no., it replaces this.</div><div class="fgrid c2">
    <div class="field span3"><label>Vendor</label><div class="row" style="flex-wrap:nowrap;gap:6px"><select class="select" id="lbV">${partyOptions('vendor', v.vendorId, 'Select vendor')}</select><button type="button" class="btn" style="padding:0 10px" id="lbNew">${icon('plus')}</button></div>${pre.gstin ? `<div class="hint">2B: ${esc(pre.name || '')} · ${esc(pre.gstin)}</div>` : ''}</div>
    <div class="field"><label>Bill no.</label><input class="input" id="lbNo" value="${esc(v.billNo)}"></div><div class="field"><label>Bill date</label><input class="input" type="date" id="lbD" value="${v.billDate}"></div>
    <div class="field"><label>Value before GST (₹)</label><input class="input num" type="number" id="lbT" value="${v.taxable}" step="0.01"></div><div class="field"><label>GST rate</label><select class="select" id="lbR">${opts(GST_RATES.filter(r => r > 0).map(r => [r, r + '%']), v.gstRate)}</select></div>
    <div class="field span3"><label>Category</label><select class="select" id="lbC">${catSelectOptions(api.list('categories').filter(c => c.type === 'outflow' && c.partyKind === 'vendor'), v.categoryId)}</select></div></div></div>
    <div class="modal-f"><button class="btn" data-x="no">Cancel</button><button class="btn btn-gold" data-x="yes">Save bill</button></div>`, 'sm');
  $('#lbNew', ov).addEventListener('click', () => partyForm('vendor', null, { quick: true, preset: pre.gstin ? { name: pre.name || '', gstin: pre.gstin } : {}, cb: p => { $('#lbV', ov).innerHTML = partyOptions('vendor', p.id, 'Select vendor'); } }));
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-x]'); if (!b) return; if (b.dataset.x === 'no') return ov.remove();
    const vend = api.get('parties', $('#lbV', ov).value), t = r2(+$('#lbT', ov).value || 0), rate = +$('#lbR', ov).value, d = $('#lbD', ov).value, no = $('#lbNo', ov).value.trim();
    if (!vend || !no || !(t > 0) || !d) return toast('Vendor, bill no., date and value are required', 'error');
    try { assertGstOpen([ymOf(d)], 'bills');
      const gt = vend.gstin ? (vend.gstin.slice(0, 2) === HOME_STATE ? 'intra' : 'inter') : (vend.gstType !== 'none' ? vend.gstType : 'intra');
      await api.create('gstBills', { vendorId: vend.id, billNo: no, billDate: d, taxable: t, gstRate: rate, gstType: gt, gstAmount: r2(t * rate / 100), categoryId: $('#lbC', ov).value, itc: !(api.get('categories', $('#lbC', ov).value) || {}).itcBlocked, deleted: false }, { summary: `Bill ${no} · ${vend.name} · ${money(t)} logged for GST` });
      ov.remove(); toast('Bill logged'); render({ keepScroll: true });
    } catch (err) { toast(err.message, 'error'); }
  });
}
function gstSettingsCard() {
  const G = gstState(), owner = api.can('settings.edit'), dis = owner ? '' : 'disabled';
  return `<div class="card" id="gstSettings"><div class="card-h"><div class="grow"><h3>GST</h3><div class="sub">CA contact, document numbering, LUT and opening credit</div></div></div><div class="card-b"><form id="gsForm" class="fgrid">
    <div class="field"><label>CA name</label><input class="input" name="caName" value="${esc(G.caName || '')}" ${dis}></div>
    <div class="field span2"><label>CA email(s)</label><input class="input" name="caEmails" value="${esc((G.caEmails || []).join(', '))}" ${dis}><div class="hint">Monthly GST working is emailed here (currently your accounts address until the CA's is added)</div></div>
    <div class="field"><label>Tax invoice prefix</label><input class="input mono" name="invPrefix" value="${esc(G.invPrefix)}" ${dis}><div class="hint">e.g. ${esc(nextInvoiceNo(TODAY))}</div></div>
    <div class="field"><label>Credit note prefix</label><input class="input mono" name="cnPrefix" value="${esc(G.cnPrefix)}" ${dis}></div>
    <div class="field"><label>LUT ARN (exports)</label><input class="input mono" name="lut" value="${esc(G.lut || '')}" placeholder="For zero-rated exports" ${dis}></div>
    <div class="field span3"><label>Opening ITC balance on ${fmtDate(Store.data.settings.openingDate)} (IGST / CGST / SGST)</label><div class="row" style="gap:6px;flex-wrap:nowrap"><input class="input num" name="ocI" type="number" value="${G.openingCredit.igst || 0}" ${dis}><input class="input num" name="ocC" type="number" value="${G.openingCredit.cgst || 0}" ${dis}><input class="input num" name="ocS" type="number" value="${G.openingCredit.sgst || 0}" ${dis}></div></div>
    </form>${owner ? '<div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn btn-navy" data-act="gs-save">Save</button></div>' : ''}</div></div>`;
}
Object.assign(ACT, {
  'gst-month': el => { S.gst.ym = el.dataset.v; render({ keepScroll: true }); },
  'gst-step': el => { const n = addMonths(S.gst.ym, +el.dataset.v); if (n <= ymOf(TODAY)) { S.gst.ym = n; render({ keepScroll: true }); } },
  'gst-tab': el => { if (S.page !== 'gst') location.hash = '#/gst'; S.gst.tab = el.dataset.v; render({ keepScroll: true }); },
  'gst-dl': async () => { const f = await gstPackFile(S.gst.ym); downloadFile(f); toast('Downloaded ' + f.name); },
  'gst-send': () => sendGstToCA(S.gst.ym),
  'gst-confirm': async () => { const ym = S.gst.ym; const ov = openModal(`<div class="modal-h"><h2>CA confirmed ${monthLabel(ym, true)}</h2></div><div class="modal-b"><div class="field"><label>Note</label><input class="input" id="gcNote" placeholder="e.g. Confirmed on call, no changes"></div><div class="hint" style="margin-top:8px">The month locks: entries, tax invoices and credit notes in it can't be changed until the Owner reopens it.</div></div><div class="modal-f"><button class="btn" data-x="no">Cancel</button><button class="btn btn-gold" data-x="yes">Confirm & lock</button></div>`, 'sm');
    ov.addEventListener('click', ev => { const b = ev.target.closest('[data-x]'); if (!b) return; if (b.dataset.x === 'yes') { Store.data.gstMonths[ym] = { ...(Store.data.gstMonths[ym] || {}), status: 'confirmed', confirmedAt: nowISO(), by: api.me().id, note: $('#gcNote', ov).value.trim(), snapshot: gstSnapshot(ym) }; api.log('lock', 'gstMonths', ym, `GST ${monthLabel(ym, true)} confirmed by CA`); Store.persist(); toast('Confirmed and locked'); render({ keepScroll: true }); } ov.remove(); }); },
  'gst-reopen': async () => { const ym = S.gst.ym; if (!await confirmBox({ title: `Reopen ${monthLabel(ym, true)}?`, body: 'Changes become possible again. Send the working to the CA again after any change.', ok: 'Reopen' })) return; Store.data.gstMonths[ym] = { ...(Store.data.gstMonths[ym] || {}), status: 'draft', reopenedAt: nowISO() }; api.log('unlock', 'gstMonths', ym, `GST ${monthLabel(ym, true)} reopened`); Store.persist(); render({ keepScroll: true }); },
  'gst-bill': () => logBillModal(),
  'gst-2b-sample': () => import2B(new File([sample2B(S.gst.ym)], `GSTR2B_${S.gst.ym}.csv`, { type: 'text/csv' }), S.gst.ym),
  'gst-2b-add': el => { const x = (Store.data.gst2b || []).find(y => y.id === el.dataset.id); const v = api.list('parties').find(p => p.kind === 'vendor' && p.gstin === x.gstin); logBillModal({ vendorId: v ? v.id : '', billNo: x.no, billDate: x.date || ymDate(S.gst.ym, 15), taxable: x.taxable, gstRate: x.taxable ? Math.round((x.igst + x.cgst + x.sgst) / x.taxable * 100) : 18, gstin: x.gstin, name: x.name }); },
  'gst-ti': el => taxInvoiceModal(el.dataset.id),
  'gst-cn': el => creditNoteModal(el.dataset.id),
  'gs-save': () => { const f = $('#gsForm'), G = gstState(); const em = splitEmails(f.caEmails.value), bad = em.filter(x => !validEmail(x)); if (bad.length) return toast('Not a valid email: ' + bad.join(', '), 'error'); Object.assign(G, { caName: f.caName.value.trim(), caEmails: em, invPrefix: f.invPrefix.value.trim() || 'INV/', cnPrefix: f.cnPrefix.value.trim() || 'CN/', lut: f.lut.value.trim(), openingCredit: { igst: +f.ocI.value || 0, cgst: +f.ocC.value || 0, sgst: +f.ocS.value || 0 } }); _gstCache.clear(); api.log('update', 'settings', 'gst', 'GST settings updated'); Store.persist(); toast('Saved'); render({ keepScroll: true }); },
});
document.addEventListener('change', async ev => {
  if (ev.target.id === 'g2bFile' && ev.target.files[0]) { const f = ev.target.files[0]; ev.target.value = ''; import2B(f, S.gst.ym); }
  const t = ev.target.closest && ev.target.closest('[data-gst-itc]');
  if (t) { const [src, id] = t.dataset.gstItc.split(':'); try { assertGstOpen([S.gst.ym], 'ITC'); if (src === 'entry') await api.update('entries', id, { itc: t.checked }, { summary: `ITC ${t.checked ? 'claimed' : 'marked ineligible'} on ${describe('entries', api.get('entries', id))}` }); else await api.update('gstBills', id, { itc: t.checked }); render({ keepScroll: true }); } catch (err) { toast(err.message, 'error'); render({ keepScroll: true }); } }
});
/* ============================ TDS PAYABLE: deductions register, section-wise challans, 24Q/26Q return pack, Form 16A/16 issue ============================ */
/* A deduction belongs to the month of the earlier of bill date and payment date (entry.billDate / entry.date).
   Section: entry.tdsSection, else 192 for employees, else the vendor's remembered section, else the category default.
   Challans are entries in "TDS Deposited" with taxPeriod (deduction month), tdsSection and challan {bsr, serial, tax, interest, fee}.
   A challan without a section (recorded from the general tax form) is spread over the month's sections in order.
   Months go draft → sent → confirmed (locks TDS fields on entries and challans of that month). Quarter packs feed 24Q / 26Q.
   BACKEND: GET /api/tds/:ym; POST /api/tds/:ym/send|confirm|reopen; POST /api/tds/certs (files). */
IC.tdsp = '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>';
S.tdsp = { ym: null, tab: 'summary', unmatched: [] };
const TDS_SEC = {
  '192': { n: 'Salary', form: '24Q' },
  '194C': { n: 'Contractors', form: '26Q', rates: [1, 2], single: 30000, agg: 100000 },
  '194J': { n: 'Professional / technical fees', form: '26Q', rates: [10, 2], agg: 50000 },
  '194I': { n: 'Rent', form: '26Q', rates: [10, 2], month: 50000 },
  '194H': { n: 'Commission / brokerage', form: '26Q', rates: [2], agg: 20000 },
  '194A': { n: 'Interest (other than bank)', form: '26Q', rates: [10], agg: 10000 },
};
const SEC_ORDER = Object.keys(TDS_SEC);
const secName = s => TDS_SEC[s] ? TDS_SEC[s].n : 'Section not set';
const panOf = p => p ? (p.pan || (p.gstin && p.gstin.length >= 12 ? p.gstin.slice(2, 12) : '')) : '';
const PAN_RX = /[A-Z]{5}\d{4}[A-Z]/;
const isIndividualPan = pan => /^[A-Z]{3}[PH]/.test(pan || '');
function tdsSectionOf(e) {
  if (!e) return null; if (e.tdsSection) return e.tdsSection;
  const p = api.get('parties', e.partyId); if (p && p.kind === 'employee') return '192'; if (p && p.tdsSection) return p.tdsSection;
  const c = api.get('categories', e.categoryId); return (c && c.tdsSection) || null;
}
const tdsDateOf = e => e.billDate && e.billDate < e.date ? e.billDate : e.date;
const tdsDueDate = ym => ym.slice(5) === '03' ? addMonths(ym, 1) + '-30' : ymDate(addMonths(ym, 1), 7);
const monthsOrPart = (a, b) => (+b.slice(0, 4) * 12 + +b.slice(5, 7)) - (+a.slice(0, 4) * 12 + +a.slice(5, 7)) + 1;
const retDue = (fy, q) => [fy + '-07-31', fy + '-10-31', (fy + 1) + '-01-31', (fy + 1) + '-05-31'][q];
const qKey = (fy, q) => fy + 'Q' + (q + 1);
const qText = (fy, q) => `${FY_Q(q).split(' ')[0]} ${fyLabel(fy)}`;
function tdsSettings() { featureSettings(); const s = Store.data.settings; if (!s.tds) s.tds = {}; if (s.tds.tan === undefined) s.tds.tan = ''; if (s.tds.bsr === undefined) s.tds.bsr = ''; return s.tds; }
function ldcFor(p, sec, date) { return ((p && p.ldc) || []).find(c => c.section === sec && c.from <= date && date <= c.to); }
/** Usual rate for a deduction, considering PAN type and a valid lower-deduction certificate within its limit. */
function expectedTds(p, sec, date, cumBefore, base) {
  const S = TDS_SEC[sec]; if (!S || !S.rates) return null;
  const l = ldcFor(p, sec, date);
  if (l) { if (!l.limit || cumBefore + base <= +l.limit + 1) return { rate: +l.rate, ok: [+l.rate], why: `lower-deduction certificate ${l.certNo}` }; return { rate: sec === '194C' ? (isIndividualPan(panOf(p)) ? 1 : 2) : S.rates[0], ok: sec === '194C' ? [isIndividualPan(panOf(p)) ? 1 : 2] : S.rates, why: `certificate ${l.certNo} limit of ${money(l.limit)} crossed` }; }
  if (sec === '194C') { const ind = isIndividualPan(panOf(p)); return { rate: ind ? 1 : 2, ok: [ind ? 1 : 2], why: ind ? 'individual / HUF PAN' : 'company / firm PAN' }; }
  return { rate: S.rates[0], ok: S.rates, why: S.n };
}
const _tdsCache = new Map();
const tdsCacheKey = k => k + '|' + Store.data.audit.length + '|' + Store.data.parties.length;
function tdsCached(k, fn) { const key = tdsCacheKey(k); if (_tdsCache.has(key)) return _tdsCache.get(key); if (_tdsCache.size > 300) _tdsCache.clear(); const v = fn(); _tdsCache.set(key, v); return v; }
/** Threshold & rate analysis for a financial year (26Q sections). */
function tdsFY(fy) {
  return tdsCached('fy' + fy, () => {
    const from = fy + '-04-01', to = (fy + 1) + '-03-31', out = { missed: [], wrong: [] };
    const es = Calc.live().filter(e => e.type === 'outflow' && e.categoryId !== 'cat_tdsdep' && e.partyId && +e.taxable > 0).map(e => ({ e, d: tdsDateOf(e), sec: tdsSectionOf(e) })).filter(x => x.d >= from && x.d <= to && x.sec && x.sec !== '192' && TDS_SEC[x.sec]);
    const groups = {}; es.forEach(x => { (groups[x.e.partyId + '|' + x.sec] = groups[x.e.partyId + '|' + x.sec] || []).push(x); });
    for (const list of Object.values(groups)) {
      list.sort((a, b) => a.d.localeCompare(b.d)); const sec = list[0].sec, S = TDS_SEC[sec], p = api.get('parties', list[0].e.partyId);
      if (!p || p.kind === 'employee') continue;
      const monthTot = {}; list.forEach(x => { const m = ymOf(x.d); monthTot[m] = (monthTot[m] || 0) + +x.e.taxable; });
      let cum = 0, crossed = null; const pending = [];
      for (const x of list) {
        const base = +x.e.taxable, has = +x.e.tdsAmount > 0;
        let req = false, why = '';
        if (S.month) { req = monthTot[ymOf(x.d)] > S.month; why = `rent for ${monthLabel(ymOf(x.d), true)} is above ${money(S.month)} a month`; }
        else { if (S.single && base > S.single) { req = true; why = `single bill above ${money(S.single)}`; } if (cum + base > S.agg) { if (!crossed) crossed = x.d; req = true; why = why || `payments this FY crossed ${money(S.agg)} on ${fmtDate(crossed)}`; } }
        const exp = expectedTds(p, sec, x.d, cum, base);
        if (req && !has) { out.missed.push({ e: x.e, d: x.d, sec, p, base, exp, why }); if (!S.month && crossed === x.d) pending.splice(0).forEach(y => out.missed.push({ ...y, why: `earlier payment; FY total crossed ${money(S.agg)} on ${fmtDate(crossed)}` })); }
        else if (!req && !has) pending.push({ e: x.e, d: x.d, sec, p, base, exp });
        if (has && exp && !exp.ok.includes(+x.e.tdsRate)) out.wrong.push({ e: x.e, d: x.d, sec, p, base, exp });
        cum += base;
      }
    }
    return out;
  });
}
/** The month's deductions, challans and balance by section. */
function tdsMonth(ym) { return tdsCached('m' + ym, () => computeTdsMonth(ym)); }
function computeTdsMonth(ym) {
  const rows = Calc.live().filter(e => e.type === 'outflow' && e.categoryId !== 'cat_tdsdep' && +e.tdsAmount > 0 && ymOf(tdsDateOf(e)) === ym).map(e => { const p = api.get('parties', e.partyId); return { e, id: e.id, date: tdsDateOf(e), paidOn: e.date, party: p, pan: panOf(p), sec: tdsSectionOf(e) || '', base: +e.taxable, rate: +e.tdsRate, tds: +e.tdsAmount, cat: nameOf('categories', e.categoryId), challan: null, payDate: null }; }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const challans = Calc.live().filter(e => e.categoryId === 'cat_tdsdep' && taxPeriodOf(e) === ym).map(e => { const c = e.challan || {}; const interest = +c.interest || 0, fee = +c.fee || 0; return { e, id: e.id, date: e.date, sec: e.tdsSection || '', tax: c.tax != null ? +c.tax : r2(+e.amount - interest - fee), interest, fee, bsr: c.bsr || '', serial: c.serial || e.refNo || '', amount: +e.amount }; }).sort((a, b) => a.date.localeCompare(b.date));
  const due = tdsDueDate(ym);
  const secs = [...new Set([...rows.map(r => r.sec), ...challans.filter(c => c.sec).map(c => c.sec)])].sort((a, b) => (SEC_ORDER.indexOf(a) + 99 * !TDS_SEC[a]) - (SEC_ORDER.indexOf(b) + 99 * !TDS_SEC[b]));
  const pay = {}; secs.forEach(s => { pay[s] = challans.filter(c => c.sec === s).map(c => ({ c, amt: c.tax })); });
  // challans without a section: spread over sections still owing, in section order
  challans.filter(c => !c.sec || !secs.includes(c.sec)).forEach(c => { let left = c.tax; for (const s of secs) { if (left <= 0) break; const owe = r2(sum(rows.filter(r => r.sec === s), r => r.tds) - sum(pay[s], x => x.amt)); if (owe > 0) { const x = Math.min(owe, left); pay[s].push({ c, amt: x }); left = r2(left - x); } } });
  const bySec = secs.map(s => {
    const rs = rows.filter(r => r.sec === s), ps = pay[s].slice().sort((a, b) => a.c.date.localeCompare(b.c.date));
    const tds = r2(sum(rs, r => r.tds)), paid = r2(sum(ps, x => x.amt));
    // FIFO: which challan covered each deduction → payment date for interest
    let i = 0, avail = ps[0] ? ps[0].amt : 0;
    for (const r of rs) { let need = r.tds; while (need > 0.5 && i < ps.length) { const x = Math.min(need, avail); need -= x; avail -= x; if (need <= 0.5) { r.challan = ps[i].c; r.payDate = ps[i].c.date; } if (avail <= 0.5) { i++; avail = ps[i] ? ps[i].amt : 0; } } }
    let interest = 0, accruing = false;
    rs.forEach(r => { const pd = r.payDate || TODAY; if (pd > due) { interest += r.tds * 0.015 * monthsOrPart(r.date, pd); if (!r.payDate) accruing = true; } });
    const chs = [...new Set(ps.map(x => x.c))];
    return { sec: s, n: secName(s), form: TDS_SEC[s] ? TDS_SEC[s].form : '', deductees: new Set(rs.map(r => r.party ? r.party.id : r.id)).size, base: r2(sum(rs, r => r.base)), tds, paid, balance: r2(Math.max(0, tds - paid)), excess: r2(Math.max(0, paid - tds)), interest: Math.round(interest), interestPaid: r2(sum(chs.filter(c => c.sec === s), c => c.interest)), accruing, challans: chs, rows: rs };
  });
  const st = (Store.data.tdsMonths || {})[ym] || { status: 'draft' };
  const tot = k => r2(sum(bySec, x => x[k]));
  return { ym, rows, challans, due, bySec, tds: tot('tds'), paid: r2(sum(challans, c => c.tax)), balance: tot('balance'), interest: tot('interest'), interestPaid: r2(sum(challans, c => c.interest)), status: st, overdue: tot('balance') > 0.5 && TODAY > due };
}
function tdsChecks(M) {
  const out = [], fy = fyOf(M.ym + '-01'), F = tdsFY(fy);
  F.missed.filter(x => ymOf(x.d) === M.ym).forEach(x => { const r = x.exp ? x.exp.rate : 10, due = r2(x.base * r / 100), mo = Math.max(1, monthsOrPart(x.d, TODAY)); out.push({ sev: 'high', t: `No TDS on ${money(x.base)} to ${x.p.name} (${x.sec})`, d: `${fmtDate(x.d)} · ${x.why}. TDS due ${money(due)} at ${r}%, plus about ${money(Math.round(due * 0.01 * mo))} interest (1% a month) if deducted now. Recover it from the next payment.`, act: ['open-entry', x.e.id] }); });
  F.wrong.filter(x => ymOf(x.d) === M.ym).forEach(x => out.push({ sev: 'med', t: `${x.p.name}: TDS at ${x.e.tdsRate}% under ${x.sec}, expected ${x.exp.rate}%`, d: `${fmtDate(x.d)} · ${money(x.base)} · ${x.exp.why}. Short / excess ${money(Math.abs(r2(x.base * x.exp.rate / 100 - x.e.tdsAmount)))}.`, act: ['open-entry', x.e.id] }));
  M.rows.filter(r => !r.sec).forEach(r => out.push({ sev: 'med', t: `Section not set · ${r.party ? r.party.name : ''}`, d: `${fmtDate(r.date)} · TDS ${money(r.tds)}. Pick the section in Deductions so it reaches the right challan.`, act: ['tdsp-tab', 'deductions'] }));
  M.bySec.filter(s => s.balance > 0.5).forEach(s => { if (TODAY > M.due) out.push({ sev: 'high', t: `${s.sec} · ${money(s.balance)} not deposited (due ${fmtDate(M.due)})`, d: `Interest is running at 1.5% a month: about ${money(s.interest - s.interestPaid)} so far. Record the challan once paid.`, act: ['tdsp-challan', s.sec] }); });
  M.bySec.filter(s => s.balance <= 0.5 && s.interest - s.interestPaid > 1).forEach(s => out.push({ sev: 'med', t: `${s.sec} deposited late · interest ${money(s.interest - s.interestPaid)} unpaid`, d: `Deposit was due ${fmtDate(M.due)}. Interest at 1.5% a month from the deduction date; pay it with the next challan.`, act: ['tdsp-challan', s.sec] }));
  M.bySec.filter(s => s.excess > 1).forEach(s => out.push({ sev: 'low', t: `${s.sec} · challans exceed TDS by ${money(s.excess)}`, d: 'Check the challan amount, or adjust it in the return.', act: ['tdsp-tab', 'challans'] }));
  M.rows.forEach(r => { const l = r.party && (r.party.ldc || []).find(c => c.section === r.sec && c.to < r.date && c.to >= addDays(r.date, -120)); if (l && +r.rate === +l.rate) out.push({ sev: 'med', t: `${r.party.name}: certificate ${l.certNo} expired ${fmtDate(l.to)}`, d: `TDS at the lower ${l.rate}% on ${fmtDate(r.date)}. The normal rate applies unless a new certificate is issued.`, act: ['open-entry', r.id] }); });
  return out;
}
/* ---------- quarter / returns ---------- */
function tdsQuarter(fy, q) {
  return tdsCached('q' + fy + q, () => {
    const ms = quarterMonths(fy, q).filter(m => m <= ymOf(TODAY)), Ms = ms.map(tdsMonth);
    const rows = Ms.flatMap(M => M.rows), chs = Ms.flatMap(M => M.challans);
    const forms = ['26Q', '24Q'].map(form => {
      const rs = rows.filter(r => (r.sec === '192') === (form === '24Q')), key = `tdsret${form}:${qKey(fy, q)}`, filed = (Store.data.compliance || {})[key];
      const due = retDue(fy, q), until = filed && filed.done ? filed.at.slice(0, 10) : TODAY, tds = r2(sum(rs, r => r.tds));
      const fee = until > due ? Math.min(200 * diffDays(until, due), tds) : 0;
      return { form, rows: rs, tds, base: r2(sum(rs, r => r.base)), key, filed: filed && filed.done ? filed : null, due, fee, deductees: new Set(rs.map(r => r.party ? r.party.id : '')).size };
    });
    return { fy, q, months: ms, Ms, rows, challans: chs, forms, status: (Store.data.tdsQuarters || {})[qKey(fy, q)] || { status: 'draft' } };
  });
}
function deducteeTotals(rows) { const m = new Map(); rows.forEach(r => { const k = (r.party ? r.party.id : r.id) + '|' + r.sec; const x = m.get(k) || { p: r.party, sec: r.sec, base: 0, tds: 0, n: 0 }; x.base = r2(x.base + r.base); x.tds = r2(x.tds + r.tds); x.n++; m.set(k, x); }); return [...m.values()].sort((a, b) => b.tds - a.tds); }
/* ---------- locks ---------- */
function tdsLocked(ym) { const s = (Store.data.tdsMonths || {})[ym]; return s && s.status === 'confirmed'; }
function assertTdsOpen(yms, what) { const y = [...new Set(yms.filter(Boolean))].find(tdsLocked); if (y) throw new Error(`TDS for ${monthLabel(y, true)} is confirmed by the CA. Reopen it in TDS payable before changing ${what}.`); }
(() => {
  const tm = e => !e ? [] : e.categoryId === 'cat_tdsdep' ? [taxPeriodOf(e)] : e.type === 'outflow' && (+e.tdsAmount > 0 || e.tdsSection) ? [ymOf(tdsDateOf(e))] : [];
  const save = api.saveEntry.bind(api), del = api.softDelete.bind(api);
  api.saveEntry = async (input, id) => {
    const old = id ? api.get('entries', id) : null;
    if (input.categoryId === 'cat_tdsdep' && input.challan) { const c = input.challan; input.challan = { ...c, tax: r2(+input.taxable - (+c.interest || 0) - (+c.fee || 0)) }; }
    const n = api.normaliseEntry(input);
    const touches = old ? ['tdsAmount', 'tdsRate', 'tdsSection', 'billDate', 'date', 'partyId', 'taxable', 'amount', 'taxPeriod'].some(k => String(old[k] ?? '') !== String(n[k] ?? '')) : true;
    if (touches) assertTdsOpen([...tm(old), ...tm(n)], 'this entry');
    return save(input, id);
  };
  api.softDelete = async id => { assertTdsOpen(tm(api.get('entries', id)), 'this entry'); return del(id); };
})();
/* ---------- entry form helpers ---------- */
function tdsSectionField(F, f, sel) {
  const v = F.v, cur = v.tdsSection || tdsSectionOf(v) || '', p = api.get('parties', v.partyId);
  const exp = cur && TDS_SEC[cur] ? expectedTds(p, cur, tdsDateOf({ date: v.date || TODAY, billDate: v.billDate }), 0, 0) : null;
  const hint = !cur ? '<span class="out">Pick a section</span>' : exp ? (exp.ok.includes(+v.tdsRate) ? `Usual ${exp.ok.join('% or ')}%${exp.why.startsWith('lower') ? ' · ' + exp.why : ''}` : `<span class="out">Usual rate is ${exp.rate}% (${esc(exp.why)})</span>`) : '';
  return f('tdsSection', 'TDS section', sel('tdsSection', opts(SEC_ORDER.filter(s => s !== '192').map(s => [s, s + ' · ' + TDS_SEC[s].n]), cur, cur ? null : 'Select')), '', hint);
}
function applyTdsSection(F, sec) {
  const v = F.v; v.tdsSection = sec;
  if (!F.rateTouched && TDS_SEC[sec] && TDS_SEC[sec].rates) { const e = expectedTds(api.get('parties', v.partyId), sec, tdsDateOf({ date: v.date || TODAY, billDate: v.billDate }), 0, 0); if (e) { v.tdsRate = e.rate; F.tdsAuto = true; } }
}
/* ---------- challans ---------- */
function itParty() { return api.get('parties', 'ot_it') || api.list('parties').find(p => p.kind === 'other' && /income tax/i.test(p.name)); }
function challanModal(ym, sec) {
  if (!api.can('tdsp.edit')) return toast('Not allowed for your role', 'error');
  try { assertTdsOpen([ym], 'challans'); } catch (err) { return toast(err.message, 'error'); }
  const M = tdsMonth(ym), secs = M.bySec.length ? M.bySec : [{ sec: '194J', balance: 0, interest: 0, interestPaid: 0 }];
  sec = sec && secs.some(s => s.sec === sec) ? sec : (secs.find(s => s.balance > 0.5) || secs[0]).sec;
  const T = tdsSettings(), lastBsr = (M.challans.concat(Calc.live().filter(e => e.categoryId === 'cat_tdsdep' && e.challan).slice(-1).map(e => ({ bsr: e.challan.bsr })))).map(c => c.bsr).filter(Boolean).pop() || T.bsr || '';
  const banks = api.list('accounts').filter(a => a.active), acc = (lastEntry(e => e.categoryId === 'cat_tdsdep') || {}).accountId || (banks[0] || {}).id;
  const fill = s => { const x = secs.find(y => y.sec === s) || {}; return { tax: x.balance || 0, int: Math.max(0, Math.round((x.interest || 0) - (x.interestPaid || 0))) }; };
  const f0 = fill(sec);
  const ov = openModal(`<div class="modal-h"><h2>Record TDS challan</h2><span class="muted" style="font-size:12.5px">${monthLabel(ym, true)} · due ${fmtDate(M.due)}</span></div><div class="modal-b"><div class="fgrid c2">
    <div class="field"><label>Section</label><select class="select" id="chSec">${opts(secs.map(s => [s.sec, `${s.sec} · ${secName(s.sec)}${s.balance > 0.5 ? ' · ' + money(s.balance) + ' due' : ''}`]), sec)}</select></div>
    <div class="field"><label>Paid on</label><input class="input" type="date" id="chDate" value="${TODAY}"></div>
    <div class="field"><label>Tax (₹)</label><input class="input num" type="number" step="1" id="chTax" value="${Math.round(f0.tax)}"></div>
    <div class="field"><label>Interest (₹)</label><input class="input num" type="number" step="1" id="chInt" value="${f0.int}"><div class="hint" id="chIntH">${f0.int ? '1.5% a month for late deposit' : 'Nil if paid by the due date'}</div></div>
    <div class="field"><label>Late fee 234E (₹)</label><input class="input num" type="number" step="1" id="chFee" value="0"></div>
    <div class="field"><label>BSR code</label><input class="input mono" id="chBsr" maxlength="7" value="${esc(lastBsr)}" placeholder="7 digits"></div>
    <div class="field"><label>Challan serial no.</label><input class="input mono" id="chSer" maxlength="5" placeholder="5 digits"></div>
    <div class="field"><label>Paid from</label><select class="select" id="chAcc">${opts(banks.map(a => [a.id, a.name]), acc)}</select></div></div>
    <div class="hint" style="margin-top:10px">BSR code and challan serial no. are on the challan receipt (ITNS 281). They go into the TDS return.</div></div>
    <div class="modal-f"><button class="btn" data-x="no">Cancel</button><button class="btn btn-gold" data-x="yes">Save challan</button></div>`, 'sm');
  $('#chSec', ov).addEventListener('change', ev => { const x = fill(ev.target.value); $('#chTax', ov).value = Math.round(x.tax); $('#chInt', ov).value = x.int; });
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-x]'); if (!b) return; if (b.dataset.x === 'no') return ov.remove();
    const s = $('#chSec', ov).value, tax = Math.round(+$('#chTax', ov).value || 0), int = Math.round(+$('#chInt', ov).value || 0), fee = Math.round(+$('#chFee', ov).value || 0), bsr = $('#chBsr', ov).value.trim(), ser = $('#chSer', ov).value.trim(), date = $('#chDate', ov).value;
    if (!(tax + int + fee > 0)) return toast('Enter the amount paid', 'error');
    if (bsr && !/^\d{7}$/.test(bsr)) return toast('BSR code is 7 digits', 'error');
    if (ser && !/^\d{1,5}$/.test(ser)) return toast('Challan serial no. is up to 5 digits', 'error');
    let it = itParty(); if (!it) it = await api.create('parties', { kind: 'other', name: 'Income Tax Department', gstin: '', gstType: 'none', active: true });
    try {
      const e = await api.saveEntry({ type: 'outflow', date, categoryId: 'cat_tdsdep', departmentId: (api.get('departments', 'dep_fin') || api.list('departments')[0] || {}).id, partyId: it.id, projectId: '', piId: '', description: `TDS ${s} for ${monthLabel(ym, true)}`, refNo: ser, taxable: tax + int + fee, gstType: 'none', gstRate: 0, gstAmount: 0, itc: false, tdsRate: 0, tdsAmount: 0, paymentMode: 'NEFT', accountId: $('#chAcc', ov).value, toAccountId: '', txnRef: bsr && ser ? bsr + '/' + ser : '', notes: '', attachments: [], taxPeriod: ym, tdsSection: s, challan: { bsr, serial: ser, tax, interest: int, fee } });
      if (bsr) tdsSettings().bsr = bsr;
      Store.persist(); ov.remove(); toast(`Challan ${s} · ${money(e.amount)} recorded`); render({ keepScroll: true });
    } catch (err) { toast(err.message, 'error'); }
  });
}
/* ---------- lower deduction certificates ---------- */
function ldcModal(partyId) {
  const p = api.get('parties', partyId); if (!p) return;
  const list = () => (p.ldc || []).map(c => `<div class="list-row" style="padding:7px 0"><div class="grow"><div class="t mono" style="font-size:13px">${esc(c.certNo)} · ${esc(c.section)} @ ${c.rate}%</div><div class="s">${fmtDate(c.from)} – ${fmtDate(c.to)}${c.limit ? ' · up to ' + money(c.limit) : ''}${c.to < TODAY ? ' · <span class="out">expired</span>' : ''}</div></div><button class="icon-btn" data-l="del" data-id="${c.id}" title="Remove">${icon('trash')}</button></div>`).join('') || '<div class="muted" style="font-size:13px">None recorded.</div>';
  const fy = fyOf(TODAY);
  const ov = openModal(`<div class="modal-h"><h2>Lower deduction certificates</h2><span class="muted" style="font-size:12.5px">${esc(p.name)} · ${esc(panOf(p) || 'no PAN')}</span></div><div class="modal-b"><div id="ldcList">${list()}</div>
    <div class="fsec-h" style="margin-top:16px">Add certificate (Sec. 197)</div><div class="fgrid c2">
    <div class="field"><label>Certificate no.</label><input class="input mono" id="lcNo"></div><div class="field"><label>Section</label><select class="select" id="lcSec">${opts(SEC_ORDER.filter(s => s !== '192').map(s => [s, s + ' · ' + TDS_SEC[s].n]), tdsSectionOf({ partyId: p.id }) || '194J')}</select></div>
    <div class="field"><label>Rate %</label><input class="input num" type="number" step="0.01" id="lcRate" value="1"></div><div class="field"><label>Amount limit (₹)</label><input class="input num" type="number" id="lcLim" placeholder="As on certificate"></div>
    <div class="field"><label>Valid from</label><input class="input" type="date" id="lcFrom" value="${fy}-04-01"></div><div class="field"><label>Valid to</label><input class="input" type="date" id="lcTo" value="${fy + 1}-03-31"></div></div></div>
    <div class="modal-f"><button class="btn" data-l="close">Close</button><button class="btn btn-gold" data-l="add">Add certificate</button></div>`, 'sm');
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-l]'); if (!b) return; const a = b.dataset.l;
    if (a === 'close') { ov.remove(); return render({ keepScroll: true }); }
    const ldc = (p.ldc || []).slice();
    if (a === 'del') { await api.update('parties', p.id, { ldc: ldc.filter(c => c.id !== b.dataset.id) }, { summary: `Lower deduction certificate removed · ${p.name}` }); }
    if (a === 'add') {
      const c = { id: uid('ldc'), certNo: $('#lcNo', ov).value.trim().toUpperCase(), section: $('#lcSec', ov).value, rate: +$('#lcRate', ov).value, limit: +$('#lcLim', ov).value || 0, from: $('#lcFrom', ov).value, to: $('#lcTo', ov).value };
      if (!c.certNo || !(c.rate >= 0) || !c.from || !c.to || c.to < c.from) return toast('Certificate no., rate and a valid period are required', 'error');
      await api.update('parties', p.id, { ldc: [...ldc, c] }, { summary: `Lower deduction certificate ${c.certNo} · ${c.section} @ ${c.rate}% · ${p.name}` });
    }
    $('#ldcList', ov).innerHTML = list();
  });
}
/* ---------- Excel ---------- */
async function sheetsToFile(sheets, name) {
  try {
    await loadXLSX(); const wb = XLSX.utils.book_new();
    sheets.forEach(([n, aoa]) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = (aoa.find(r => r.length > 3) || aoa[0] || []).map((_, i) => ({ wch: i < 4 ? 24 : 14 })); XLSX.utils.book_append_sheet(wb, ws, n.slice(0, 31)); });
    return new File([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], name + '.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  } catch (e) {
    const cell = v => typeof v === 'number' ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>` : `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`;
    return new File([`<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets.map(([n, aoa]) => `<Worksheet ss:Name="${xmlEsc(n.slice(0, 31))}"><Table>${aoa.map(r => `<Row>${r.map(cell).join('')}</Row>`).join('')}</Table></Worksheet>`).join('')}</Workbook>`], name + '.xml', { type: 'application/vnd.ms-excel' });
  }
}
const coHead = () => `${Store.data.settings.company} · TAN ${tdsSettings().tan || '—'} · PAN ${(Store.data.settings.gstin || '').slice(2, 12) || '—'}`;
const chLabel = c => c ? [c.serial, c.bsr, fmtDate(c.date)].filter(Boolean).join(' · ') : 'Not deposited';
function tdsMonthSheets(ym) {
  const M = tdsMonth(ym);
  const sum1 = [[coHead()], [`TDS working for ${monthLabel(ym, true)} · deposit due ${fmtDate(M.due)} · prepared ${fmtDate(TODAY)} · status ${GST_STATUS[M.status.status || 'draft'][0]}`], [],
    ['Section', 'Nature', 'Return', 'Deductees', 'Amount paid / credited', 'TDS deducted', 'Deposited', 'Balance', 'Interest (est.)', 'Interest paid'],
    ...M.bySec.map(s => [s.sec || '—', s.n, s.form, s.deductees, s.base, s.tds, s.paid, s.balance, s.interest, s.interestPaid]),
    ['Total', '', '', '', r2(sum(M.bySec, s => s.base)), M.tds, M.paid, M.balance, M.interest, M.interestPaid]];
  const ded = [['TDS date', 'Paid on', 'Deductee', 'PAN', 'Section', 'Category', 'Bill / ref', 'Amount paid / credited', 'Rate %', 'TDS', 'Challan (serial · BSR · date)'], ...M.rows.map(r => [fmtDate(r.date), fmtDate(r.paidOn), r.party ? r.party.name : '', r.pan, r.sec, r.cat, r.e.refNo || '', r.base, r.rate, r.tds, chLabel(r.challan)])];
  const chs = [['Date', 'Section', 'BSR code', 'Challan serial', 'Tax', 'Interest', 'Late fee', 'Total', 'On time'], ...M.challans.map(c => [fmtDate(c.date), c.sec || 'Not split', c.bsr, c.serial, c.tax, c.interest, c.fee, c.amount, c.date <= M.due ? 'Yes' : 'Late'])];
  const dw = [['Deductee', 'PAN', 'Section', 'Entries', 'Amount paid / credited', 'TDS'], ...deducteeTotals(M.rows).map(x => [x.p ? x.p.name : '', panOf(x.p), x.sec, x.n, x.base, x.tds])];
  const sheets = [['Summary', sum1], ['Deductions', ded], ['Challans', chs], ['Deductee-wise', dw]];
  const ch = tdsChecks(M); if (ch.length) sheets.push(['Open points', [['Priority', 'Point', 'Detail'], ...ch.map(c => [c.sev, c.t, c.d])]]);
  return sheets;
}
function tdsQuarterSheets(fy, q) {
  const Q = tdsQuarter(fy, q), [f26, f24] = Q.forms;
  const sum1 = [[coHead()], [`TDS returns for ${qText(fy, q)} · due ${fmtDate(retDue(fy, q))}`], [], ['Return', 'Section', 'Deductees', 'Amount paid / credited', 'TDS deducted', 'Deposited (challans)', 'Late fee 234E (est.)'],
    ...Q.forms.flatMap(F => [...new Set(F.rows.map(r => r.sec))].map(s => { const rs = F.rows.filter(r => r.sec === s); return [F.form, s, new Set(rs.map(r => r.party && r.party.id)).size, r2(sum(rs, r => r.base)), r2(sum(rs, r => r.tds)), r2(sum(Q.challans.filter(c => c.sec === s), c => c.tax)), ''] }).concat([[F.form + ' total', '', F.deductees, F.base, F.tds, '', F.fee]]))];
  const ann = F => [['Deductee', 'PAN', 'Section', 'Date of payment / credit', 'Amount paid / credited', 'Rate %', 'TDS deducted', 'Date of deduction', 'Challan serial', 'BSR code', 'Challan date'], ...F.rows.map(r => [r.party ? r.party.name : '', r.pan, r.sec, fmtDate(r.paidOn < r.date ? r.paidOn : r.date), r.base, r.rate, r.tds, fmtDate(r.date), r.challan ? r.challan.serial : '', r.challan ? r.challan.bsr : '', r.challan ? fmtDate(r.challan.date) : 'Not deposited'])];
  const emp = [['Employee', 'PAN', ...Q.months.map(m => monthLabel(m)), 'Salary paid (quarter)', 'TDS (quarter)'], ...[...new Set(f24.rows.map(r => r.party && r.party.id))].map(id => { const rs = f24.rows.filter(r => r.party && r.party.id === id), p = api.get('parties', id); return [p ? p.name : '', panOf(p), ...Q.months.map(m => r2(sum(rs.filter(r => ymOf(r.date) === m), r => r.tds))), r2(sum(rs, r => r.base)), r2(sum(rs, r => r.tds))]; })];
  const chs = [['Month', 'Date', 'Section', 'BSR code', 'Challan serial', 'Tax', 'Interest', 'Late fee', 'Total'], ...Q.Ms.flatMap(M => M.challans.map(c => [monthLabel(M.ym, true), fmtDate(c.date), c.sec || 'Not split', c.bsr, c.serial, c.tax, c.interest, c.fee, c.amount]))];
  return [['Summary', sum1], ['26Q deductees', ann(f26)], ['24Q deductees', ann(f24)], ['24Q employee-wise', emp], ['Challans', chs]];
}
function tdsEmailVars(rowsBySec, extra) {
  const pad = (s, n, r) => { s = String(s); return r ? s.padStart(n) : s.padEnd(n); };
  const t = [`${pad('Section', 30)}${pad('TDS', 14, 1)}${pad('Deposited', 14, 1)}${pad('Balance', 14, 1)}`, ...rowsBySec.map(s => `${pad(s.sec + ' ' + s.n, 30).slice(0, 30)}${pad(money(s.tds), 14, 1)}${pad(money(s.paid), 14, 1)}${pad(money(s.balance), 14, 1)}`)].join('\n');
  return { company: Store.data.settings.company, tds_summary: t + (extra ? '\n\n' + extra : ''), tds_checks: '' };
}
async function sendPackToCA({ kind, file, vars, title, sub, onQueued, entity, entityId, sheets }) {
  if (!api.can('tdsp.send')) return toast('Not allowed for your role', 'error');
  const G = gstState(); if (!G.caEmails || !G.caEmails.length) return toast('Add the CA\'s email in Settings › GST first', 'error');
  const meta = { id: uid('f'), name: file.name, type: file.type, size: file.size }; await FileStore.put({ ...meta, blob: file });
  const E = { kind, partyId: null, on: true, to: G.caEmails.slice(), newTo: '', saveNew: false, cc: (emailSettings().cc || []).join(', '), subject: '', body: '', edited: false, attachDocs: true, files: [], err: '' };
  refreshEmail(E, vars);
  const ov = openModal(`<div class="modal-h"><h2>${esc(title)}</h2><span class="muted" style="font-size:12.5px">${esc(sub)}</span><span class="spacer"></span><button class="icon-btn" data-c="close">${icon('x')}</button></div><div class="modal-b" id="tEm"></div>
    <div class="modal-f"><button class="btn" data-c="dl">${icon('file')} Download Excel</button><span class="spacer"></span><button class="btn" data-c="close">Cancel</button><button class="btn btn-gold" data-c="send">${icon('send')} Queue email</button></div>`, 'xl');
  const body = $('#tEm', ov); const draw = () => { body.innerHTML = `<div class="muted" style="font-size:13px;margin-bottom:10px">Attached: <b>${esc(file.name)}</b> (${Math.round(file.size / 1024)} KB · ${sheets} sheets)</div>` + emailBoxHTML(E, { docs: 1, standalone: true }); };
  draw(); bindEmailEvents(body, () => E, draw);
  ov.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-c]'); if (!b) return;
    if (b.dataset.c === 'close') return ov.remove();
    if (b.dataset.c === 'dl') return downloadFile(file);
    try { checkEmail(E); const m = await api.queueEmail({ kind, entity, entityId, partyId: null, to: E.to, cc: splitEmails(E.cc), subject: E.subject, body: E.body, attachments: [meta] }); onQueued(m, E); Store.persist(); ov.remove(); toast('Queued to ' + E.to.join(', ')); render({ keepScroll: true }); } catch (err) { toast(err.message, 'error'); }
  });
}
const tdsSnap = ym => { const M = tdsMonth(ym); return { tds: M.tds, paid: M.paid, at: nowISO() }; };
async function sendTdsMonth(ym) {
  const sheets = tdsMonthSheets(ym), file = await sheetsToFile(sheets, `TDS-working-${ym}-IUOVA`), M = tdsMonth(ym), ch = tdsChecks(M).filter(c => c.sev !== 'low');
  const vars = { ...tdsEmailVars(M.bySec, `Total TDS ${money(M.tds)} · deposited ${money(M.paid)} · due ${fmtDate(M.due)}${M.interest ? ' · interest (est.) ' + money(M.interest) : ''}`), month: monthLabel(ym, true) };
  vars.tds_checks = ch.length ? 'Points to note:\n' + ch.map(c => '• ' + c.t).join('\n') + '\n\n' : '';
  sendPackToCA({ kind: 'tds_pack', file, vars, title: 'Send TDS working to CA', sub: monthLabel(ym, true), entity: 'tdsMonths', entityId: ym, sheets: sheets.length, onQueued: (m, E) => { Store.data.tdsMonths[ym] = { ...(Store.data.tdsMonths[ym] || {}), status: 'sent', sentAt: nowISO(), emailId: m.id, by: api.me().id, snapshot: tdsSnap(ym) }; api.log('update', 'tdsMonths', ym, `TDS working for ${monthLabel(ym, true)} sent to CA (${E.to.join(', ')})`); } });
}
async function sendTdsQuarter(fy, q) {
  const sheets = tdsQuarterSheets(fy, q), file = await sheetsToFile(sheets, `TDS-returns-${qKey(fy, q)}-IUOVA`), Q = tdsQuarter(fy, q);
  const bySec = SEC_ORDER.map(s => ({ sec: s, n: TDS_SEC[s].n, tds: r2(sum(Q.rows.filter(r => r.sec === s), r => r.tds)), paid: r2(sum(Q.challans.filter(c => c.sec === s), c => c.tax)) })).filter(x => x.tds || x.paid).map(x => ({ ...x, balance: r2(Math.max(0, x.tds - x.paid)) }));
  const issues = Q.Ms.flatMap(M => tdsChecks(M).filter(c => c.sev === 'high').map(c => monthLabel(M.ym) + ': ' + c.t));
  const vars = { ...tdsEmailVars(bySec, `26Q: ${Q.forms[0].deductees} deductees · TDS ${money(Q.forms[0].tds)}\n24Q: ${Q.forms[1].deductees} employees · TDS ${money(Q.forms[1].tds)}`), quarter: qText(fy, q), tds_checks: issues.length ? 'Points to note:\n' + issues.map(x => '• ' + x).join('\n') + '\n\n' : '' };
  sendPackToCA({ kind: 'tds_return', file, vars, title: 'Send TDS return pack to CA', sub: qText(fy, q), entity: 'tdsQuarters', entityId: qKey(fy, q), sheets: sheets.length, onQueued: (m, E) => { Store.data.tdsQuarters[qKey(fy, q)] = { status: 'sent', sentAt: nowISO(), emailId: m.id }; api.log('update', 'tdsQuarters', qKey(fy, q), `TDS return pack ${qText(fy, q)} sent to CA (${E.to.join(', ')})`); } });
}
/* ---------- certificates (Form 16A / 16) ---------- */
function certCandidates(fy, q) {
  const Q = tdsQuarter(fy, q), a = deducteeTotals(Q.forms[0].rows).reduce((m, x) => { const id = x.p && x.p.id; if (!id) return m; const y = m.get(id) || { p: x.p, form: '16A', tds: 0 }; y.tds = r2(y.tds + x.tds); m.set(id, y); return m; }, new Map());
  const out = [...a.values()];
  if (q === 3) { const rows = fyMonths(fy).filter(m => m <= ymOf(TODAY)).flatMap(m => tdsMonth(m).rows.filter(r => r.sec === '192')); const e = new Map(); rows.forEach(r => { const id = r.party && r.party.id; if (!id) return; const y = e.get(id) || { p: r.party, form: '16', tds: 0 }; y.tds = r2(y.tds + r.tds); e.set(id, y); }); out.push(...e.values()); }
  return out;
}
const certOf = (fy, q, form, pid) => (Store.data.tdsOutCerts || []).find(c => c.fy === fy && c.q === q && c.form === form && c.partyId === pid);
function matchCertFile(name, cands) {
  const up = name.toUpperCase(), pan = (up.match(PAN_RX) || [])[0];
  const form = /16A/.test(up) ? '16A' : /PART|FORM ?16[^A]|_16_|FORM16(?!A)/.test(up) ? '16' : null;
  let hit = pan ? cands.filter(c => panOf(c.p) === pan) : [];
  if (!hit.length) { const tk = new Set(nameToks(name.replace(/\.pdf$/i, ''))); const sc = cands.map(c => ({ c, n: nameToks(c.p.name.replace(/\(.*\)/, '')).filter(t => tk.has(t)).length })).filter(x => x.n > 0); const best = Math.max(0, ...sc.map(x => x.n)); hit = sc.filter(x => x.n === best).map(x => x.c); }
  if (hit.length > 1 && form) hit = hit.filter(c => c.form === form);
  return hit.length === 1 ? hit[0] : null;
}
async function addCertFiles(files, fy, q) {
  const cands = certCandidates(fy, q); let ok = 0; S.tdsp.unmatched = S.tdsp.unmatched.filter(u => u.fy === fy && u.q === q);
  for (const f of files) {
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) { toast(f.name + ' is not a PDF', 'error'); continue; }
    const meta = { id: uid('f'), name: f.name, type: 'application/pdf', size: f.size }; await FileStore.put({ ...meta, blob: f });
    const c = matchCertFile(f.name, cands);
    if (c) { saveCert(fy, q, c.form, c.p.id, meta); ok++; } else S.tdsp.unmatched.push({ fy, q, meta });
  }
  Store.persist(); render({ keepScroll: true });
  toast(`${ok} certificate${ok === 1 ? '' : 's'} matched${S.tdsp.unmatched.length ? ` · ${S.tdsp.unmatched.length} to assign` : ''}`);
}
function saveCert(fy, q, form, pid, meta) {
  const list = Store.data.tdsOutCerts, old = certOf(fy, q, form, pid);
  if (old) Object.assign(old, { file: meta, uploadedAt: nowISO(), sentAt: null, emailId: null }); else list.push({ id: uid('tc'), fy, q, form, partyId: pid, file: meta, uploadedAt: nowISO(), sentAt: null, emailId: null });
  api.log('create', 'tdsOutCerts', pid, `Form ${form} ${qText(fy, q)} attached for ${nameOf('parties', pid)}`);
}
function sampleCertFiles(fy, q) {
  const pdf = t => `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length ${t.length + 40}>>stream\nBT /F1 14 Tf 60 780 Td (${t}) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
  return certCandidates(fy, q).map((c, i) => { const pan = panOf(c.p) || 'NOPAN0000X'; const nm = i === 1 ? c.p.name.replace(/[^A-Za-z ]/g, '').trim().replace(/\s+/g, '_') + `_Q${q + 1}.pdf` : c.form === '16' ? `${pan}_PARTA_${fy}-${(fy + 1) % 100}.pdf` : `${pan}_Q${q + 1}_${fy}-${(fy + 1) % 100}_16A.pdf`; return new File([pdf(`Form ${c.form} ${qText(fy, q)} ${c.p.name} ${pan}`)], nm, { type: 'application/pdf' }); });
}
async function emailCerts(fy, q) {
  if (!api.can('tdsp.send')) return toast('Not allowed for your role', 'error');
  const cands = certCandidates(fy, q), pend = cands.map(c => ({ c, rec: certOf(fy, q, c.form, c.p.id) })).filter(x => x.rec && !x.rec.sentAt);
  if (!pend.length) return toast('No certificates waiting to be sent', 'error');
  const es = emailSettings(); let sent = 0; const miss = [];
  for (const { c, rec } of pend) {
    const p = api.get('parties', c.p.id), to = p.kind === 'employee' ? splitEmails(p.email).filter(validEmail) : emailRoute(p, 'tds_cert').to;
    if (!to.length) { miss.push(p.name); continue; }
    const t = es.templates.tds_cert || DEFAULT_EMAIL_TEMPLATES.tds_cert, vars = { party: (partyContacts(p).find(x => to.includes(x.email)) || {}).name || p.name, form: 'Form ' + c.form, quarter: c.form === '16' ? fyLabel(fy) : qText(fy, q), tds: money(c.tds), company: Store.data.settings.company };
    const m = await api.queueEmail({ kind: 'tds_cert', entity: 'parties', entityId: p.id, partyId: p.id, to, cc: [], subject: fillTemplate(t.subject, vars), body: fillTemplate(t.body, vars), attachments: [rec.file] });
    Object.assign(rec, { sentAt: nowISO(), emailId: m.id }); sent++;
  }
  const all16A = cands.filter(c => c.form === '16A').every(c => { const r = certOf(fy, q, '16A', c.p.id); return r && r.sentAt; });
  if (all16A && cands.some(c => c.form === '16A')) { const k = 'f16a:' + qKey(fy, q); if (!(Store.data.compliance[k] || {}).done) { Store.data.compliance[k] = { done: true, at: nowISO(), by: api.me().id, ref: 'Emailed from TDS payable' }; api.log('update', 'compliance', k, `Form 16A ${qText(fy, q)} issued to all vendors`); } }
  Store.persist(); render({ keepScroll: true });
  toast(`${sent} certificate email${sent === 1 ? '' : 's'} queued${miss.length ? ' · no email for ' + miss.join(', ') : ''}`, miss.length ? 'error' : undefined);
}
/* ---------- page ---------- */
PAGES.tdsp = {
  title: 'TDS payable',
  render() {
    featureSettings(); tdsSettings();
    if (!S.tdsp.ym) S.tdsp.ym = addMonths(ymOf(TODAY), -1);
    const ym = S.tdsp.ym, M = tdsMonth(ym), st = M.status.status || 'draft', can = api.can('tdsp.edit') && st !== 'confirmed', T = S.tdsp.tab;
    const fy = fyOf(ym + '-01'), q = quarterOf(ym + '-01'), months = fyMonths(fy).filter(m => m <= ymOf(TODAY));
    const strip = `<div class="gst-strip">${months.map(m => { const X = tdsMonth(m), s2 = X.status.status || 'draft', warn = X.balance > 0.5 && TODAY > X.due; return `<button class="gst-m ${m === ym ? 'on' : ''}" data-act="tdsp-month" data-v="${m}"><span>${monthLabel(m)}</span><b class="num ${warn ? 'out' : ''}">${X.tds ? shortMoney(X.tds) : '—'}</b><i class="gst-dot ${s2}"></i></button>`; }).join('')}</div>`;
    const changed = st !== 'draft' && M.status.snapshot && (Math.abs(M.status.snapshot.tds - M.tds) > 1 || Math.abs((M.status.snapshot.paid ?? M.paid) - M.paid) > 1);
    const ch = tdsChecks(M);
    const head = `<div class="bk-bar"><div class="row gst-nav" style="gap:8px"><button class="icon-btn" data-act="tdsp-step" data-v="-1" title="Previous month">${icon('chev').replace('<svg', '<svg style="transform:rotate(180deg)"')}</button><div><div style="font:600 18px var(--f-head)">${monthLabel(ym, true)}</div><div class="muted" style="font-size:12.5px">Deposit due ${fmtDate(M.due)} · ${qText(fy, q)} return due ${fmtDate(retDue(fy, q))}</div></div><button class="icon-btn" data-act="tdsp-step" data-v="1" title="Next month" ${ym >= ymOf(TODAY) ? 'disabled' : ''}>${icon('chev')}</button>
      <span class="chip ${GST_STATUS[st][1]}" style="margin-left:6px">${GST_STATUS[st][0]}${st === 'sent' && M.status.sentAt ? ' · ' + fmtDate(M.status.sentAt.slice(0, 10)) : ''}${st === 'confirmed' && M.status.confirmedAt ? ' · ' + fmtDate(M.status.confirmedAt.slice(0, 10)) : ''}</span></div><span class="spacer"></span>
      ${can && M.bySec.length ? `<button class="btn btn-sm" data-act="tdsp-challan" data-v="">${icon('plus')} Record challan</button>` : ''}
      <button class="btn btn-sm" data-act="tdsp-dl">${icon('file')} Download Excel</button>
      ${st !== 'confirmed' && api.can('tdsp.send') ? `<button class="btn btn-sm ${st === 'draft' ? 'btn-gold' : ''}" data-act="tdsp-send">${icon('send')} ${st === 'sent' ? 'Send again' : 'Send to CA'}</button>` : ''}
      ${st === 'sent' && api.can('tdsp.confirm') ? `<button class="btn btn-sm btn-navy" data-act="tdsp-confirm">${icon('check')} CA confirmed</button>` : ''}
      ${st === 'confirmed' && api.can('settings.edit') ? `<button class="btn btn-sm btn-ghost" data-act="tdsp-reopen">Reopen</button>` : ''}</div>`;
    const late = M.overdue;
    const kpis = `<div class="grid g-kpi gst-kpis">
      <div class="card kpi"><div class="k-l">TDS deducted</div><div class="k-v">${money(M.tds)}</div><div class="k-s">${M.rows.length} deductions · ${M.bySec.length} section${M.bySec.length === 1 ? '' : 's'}</div></div>
      <div class="card kpi"><div class="k-l">Deposited</div><div class="k-v in">${money(M.paid)}</div><div class="k-s">${M.challans.length} challan${M.challans.length === 1 ? '' : 's'}${M.challans.some(c => c.date > M.due) ? ' · <span class="out">some late</span>' : ''}</div></div>
      <div class="card kpi ${late ? '' : 'accent'}"${late ? ' style="border-color:#F0C9C3"' : ''}><div class="k-l">Balance to deposit</div><div class="k-v ${late ? 'out' : ''}">${money(M.balance)}</div><div class="k-s">${M.balance > 0.5 ? (late ? diffDays(TODAY, M.due) + ' days late' : 'by ' + fmtDate(M.due)) : 'All deposited'}</div></div>
      <div class="card kpi"><div class="k-l">Interest (est.)</div><div class="k-v ${M.interest - M.interestPaid > 1 ? 'out' : ''}">${money(M.interest)}</div><div class="k-s">${M.interestPaid ? money(M.interestPaid) + ' paid' : M.interest ? 'not paid yet' : 'none — deposited on time'}</div></div>
      <div class="card kpi"><div class="k-l">Deductees</div><div class="k-v">${new Set(M.rows.map(r => r.party && r.party.id)).size}</div><div class="k-s">${M.rows.filter(r => r.sec === '192').length} salary · ${M.rows.filter(r => r.sec !== '192').length} others</div></div></div>`;
    const banner = changed ? `<div class="notice" style="border-color:#F0C9C3;background:var(--out-soft)">${icon('alert')}<div><b>Figures changed after ${st === 'confirmed' ? 'confirmation' : 'sending'}.</b> TDS was ${money(M.status.snapshot.tds)}, now ${money(M.tds)}. ${st === 'sent' ? 'Send the working again.' : 'Reopen the month to review.'}</div></div>` : st === 'confirmed' ? `<div class="notice info">${icon('lock')}<div>Confirmed by the CA${M.status.note ? ' · ' + esc(M.status.note) : ''}. TDS on entries and challans of this month can't be changed until the Owner reopens it.</div></div>` : '';
    const Q = tdsQuarter(fy, q), certs = certCandidates(fy, q);
    const tabs = `<div class="tabs" style="margin-top:2px">${[['summary', 'Section summary'], ['deductions', 'Deductions', M.rows.length], ['challans', 'Challans', M.challans.length], ['deductees', 'Deductees'], ['return', 'Quarterly return'], ['certs', 'Form 16A / 16', certs.length], ['checks', 'Checks', ch.length]].map(([k, l, n]) => `<button class="${T === k ? 'on' : ''}" data-act="tdsp-tab" data-v="${k}">${l}${n !== undefined ? ` <span class="tw-n">${n}</span>` : ''}</button>`).join('')}</div>`;
    let body = '';
    if (T === 'summary') {
      body = `<div class="card"><div class="tbl-wrap"><table class="tbl gst-3b tdsp-sum"><thead><tr><th>Section</th><th class="num">Deductees</th><th class="num">Paid / credited</th><th class="num">TDS</th><th class="num">Deposited</th><th class="num">Balance</th><th class="num">Interest</th><th>Challans</th><th></th></tr></thead><tbody>
        ${M.bySec.map(s => `<tr><td><b>${esc(s.sec || '—')}</b> <span class="muted">${esc(s.n)}</span><div class="cell-sub">${s.form || ''}</div></td><td class="num">${s.deductees}</td><td class="num">${money(s.base)}</td><td class="num"><b>${money(s.tds)}</b></td><td class="num in">${gstMoney(s.paid)}</td><td class="num ${s.balance > 0.5 && TODAY > M.due ? 'out' : ''}">${gstMoney(s.balance)}</td><td class="num ${s.interest - s.interestPaid > 1 ? 'out' : ''}">${gstMoney(s.interest)}${s.accruing ? '<div class="cell-sub">accruing</div>' : ''}</td>
          <td style="font-size:12px">${s.challans.map(c => `<a href="#" data-act="open-entry" data-id="${c.id}" class="mono">${esc(c.serial || 'challan')}</a> <span class="${c.date > M.due ? 'out' : 'muted'}">${fmtDate(c.date)}</span>`).join('<br>') || '<span class="faint">—</span>'}</td>
          <td>${can && (s.balance > 0.5 || s.interest - s.interestPaid > 1) ? `<button class="btn btn-sm" data-act="tdsp-challan" data-v="${esc(s.sec)}">Record challan</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">No TDS deducted this month.</div></td></tr>'}
        ${M.bySec.length ? `<tr class="net"><td>Total</td><td></td><td class="num">${money(sum(M.bySec, s => s.base))}</td><td class="num">${money(M.tds)}</td><td class="num">${money(M.paid)}</td><td class="num">${money(M.balance)}</td><td class="num">${money(M.interest)}</td><td colspan="2"></td></tr>` : ''}
        </tbody></table></div></div>
        ${ch.length ? `<div class="card"><div class="card-h"><div class="grow"><h3>Before sending to the CA</h3><div class="sub">${ch.length} point${ch.length > 1 ? 's' : ''} in this month's records</div></div><button class="btn btn-sm" data-act="tdsp-tab" data-v="checks">See all</button></div>${ch.slice(0, 4).map(gstCheckRow).join('')}</div>` : ''}`;
    } else if (T === 'deductions') {
      body = `<div class="card"><div class="card-h"><div class="grow"><h3>Deductions register</h3><div class="sub">Month of the earlier of bill date and payment date. Change a section here; it's remembered for that vendor.</div></div></div><div class="tbl-wrap"><table class="tbl gst-reg"><thead><tr><th>TDS date</th><th>Deductee · PAN</th><th>Category</th><th>Section</th><th class="num">Paid / credited</th><th class="num">Rate</th><th class="num">TDS</th><th>Challan</th></tr></thead><tbody>
        ${M.rows.map(r => { const w = tdsFY(fy).wrong.find(x => x.e.id === r.id); return `<tr><td class="nowrap">${fmtDate(r.date)}<div class="cell-sub">${r.paidOn !== r.date ? 'paid ' + fmtDate(r.paidOn) : r.party && r.party.kind === 'employee' ? 'salary' : 'paid same day'}</div></td><td><div class="cell-main"><a href="#" data-act="open-entry" data-id="${r.id}">${esc(r.party ? r.party.name : '—')}</a></div><div class="cell-sub mono">${esc(r.pan || 'No PAN')}</div></td><td style="font-size:12.5px">${esc(r.cat)}</td>
          <td>${can && r.sec !== '192' ? `<select class="select sel-sm" data-tds-sec="${r.id}">${opts(SEC_ORDER.filter(s => s !== '192').map(s => [s, s]), r.sec, r.sec ? null : '—')}</select>` : `<span class="mono">${esc(r.sec || '—')}</span>`}</td>
          <td class="num">${money(r.base)}</td><td class="num ${w ? 'out' : ''}" ${w ? `title="Expected ${w.exp.rate}%"` : ''}>${r.rate}%</td><td class="num"><b>${money(r.tds)}</b></td><td style="font-size:12px" class="mono">${r.challan ? esc(r.challan.serial || '✓') : '<span class="out">—</span>'}</td></tr>`; }).join('') || '<tr><td colspan="8"><div class="empty">No TDS deducted this month.</div></td></tr>'}
        </tbody>${M.rows.length ? `<tfoot><tr><td colspan="4">Total</td><td class="num">${money(sum(M.rows, r => r.base))}</td><td></td><td class="num">${money(M.tds)}</td><td></td></tr></tfoot>` : ''}</table></div></div>`;
    } else if (T === 'challans') {
      body = `<div class="card"><div class="card-h"><div class="grow"><h3>Challans for ${monthLabel(ym, true)}</h3><div class="sub">One challan per section (ITNS 281). Due ${fmtDate(M.due)}.</div></div>${can && M.bySec.length ? `<button class="btn btn-sm btn-gold" data-act="tdsp-challan" data-v="">${icon('plus')} Record challan</button>` : ''}</div><div class="tbl-wrap"><table class="tbl gst-reg"><thead><tr><th>Paid on</th><th>Section</th><th>BSR code</th><th>Challan no.</th><th class="num">Tax</th><th class="num">Interest</th><th class="num">Fee</th><th class="num">Total</th><th></th></tr></thead><tbody>
        ${M.challans.map(c => `<tr data-act="open-entry" data-id="${c.id}" style="cursor:pointer"><td>${fmtDate(c.date)}</td><td class="mono">${esc(c.sec || 'Not split')}</td><td class="mono">${esc(c.bsr || '—')}</td><td class="mono">${esc(c.serial || '—')}</td><td class="num">${money(c.tax)}</td><td class="num">${gstMoney(c.interest)}</td><td class="num">${gstMoney(c.fee)}</td><td class="num"><b>${money(c.amount)}</b></td><td>${c.date <= M.due ? '<span class="chip inflow">On time</span>' : `<span class="chip overdue">${diffDays(c.date, M.due)}d late</span>`}${!c.bsr || !c.serial ? ' <span class="chip gold">Add BSR / no.</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">No challans recorded for this month.</div></td></tr>'}
        </tbody></table></div></div>`;
    } else if (T === 'deductees') {
      const fyRows = months.flatMap(m => tdsMonth(m).rows), dw = deducteeTotals(fyRows), mon = deducteeTotals(M.rows);
      const vend = dw.filter(x => x.sec !== '192'), emp = dw.filter(x => x.sec === '192');
      const thr = x => { const S2 = TDS_SEC[x.sec]; return S2 && S2.agg ? `<span class="muted">limit ${shortMoney(S2.agg)}</span>` : S2 && S2.month ? `<span class="muted">${shortMoney(S2.month)}/month</span>` : ''; };
      const row = x => { const m = mon.find(y => y.p === x.p && y.sec === x.sec), l = x.p && (x.p.ldc || []).filter(c => c.section === x.sec && c.to >= TODAY)[0]; return `<tr><td><div class="cell-main">${esc(x.p ? x.p.name : '—')}</div><div class="cell-sub mono">${esc(panOf(x.p) || 'No PAN')}</div></td><td class="mono">${esc(x.sec)}</td><td class="num">${m ? money(m.tds) : '<span class="faint">–</span>'}</td><td class="num">${money(x.base)}<div class="cell-sub">${thr(x)}</div></td><td class="num"><b>${money(x.tds)}</b></td>${x.sec !== '192' ? `<td>${l ? `<span class="chip gold">${esc(l.certNo)} · ${l.rate}%</span>` : ''}${api.can('tdsp.edit') && x.p ? ` <button class="btn btn-sm btn-ghost" data-act="tdsp-ldc" data-id="${x.p.id}">${l ? 'Edit' : '197 cert.'}</button>` : ''}</td>` : '<td></td>'}</tr>`; };
      const tbl = (title, list) => `<div class="card"><div class="card-h"><h3 class="grow">${title} · ${fyLabel(fy)} to date</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Deductee · PAN</th><th>Section</th><th class="num">${monthLabel(ym)}</th><th class="num">FY paid / credited</th><th class="num">FY TDS</th><th></th></tr></thead><tbody>${list.map(row).join('') || '<tr><td colspan="6"><div class="empty">None</div></td></tr>'}</tbody></table></div></div>`;
      body = tbl('Vendors & professionals (26Q)', vend) + tbl('Employees (24Q)', emp);
    } else if (T === 'return') {
      const qs = Q.status.status || 'draft';
      const formCard = F => `<div class="card"><div class="card-h"><div class="grow"><h3>${F.form} · ${F.form === '24Q' ? 'Salaries' : 'Vendors & professionals'}</h3><div class="sub">${F.deductees} deductees · ${F.rows.length} entries · TDS ${money(F.tds)} · due ${fmtDate(F.due)}</div></div>
        ${F.filed ? `<span class="chip inflow">Filed ${fmtDate(F.filed.at.slice(0, 10))}${F.filed.ref ? ' · ' + esc(F.filed.ref) : ''}</span>` : F.fee ? `<span class="chip overdue">Late fee ~${money(F.fee)}</span>` : ''}
        ${!F.filed && api.can('compliance.mark') && Q.months.length === 3 && quarterMonths(fy, q)[2] < ymOf(TODAY) ? `<button class="btn btn-sm" data-act="tdsp-filed" data-v="${F.key}">Mark filed</button>` : ''}</div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Deductee · PAN</th><th>Section</th><th class="num">Entries</th><th class="num">Paid / credited</th><th class="num">TDS</th><th>Deposited</th></tr></thead><tbody>
        ${deducteeTotals(F.rows).map(x => { const rs = F.rows.filter(r => r.party === x.p && r.sec === x.sec), un = rs.filter(r => !r.challan).length; return `<tr><td><div class="cell-main">${esc(x.p ? x.p.name : '—')}</div><div class="cell-sub mono ${panOf(x.p) ? '' : 'out'}">${esc(panOf(x.p) || 'No PAN')}</div></td><td class="mono">${esc(x.sec)}</td><td class="num">${x.n}</td><td class="num">${money(x.base)}</td><td class="num"><b>${money(x.tds)}</b></td><td>${un ? `<span class="chip overdue">${un} not deposited</span>` : '<span class="chip inflow">Deposited</span>'}</td></tr>`; }).join('') || '<tr><td colspan="6"><div class="empty">Nothing this quarter.</div></td></tr>'}</tbody></table></div></div>`;
      body = `<div class="bk-bar"><div><div style="font:600 16px var(--f-head)">${qText(fy, q)} · ${FY_Q(q).split(' ')[1]}</div><div class="muted" style="font-size:12.5px">${Q.months.length < 3 ? 'Quarter in progress · ' : ''}Returns due ${fmtDate(retDue(fy, q))} · Form 16A due ${fmtDate(addDays(retDue(fy, q), 15))}${qs === 'sent' ? ' · pack sent to CA ' + fmtDate(Q.status.sentAt.slice(0, 10)) : ''}</div></div><span class="spacer"></span>
        <button class="btn btn-sm" data-act="tdsp-qdl">${icon('file')} Download return pack</button>${api.can('tdsp.send') ? `<button class="btn btn-sm ${qs === 'sent' ? '' : 'btn-gold'}" data-act="tdsp-qsend">${icon('send')} ${qs === 'sent' ? 'Send again' : 'Send to CA'}</button>` : ''}</div>
        ${formCard(Q.forms[0])}${formCard(Q.forms[1])}`;
    } else if (T === 'certs') {
      const pend = certs.filter(c => { const r = certOf(fy, q, c.form, c.p.id); return r && !r.sentAt; }).length, um = S.tdsp.unmatched.filter(u => u.fy === fy && u.q === q);
      const canC = api.can('tdsp.edit');
      body = `<div class="card"><div class="card-h"><div class="grow"><h3>Certificates · ${qText(fy, q)}</h3><div class="sub">Download Form 16A ${q === 3 ? 'and Form 16 ' : ''}from TRACES (or get them from the CA) and drop the PDFs here. Files are matched by the PAN in the file name, then by name.</div></div>
        ${canC ? `<button class="btn btn-sm" data-act="tdsp-csample">${icon('bolt')} Try sample files</button><label class="btn btn-sm">${icon('upload')} Upload PDFs<input type="file" id="tcFiles" accept="application/pdf,.pdf" multiple style="display:none"></label>` : ''}
        ${api.can('tdsp.send') ? `<button class="btn btn-sm btn-gold" data-act="tdsp-cmail" ${pend ? '' : 'disabled'}>${icon('send')} Email ${pend || ''} pending</button>` : ''}</div>
        ${um.length ? `<div class="notice" style="margin:0 18px 12px">${icon('info')}<div><b>${um.length} file${um.length > 1 ? 's' : ''} couldn't be matched.</b> Choose who each belongs to.${um.map((u, i) => `<div class="row" style="gap:8px;margin-top:6px;flex-wrap:nowrap"><span class="mono" style="font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(u.meta.name)}</span><select class="select sel-sm" data-tc-assign="${S.tdsp.unmatched.indexOf(u)}"><option value="">Assign to…</option>${certs.map(c => `<option value="${c.form}|${c.p.id}">${esc(c.p.name)} · ${c.form}</option>`).join('')}</select></div>`).join('')}</div></div>` : ''}
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Deductee · PAN</th><th>Form</th><th class="num">TDS</th><th>File</th><th>Status</th></tr></thead><tbody>
        ${certs.map(c => { const r = certOf(fy, q, c.form, c.p.id), em = c.p.kind === 'employee' ? splitEmails(c.p.email)[0] : emailRoute(c.p, 'tds_cert').to[0]; return `<tr><td><div class="cell-main">${esc(c.p.name)}</div><div class="cell-sub mono">${esc(panOf(c.p) || 'No PAN')} · ${esc(em || 'no email')}</div></td><td>Form ${c.form}${c.form === '16' ? ' <span class="muted">(FY)</span>' : ''}</td><td class="num">${money(c.tds)}</td><td style="font-size:12.5px">${r ? `<a href="#" data-act="tdsp-cview" data-id="${r.file.id}">${esc(r.file.name)}</a>` : '<span class="faint">Not uploaded</span>'}</td><td>${r && r.sentAt ? `<span class="chip inflow">Emailed ${fmtDate(r.sentAt.slice(0, 10))}</span>` : r ? '<span class="chip gold">Ready to send</span>' : '<span class="chip">Waiting</span>'}</td></tr>`; }).join('') || '<tr><td colspan="5"><div class="empty">No deductees this quarter.</div></td></tr>'}
        </tbody></table></div>${q !== 3 ? '<div class="muted" style="padding:10px 18px 14px;font-size:12.5px">Form 16 for employees appears in Q4 (issued once a year, by 15 June).</div>' : ''}</div>`;
    } else {
      body = `<div class="card"><div class="card-h"><div class="grow"><h3>Checks</h3><div class="sub">Missed deductions above the limits, wrong rates, late or missing deposits, expired lower-deduction certificates.</div></div></div>${ch.map(gstCheckRow).join('') || '<div class="empty"><b>No issues found</b>The TDS records for this month look complete.</div>'}</div>`;
    }
    return `<div class="stack">${strip}${head}${banner}${kpis}${tabs}${body}</div>`;
  },
};
function tdsSettingsCard() {
  const T = tdsSettings(), owner = api.can('settings.edit'), dis = owner ? '' : 'disabled';
  return `<div class="card" id="tdsSettings"><div class="card-h"><div class="grow"><h3>TDS</h3><div class="sub">Deductor details for challans and returns. The CA email is shared with GST.</div></div></div><div class="card-b"><form id="tsForm" class="fgrid">
    <div class="field"><label>TAN</label><input class="input mono" name="tan" value="${esc(T.tan)}" placeholder="MUMI12345A" ${dis}></div>
    <div class="field"><label>Usual BSR code</label><input class="input mono" name="bsr" value="${esc(T.bsr)}" maxlength="7" ${dis}><div class="hint">Your bank branch code on challans</div></div>
    </form>${owner ? '<div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn btn-navy" data-act="ts-save">Save</button></div>' : ''}</div></div>`;
}
Object.assign(ACT, {
  'tdsp-month': el => { S.tdsp.ym = el.dataset.v; render({ keepScroll: true }); },
  'tdsp-step': el => { const n = addMonths(S.tdsp.ym, +el.dataset.v); if (n <= ymOf(TODAY)) { S.tdsp.ym = n; render({ keepScroll: true }); } },
  'tdsp-tab': el => { if (S.page !== 'tdsp') location.hash = '#/tdsp'; S.tdsp.tab = el.dataset.v || el.dataset.id; render({ keepScroll: true }); },
  'tdsp-challan': el => challanModal(S.tdsp.ym, el.dataset.v || el.dataset.id || ''),
  'tdsp-dl': async () => { const f = await sheetsToFile(tdsMonthSheets(S.tdsp.ym), `TDS-working-${S.tdsp.ym}-IUOVA`); downloadFile(f); toast('Downloaded ' + f.name); },
  'tdsp-send': () => sendTdsMonth(S.tdsp.ym),
  'tdsp-qdl': async () => { const fy = fyOf(S.tdsp.ym + '-01'), q = quarterOf(S.tdsp.ym + '-01'); const f = await sheetsToFile(tdsQuarterSheets(fy, q), `TDS-returns-${qKey(fy, q)}-IUOVA`); downloadFile(f); toast('Downloaded ' + f.name); },
  'tdsp-qsend': () => sendTdsQuarter(fyOf(S.tdsp.ym + '-01'), quarterOf(S.tdsp.ym + '-01')),
  'tdsp-filed': el => markFiled(el.dataset.v),
  'tdsp-confirm': () => { const ym = S.tdsp.ym; const ov = openModal(`<div class="modal-h"><h2>CA confirmed TDS for ${monthLabel(ym, true)}</h2></div><div class="modal-b"><div class="field"><label>Note</label><input class="input" id="tcNote" placeholder="e.g. Challans verified"></div><div class="hint" style="margin-top:8px">The month locks: TDS on entries and challans in it can't be changed until the Owner reopens it.</div></div><div class="modal-f"><button class="btn" data-x="no">Cancel</button><button class="btn btn-gold" data-x="yes">Confirm & lock</button></div>`, 'sm');
    ov.addEventListener('click', ev => { const b = ev.target.closest('[data-x]'); if (!b) return; if (b.dataset.x === 'yes') { Store.data.tdsMonths[ym] = { ...(Store.data.tdsMonths[ym] || {}), status: 'confirmed', confirmedAt: nowISO(), by: api.me().id, note: $('#tcNote', ov).value.trim(), snapshot: tdsSnap(ym) }; api.log('lock', 'tdsMonths', ym, `TDS ${monthLabel(ym, true)} confirmed by CA`); Store.persist(); toast('Confirmed and locked'); render({ keepScroll: true }); } ov.remove(); }); },
  'tdsp-reopen': async () => { const ym = S.tdsp.ym; if (!await confirmBox({ title: `Reopen TDS for ${monthLabel(ym, true)}?`, body: 'Changes become possible again. Send the working to the CA again after any change.', ok: 'Reopen' })) return; Store.data.tdsMonths[ym] = { ...(Store.data.tdsMonths[ym] || {}), status: 'draft', reopenedAt: nowISO() }; api.log('unlock', 'tdsMonths', ym, `TDS ${monthLabel(ym, true)} reopened`); Store.persist(); render({ keepScroll: true }); },
  'tdsp-ldc': el => ldcModal(el.dataset.id),
  'tdsp-csample': () => { const fy = fyOf(S.tdsp.ym + '-01'), q = quarterOf(S.tdsp.ym + '-01'); addCertFiles(sampleCertFiles(fy, q), fy, q); },
  'tdsp-cmail': () => emailCerts(fyOf(S.tdsp.ym + '-01'), quarterOf(S.tdsp.ym + '-01')),
  'tdsp-cview': async el => { const f = await FileStore.get(el.dataset.id); if (!f) return toast('File not found', 'error'); window.open(URL.createObjectURL(f.blob), '_blank'); },
  'ts-save': () => { const f = $('#tsForm'), T = tdsSettings(); const tan = f.tan.value.trim().toUpperCase(), bsr = f.bsr.value.trim(); if (tan && !/^[A-Z]{4}\d{5}[A-Z]$/.test(tan)) return toast('TAN should look like MUMI12345A', 'error'); if (bsr && !/^\d{7}$/.test(bsr)) return toast('BSR code is 7 digits', 'error'); Object.assign(T, { tan, bsr }); api.log('update', 'settings', 'tds', 'TDS settings updated'); Store.persist(); toast('Saved'); render({ keepScroll: true }); },
});
document.addEventListener('change', async ev => {
  if (ev.target.id === 'tcFiles' && ev.target.files.length) { const fs = [...ev.target.files]; ev.target.value = ''; addCertFiles(fs, fyOf(S.tdsp.ym + '-01'), quarterOf(S.tdsp.ym + '-01')); }
  const a = ev.target.closest && ev.target.closest('[data-tc-assign]');
  if (a && a.value) { const u = S.tdsp.unmatched[+a.dataset.tcAssign]; const [form, pid] = a.value.split('|'); saveCert(u.fy, u.q, form, pid, u.meta); S.tdsp.unmatched.splice(+a.dataset.tcAssign, 1); Store.persist(); render({ keepScroll: true }); toast('Assigned'); }
  const s = ev.target.closest && ev.target.closest('[data-tds-sec]');
  if (s) { const id = s.dataset.tdsSec, e = api.get('entries', id); try { assertTdsOpen([ymOf(tdsDateOf(e))], 'this entry'); await api.update('entries', id, { tdsSection: s.value }, { summary: `TDS section ${s.value} on ${describe('entries', e)}` }); const p = api.get('parties', e.partyId); if (p && p.kind === 'vendor') await api.update('parties', p.id, { tdsSection: s.value }, { summary: `Default TDS section ${s.value} · ${p.name}` }); render({ keepScroll: true }); toast('Section updated'); } catch (err) { toast(err.message, 'error'); render({ keepScroll: true }); } }
});


// ES Module Exports for React + TypeScript Integration
export {
  Store,
  FileStore,
  Calc,
  Sales,
  api,
  S,
  PAGES,
  NAV,
  NAV_PINNED,
  navCounts,
  go,
  route,
  render,
  renderChrome,
  boot,
  openEntryForm,
  openOrderForm,
  openPiForm,
  openPartyForm,
  openBankImport,
  openCompose,
  confirmBox,
  toast,
  money,
  fmtDate,
  monthLabel,
  fyOf,
  ROLES,
  ACT,
  IC
};

if (typeof window !== 'undefined') {
  (window as any).Store = Store;
  (window as any).api = api;
  (window as any).IuovaCore = {
    Store,
    FileStore,
    Calc,
    Sales,
    api,
    S,
    PAGES,
    NAV,
    NAV_PINNED,
    navCounts,
    go,
    route,
    render,
    boot,
    toast,
    confirmBox
  };
}
