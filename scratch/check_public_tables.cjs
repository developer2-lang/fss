const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkPublic() {
  const tables = [
    'fss_transactions',
    'fss_table_transactions',
    'fss_table_orders',
    'fss_client',
    'fss_vendor',
    'fss_employe',
    'fss_other_parties',
    'fss_projects',
    'fss_departments',
    'fss_bank_accounts',
    'fss_categories',
    'fss_operation_receipts',
    'fss_income',
    'fss_financing',
    'fss_cash_inflow',
    'fss_outflow_oc_people',
    'fss_outflow_project_cost',
    'fss_outflow_tax_statutory',
    'fss_outflow_oc_travel',
    'fss_outflow_oc_professional_admin',
    'fss_outflow_oc_office_fixed',
    'fss_outflow_oc_office_variable',
    'fss_outflow_capex',
    'fss_outflow_financing_and_owner',
    'fss_audit_log',
    'fss_by_account_credited_debited',
    'fss_by_account_transfer'
  ];

  console.log('Checking tables in public schema:');
  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*').limit(1);
    if (error) {
      console.log(`❌ public.${t}: ${error.message} (${error.code})`);
    } else {
      console.log(`✅ public.${t}: OK (count: ${data?.length})`);
    }
  }
}

checkPublic().catch(console.error);

