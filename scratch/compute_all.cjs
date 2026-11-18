const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(supabaseUrl, supabaseKey);

function normalizeAccountName(s) {
  return String(s || '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function compute() {
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
  console.log('Total txns loaded:', allTxns.length);

  // Filter FY 2026-27 (2026-04-01 to 2027-03-31)
  const fyTxns = allTxns.filter(t => {
    if (t.deleted || String(t.status || '').toLowerCase().includes('cancel')) return false;
    const d = String(t.transaction_date || t.date || '').slice(0, 10);
    return d >= '2026-04-01' && d <= '2027-03-31';
  });

  // Deduplicate
  const seen = new Set();
  const deduped = [];
  for (const t of fyTxns) {
    const id = t.id ? String(t.id) : '';
    if (id && seen.has(`id:${id}`)) continue;
    if (id) seen.add(`id:${id}`);

    const date = String(t.transaction_date || t.date || '').slice(0, 10);
    const type = String(t.type || t.transaction_type || '').toLowerCase();
    const amt = Math.round(Math.abs(Number(t.net_cash != null ? t.net_cash : t.amount)) * 100);
    const cat = String(t.category || '').trim().toLowerCase();
    const party = String(t.party_name || '').trim().toLowerCase();
    const desc = String(t.description || '').trim().toLowerCase();
    const acc = normalizeAccountName(t.account_name || t.paid_from || t.received_into || '');

    const sig = `sig:${date}|${type}|${amt}|${cat}|${party || desc}|${acc}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    deduped.push(t);
  }

  console.log(`Deduplicated FY 2026-27 transactions: ${deduped.length}`);

  const months = [
    { key: 'april', num: '04' },
    { key: 'may', num: '05' },
    { key: 'june', num: '06' },
    { key: 'july', num: '07' },
    { key: 'august', num: '08' },
    { key: 'september', num: '09' },
    { key: 'october', num: '10' },
    { key: 'november', num: '11' },
    { key: 'december', num: '12' },
    { key: 'jan', num: '01' },
    { key: 'feb', num: '02' },
    { key: 'march', num: '03' },
  ];

  const accounts = ['HDFC Bank – Current', 'ICICI Bank – Current', 'Petty Cash', 'HDFC Fixed Deposit'];

  for (const acc of accounts) {
    const norm = normalizeAccountName(acc);
    console.log(`\n=== ACCOUNT: ${acc} ===`);

    for (const type of ['Inflow', 'Outflow']) {
      const isCredit = type === 'Inflow';
      const label = isCredit ? 'CREDITED' : 'DEBITED';
      let fyTotal = 0;
      const monthVals = {};

      for (const m of months) {
        const mTxns = deduped.filter(t => {
          const d = String(t.transaction_date || t.date || '').slice(0, 7);
          const tType = String(t.type || t.transaction_type || '').toLowerCase();
          if (isCredit && tType !== 'inflow') return false;
          if (!isCredit && tType !== 'outflow') return false;

          const accName = normalizeAccountName(t.account_name || (isCredit ? t.received_into : t.paid_from) || '');
          if (!accName.includes(norm.replace('–', '-').split('-')[0].trim())) return false;
          if (norm.includes('petty') !== accName.includes('petty')) return false;
          if (norm.includes('fixed') !== accName.includes('fixed')) return false;

          const parts = d.split('-');
          return parts[1] === m.num;
        });

        const sum = mTxns.reduce((s, t) => s + Math.abs(Number(t.net_cash != null ? t.net_cash : t.amount)), 0);
        if (sum > 0) {
          monthVals[m.key] = sum;
          fyTotal += sum;
        } else {
          monthVals[m.key] = null;
        }
      }
      console.log(`${label}: FY Total = ₹${fyTotal.toLocaleString('en-IN')}`);
      console.log(monthVals);
    }
  }
}

compute();

