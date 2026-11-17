const supabaseUrl = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

async function fetchSwaggerFss() {
  const res = await fetch(`${supabaseUrl}/rest/v1/?apikey=${supabaseKey}`, {
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      'Accept-Profile': 'fss'
    }
  });
  console.log('Status:', res.status);
  const data = await res.json();
  const paths = Object.keys(data.paths || {});
  console.log('Total paths in fss schema:', paths.length);
  console.log('Paths:', paths);
  console.log('Definitions in fss schema:', Object.keys(data.definitions || {}));
}

fetchSwaggerFss().catch(console.error);

