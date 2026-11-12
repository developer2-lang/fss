const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkFssTransactionsTable() {
  const { data, error } = await supabase
    .from('fss_transactions')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error selecting from fss_transactions:', error);
  } else {
    console.log('fss_transactions data:', data);
  }

  // Let's also check column information by attempting an empty insert or checking PostgREST OpenAPI spec
  const res = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`
    }
  });
  const spec = await res.json();
  const fssTransactionsDef = spec.definitions?.fss_transactions;
  console.log('fss_transactions properties in OpenAPI definition:');
  console.log(JSON.stringify(fssTransactionsDef?.properties, null, 2));
}

checkFssTransactionsTable();

