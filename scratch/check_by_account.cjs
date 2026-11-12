const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('fss_by_account_credited_debited')
    .select('*');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${data.length} rows:`);
  data.forEach(r => {
    console.log(`Account: [${r.account_name}], Type: [${r.transaction_type}], Nov: [${r.nov}], Total: [${r.total || r.fy_total || r.fy_to_date}]`);
    console.log(JSON.stringify(r));
  });
}

check();

