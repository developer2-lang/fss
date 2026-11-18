const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabaseFss = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'fss' }
});

const supabasePublic = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'public' }
});

async function check() {
  const fssRows = await supabaseFss.from('fss_outflow_oc_office_fixed').select('*');
  const pubRows = await supabasePublic.from('fss_outflow_oc_office_fixed').select('*');

  console.log('fss.fss_outflow_oc_office_fixed rows:');
  console.log(fssRows.data?.map(r => ({ id: r.id, name: r.expense_name, nov: r.nov26, fy: r.fy_to_date })));

  console.log('\npublic.fss_outflow_oc_office_fixed rows:');
  console.log(pubRows.data?.map(r => ({ id: r.id, name: r.expense_name, nov: r.nov26, fy: r.fy_to_date })));
}

check().catch(console.error);

