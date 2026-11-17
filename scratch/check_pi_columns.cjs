const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'fss' }
});

const candidates = [
  'id', 'pi_no', 'pi_number', 'order_id', 'order_po_id', 'party_id', 'client_id',
  'date', 'pi_date', 'due_date', 'amount', 'taxable', 'taxable_amount', 'total', 'total_amount',
  'gst_rate', 'gst_type', 'gst_amount', 'tds_rate', 'tds_amount', 'notes', 'status',
  'milestone', 'tax_invoice_no', 'tax_invoice_date', 'attachments', 'deleted',
  'created_by', 'created_at', 'updated_at', 'project_id', 'department_id',
  'scope', 'payment_terms', 'terms', 'payment_mode'
];

async function checkColumns() {
  const existing = [];
  for (const col of candidates) {
    const { error } = await supabase.from('proforma_invoices').select(col).limit(1);
    if (!error) {
      existing.push(col);
    }
  }
  console.log('Confirmed existing columns in fss.proforma_invoices:', existing);
}

checkColumns();
