const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectTransactions() {
  let allTxns = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('fss_table_transactions')
      .select('*')
      .range(from, from + batchSize - 1);
    if (error) {
      console.error(error);
      break;
    }
    allTxns.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  console.log('Total raw transactions loaded:', allTxns.length);

  // Check November 2026 transactions
  const novTxns = allTxns.filter(t => {
    const d = String(t.transaction_date || t.date || '').slice(0, 7);
    return d === '2026-11' && !t.deleted && !String(t.status || '').toLowerCase().includes('cancel');
  });

  console.log(`Active Nov 2026 transactions: ${novTxns.length}`);
  novTxns.forEach(t => {
    console.log(`[${t.transaction_date}] Type: ${t.type || t.transaction_type} | Net: ${t.net_cash || t.amount} | Acc: ${t.account_name || t.paid_from || t.received_into} | Cat: ${t.category} | Party: ${t.party_name} | Desc: ${t.description}`);
  });
}

inspectTransactions();

