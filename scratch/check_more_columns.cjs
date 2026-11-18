const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'fss' }
});

const moreCandidates = [
  'taxable_amount', 'taxable_value', 'pre_gst_amount', 'base_amount', 'subtotal', 'amount',
  'due_date', 'due_on', 'payment_due_date', 'invoice_due_date',
  'client_id', 'client_name', 'customer_id', 'customer_name',
  'project_id', 'project_name', 'project_code',
  'tds_rate', 'tds_percentage', 'tds_pct',
  'milestone', 'milestone_name', 'milestone_label', 'description', 'particulars',
  'tax_invoice_no', 'tax_invoice_number', 'tax_invoice_date', 'invoice_no', 'invoice_number',
  'deleted', 'is_deleted', 'deleted_at', 'deleted_by',
  'file_url', 'attachment_url', 'pdf_url', 'document_url',
  'department_id', 'department_name', 'dept_id'
];

async function checkAll() {
  const existingPI = [];
  for (const col of moreCandidates) {
    const { error } = await supabase.from('proforma_invoices').select(col).limit(1);
    if (!error) existingPI.push(col);
  }
  console.log('More existing in proforma_invoices:', existingPI);

  const tables = ['proforma_invoice_attachments', 'proforma_invoice_emails', 'proforma_invoice_recipients'];
  const testCols = ['id', 'proforma_invoice_id', 'pi_id', 'file_name', 'file_url', 'file_size', 'file_type', 'created_at', 'email', 'recipient', 'status', 'subject', 'body', 'name', 'created_by'];
  for (const t of tables) {
    const found = [];
    for (const c of testCols) {
      const { error } = await supabase.from(t).select(c).limit(1);
      if (!error) found.push(c);
    }
    console.log(`Columns found in ${t}:`, found);
  }
}

checkAll().catch(console.error);

