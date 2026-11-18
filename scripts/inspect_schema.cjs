const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: {
    schema: 'fss'
  }
});

async function inspectSchema() {
  const tables = [
    'fss_outflow_project_cost',
    'fss_outflow_tax_statutory',
    'fss_outflow_travel',
    'fss_outflow_oc_professional_admin',
    'fss_outflow_oc_office_fixed',
    'fss_outflow_oc_office_variable'
  ];

  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*').limit(1);
    if (error) {
      console.log('Error inspecting', t, error);
    } else if (data && data[0]) {
      console.log(t, 'keys:', Object.keys(data[0]));
    }
  }
}

inspectSchema().catch(console.error);

