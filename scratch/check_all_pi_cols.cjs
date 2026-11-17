const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'fss' }
});

const allCandidates = [
  'id', 'pi_number', 'order_id', 'order_po_id', 'pi_date', 'payment_due_date',
  'pre_gst_amount', 'total_amount', 'gst_rate', 'gst_type', 'gst_amount',
  'tds_amount', 'tds_rate', 'tds_section', 'notes', 'status',
  'tax_invoice_number', 'tax_invoice_date', 'milestone', 'milestone_name',
  'client_id', 'project_id', 'department_id', 'client_name', 'project_name',
  'created_by', 'created_at', 'updated_at', 'deleted', 'is_deleted',
  'currency', 'terms', 'payment_terms', 'description', 'reference_no',
  'advance_amount', 'balance_amount', 'received_amount'
];

async function check() {
  const present = [];
  for (const c of allCandidates) {
    const { error } = await supabase.from('proforma_invoices').select(c).limit(1);
    if (!error) present.push(c);
  }
  console.log('ALL confirmed columns in fss.proforma_invoices:', present);
}

check();

