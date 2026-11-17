const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function inspectViews() {
  for (const v of ['fss_cash_inflow', 'fss_outflow_oc_people_report', 'fss_by_account_credited_debited']) {
    const { data, error } = await supabase.from(v).select('*').limit(2);
    if (error) {
      console.log(`View ${v} error:`, error.message);
    } else {
      console.log(`\n=== View ${v} (rows: ${data?.length}) ===`);
      console.log(data?.[0]);
    }
  }
}

inspectViews().catch(console.error);

