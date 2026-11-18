const supabaseUrl = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

async function fetchSwagger() {
  const res = await fetch(`${supabaseUrl}/rest/v1/?apikey=${supabaseKey}`, {
    headers: {
      Authorization: `Bearer ${supabaseKey}`
    }
  });
  const data = await res.json();
  console.log('Tables/paths available:');
  const paths = Object.keys(data.paths || {});
  console.log('Total paths:', paths.length);
  console.log('All paths containing "transaction" or "fss":');
  console.log(paths.filter(p => p.includes('transaction') || p.includes('fss')));

  const rpcPaths = paths.filter(p => p.startsWith('/rpc/'));
  console.log('\nAll RPC paths:', rpcPaths);

  if (data.definitions?.fss_transactions) {
    console.log('fss_transactions schema:', data.definitions.fss_transactions);
  } else {
    console.log('Definitions containing transaction:');
    console.log(Object.keys(data.definitions || {}).filter(k => k.includes('trans')));
  }
}

fetchSwagger();

