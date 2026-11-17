const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabasePublic = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseFss = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'fss' }
});

const allTables = [
  'fss_audit_log',
  'fss_bank_accounts',
  'fss_by_account_credited_debited',
  'fss_by_account_transfer',
  'fss_cash_flow_statement',
  'fss_cash_inflow',
  'fss_cash_outflow',
  'fss_categories',
  'fss_category_group',
  'fss_category_input_gst_on_bills',
  'fss_category_linked_to',
  'fss_category_nature',
  'fss_category_summary_bucket',
  'fss_category_tds_section',
  'fss_client',
  'fss_client_people',
  'fss_departments',
  'fss_employe',
  'fss_financing',
  'fss_form_client_payment',
  'fss_form_other_expense',
  'fss_form_other_income',
  'fss_form_pay_an_employee',
  'fss_form_tax_statutory',
  'fss_income',
  'fss_operation_receipts',
  'fss_other_parties',
  'fss_outflow_capex',
  'fss_outflow_capex_2',
  'fss_outflow_financing_and_owner',
  'fss_outflow_oc_office_fixed',
  'fss_outflow_oc_office_variable',
  'fss_outflow_oc_people',
  'fss_outflow_oc_people_report',
  'fss_outflow_oc_professional_admin',
  'fss_outflow_project_cost',
  'fss_outflow_project_cost_2',
  'fss_outflow_tax_statutory',
  'fss_outflow_travel',
  'fss_projects',
  'fss_table_order_departments',
  'fss_table_order_details',
  'fss_table_order_payment_terms',
  'fss_table_order_po',
  'fss_table_orders',
  'fss_table_transactions',
  'fss_transactions',
  'fss_type',
  'fss_vendor',
  'fss_vendor_people'
];

async function testAll() {
  console.log(`Testing all ${allTables.length} tables in both schemas...`);
  const results = [];
  for (const t of allTables) {
    const resPub = await supabasePublic.from(t).select('*').limit(1);
    const resFss = await supabaseFss.from(t).select('*').limit(1);

    const pubStatus = resPub.error ? `ERR: ${resPub.error.code} - ${resPub.error.message}` : `OK (${resPub.data?.length} rows)`;
    const fssStatus = resFss.error ? `ERR: ${resFss.error.code} - ${resFss.error.message}` : `OK (${resFss.data?.length} rows)`;

    results.push({ table: t, public: pubStatus, fss: fssStatus });
  }

  console.table(results);
}

testAll().catch(console.error);

