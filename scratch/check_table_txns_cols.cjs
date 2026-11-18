const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCols() {
  const { data, error } = await supabase.from('fss_table_transactions').select('*').limit(1);
  if (data && data.length > 0) {
    console.log('Columns in fss_table_transactions:', Object.keys(data[0]));
    console.log('Sample row:', data[0]);
  }
}

checkCols();

