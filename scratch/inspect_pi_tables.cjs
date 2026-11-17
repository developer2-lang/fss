const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'fss' }
});

async function main() {
  const tables = ['proforma_invoices', 'proforma_invoice_attachments', 'proforma_invoice_emails', 'proforma_invoice_recipients'];
  
  for (const table of tables) {
    const res = await supabase.from(table).select('*').limit(1);
    console.log(`Table: ${table}`);
    if (res.error) {
      console.log('  Error:', res.error.message);
    } else {
      console.log('  Data (0 or 1 rows):', res.data);
    }
  }

  // Also query OpenAPI definition to get full column schemas for proforma_invoices
  try {
    const openApiUrl = `${SUPABASE_URL}/rest/v1/?apikey=${SUPABASE_ANON_KEY}`;
    const resp = await fetch(openApiUrl, {
      headers: {
        'Accept-Profile': 'fss',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    if (resp.ok) {
      const spec = await resp.json();
      for (const table of tables) {
        const def = spec.definitions ? spec.definitions[table] : null;
        if (def && def.properties) {
          console.log(`\nColumns for ${table}:`);
          console.log(Object.keys(def.properties).map(k => `  ${k}: ${def.properties[k].type} (${def.properties[k].format || ''})`).join('\n'));
          console.log('Required:', def.required);
        } else {
          console.log(`No definition found for ${table} in OpenAPI spec`);
        }
      }
    } else {
      console.log('OpenAPI fetch status:', resp.status);
    }
  } catch (e) {
    console.error('OpenAPI fetch error:', e.message);
  }
}

main().catch(console.error);
