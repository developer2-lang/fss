const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: {
    schema: 'fss'
  }
});

async function check() {
  const tables = [
    'fss_outflow_project_cost',
    'fss_outflow_tax_statutory',
    'fss_outflow_travel',
    'fss_outflow_oc_professional_admin',
    'fss_outflow_oc_office_fixed',
    'fss_outflow_oc_office_variable'
  ];

  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*');
    if (error) {
      console.log('Error on table', t, error.message);
    } else {
      console.log('\n=== Table:', t, 'Count:', data?.length);
      (data || []).forEach(r => {
        const cat = r.category || r.expense_name || r.name || r.id;
        const apr = r.apr26 ?? r.apr_26;
        const may = r.may26 ?? r.may_26;
        const jun = r.jun26 ?? r.jun_26;
        const jul = r.july26 ?? r.jul_26;
        const aug = r.aug26 ?? r.aug_26;
        const sep = r.sept26 ?? r.sep_26;
        const oct = r.oct26 ?? r.oct_26;
        const nov = r.nov26 ?? r.nov_26;
        const dec = r.dec26 ?? r.dec_26;
        console.log(`  Row: "${cat}" | apr: ${apr} | may: ${may} | jun: ${jun} | jul: ${jul} | aug: ${aug} | sep: ${sep} | oct: ${oct} | nov: ${nov} | dec: ${dec} | fy: ${r.fy_to_date}`);
      });
    }
  }
}

check().catch(console.error);
