const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'fss' }
});

async function testSync() {
  // Let's test syncOfficeFixedToSupabase with zero rows or zero amounts!
  const zeroRows = [
    { expense_name: 'Office Rent', apr26: 0, may26: 0, jun26: 0, july26: 0, aug26: 0, sept26: 0, oct26: 0, nov26: 0, dec26: 0 },
    { expense_name: 'Electricity', apr26: 0, may26: 0, jun26: 0, july26: 0, aug26: 0, sept26: 0, oct26: 0, nov26: 0, dec26: 0 },
    { expense_name: 'Internet & Phone', apr26: 0, may26: 0, jun26: 0, july26: 0, aug26: 0, sept26: 0, oct26: 0, nov26: 0, dec26: 0 },
    { expense_name: 'Software Subscriptions', apr26: 0, may26: 0, jun26: 0, july26: 0, aug26: 0, sept26: 0, oct26: 0, nov26: 0, dec26: 0 },
    { expense_name: 'Housekeeping & Security', apr26: 0, may26: 0, jun26: 0, july26: 0, aug26: 0, sept26: 0, oct26: 0, nov26: 0, dec26: 0 },
    { expense_name: 'Professional Tax', apr26: 0, may26: 0, jun26: 0, july26: 0, aug26: 0, sept26: 0, oct26: 0, nov26: 0, dec26: 0 },
    { expense_name: 'Office Fixed Total', apr26: 0, may26: 0, jun26: 0, july26: 0, aug26: 0, sept26: 0, oct26: 0, nov26: 0, dec26: 0 }
  ];

  for (const row of zeroRows) {
    const res = await supabase.from('fss_outflow_oc_office_fixed')
      .update({ nov26: 0, fy_to_date: 0, share: 0 })
      .ilike('expense_name', row.expense_name);
    console.log(`Update ${row.expense_name}:`, res.error ? res.error.message : 'OK');
  }
}

testSync().catch(console.error);

