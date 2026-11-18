const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'fss' }
});

async function testCrud() {
  // Check orders table to see existing order ids
  const ordersRes = await supabase.from('fss_table_order_po').select('id, order_number').limit(1);
  console.log('Sample order_po:', ordersRes.data, ordersRes.error);

  // Check columns of proforma_invoices again by testing more variations
  const testCols = ['milestone', 'milestone_label', 'payment_term', 'term_label', 'tax_invoice_date', 'tds_rate', 'tds_section', 'department_id', 'project_id', 'currency', 'client_id'];
  for (const c of testCols) {
    const { error } = await supabase.from('proforma_invoices').select(c).limit(1);
    if (!error) console.log('Found additional column:', c);
  }

  // Test insert with sample data
  const testId = '00000000-0000-0000-0000-000000000001';
  const orderPoId = ordersRes.data && ordersRes.data[0] ? ordersRes.data[0].id : null;

  const row = {
    pi_number: 'TEST/PI/001',
    pi_date: '2026-11-17',
    payment_due_date: '2026-12-17',
    pre_gst_amount: 1000,
    gst_rate: 18,
    gst_type: 'intra',
    gst_amount: 180,
    status: 'issued',
    notes: 'Test PI'
  };
  if (orderPoId) {
    row.order_po_id = orderPoId;
    row.order_id = ordersRes.data[0].order_number;
  }

  console.log('Attempting insert with row:', row);
  const insertRes = await supabase.from('proforma_invoices').insert(row).select();
  console.log('Insert result:', insertRes.data, insertRes.error);
}

testCrud().catch(console.error);
