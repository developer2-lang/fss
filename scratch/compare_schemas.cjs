const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabaseFss = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'fss' }
});

const supabasePublic = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'public' }
});

async function main() {
  const testTables = [
    'fss_table_transactions',
    'fss_by_account_credited_debited',
    'fss_account_credit_debit_summary',
    'fss_outflow_oc_office_fixed',
    'fss_outflow_oc_office_variable',
    'fss_outflow_oc_people',
    'fss_outflow_project_cost',
    'fss_outflow_project_cost_2',
    'fss_outflow_capex_2',
    'fss_outflow_payroll_2',
    'fss_outflow_indirect_tax_2',
    'fss_outflow_travel',
    'fss_outflow_tax_statutory',
    'fss_outflow_oc_professional_admin',
    'fss_cash_inflow',
    'fss_operation_receipts',
    'fss_income',
    'fss_financing',
    'proforma_invoices'
  ];

  console.log('Comparing fss vs public tables count and content:');
  for (const t of testTables) {
    const fssRes = await supabaseFss.from(t).select('*', { count: 'exact' });
    const pubRes = await supabasePublic.from(t).select('*', { count: 'exact' });
    
    console.log(`\nTable [${t}]:`);
    console.log(`  fss:    count=${fssRes.count ?? fssRes.data?.length ?? 'N/A'} (error: ${fssRes.error ? fssRes.error.message : 'NONE'})`);
    console.log(`  public: count=${pubRes.count ?? pubRes.data?.length ?? 'N/A'} (error: ${pubRes.error ? pubRes.error.message : 'NONE'})`);
  }
}

main().catch(console.error);

