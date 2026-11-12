const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRPC() {
  // Check RPC functions
  const { data: rpcList, error: rpcErr } = await supabase.rpc('get_service_role_key');
  console.log('get_service_role_key:', { rpcList, rpcErr });

  // Check what RPC functions are available by querying common ones or OpenAPI
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`
    }
  });
  console.log('RPC endpoint status:', res.status);

  // Check edge functions
  const fnRes = await fetch(`${supabaseUrl}/functions/v1/`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`
    }
  });
  console.log('Functions endpoint status:', fnRes.status);
}

checkRPC();

