const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectColumns() {
  // Let's test inserting an empty object to see what required columns or column errors occur
  const { data, error } = await supabase
    .from('fss_transactions')
    .insert([{}])
    .select();

  console.log('Insert result:', { data, error });

  // Let's also check OpenAPI spec paths
  const res = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`
    }
  });
  const spec = await res.json();
  const defs = Object.keys(spec.definitions || {}).filter(k => k.includes('transaction'));
  console.log('Matching definitions in spec:', defs);
  for (const d of defs) {
    console.log(`Definition ${d}:`, Object.keys(spec.definitions[d]?.properties || {}));
  }
}

inspectColumns();

