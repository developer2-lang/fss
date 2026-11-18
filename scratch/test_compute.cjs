const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(supabaseUrl, supabaseKey);

function normalizeAccountName(s) {
  return String(s || '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
}

const BY_ACCOUNT_CD_MONTH_COLS = [
  'jan', 'feb', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

const BY_ACCOUNT_CD_MONTH_MAP = {
  '01': 'jan', '02': 'feb', '03': 'march', '04': 'april',
  '05': 'may', '06': 'june', '07': 'july', '08': 'august',
  '09': 'september', '10': 'october', '11': 'november', '12': 'december'
};

function recomputeByAccountCreditedDebitedFyAndShares(rows) {
  const rowsWithFy = rows.map((row) => {
    let sum = 0;
    let hasAnyValue = false;
    for (const col of BY_ACCOUNT_CD_MONTH_COLS) {
      if (row[col] != null && !isNaN(Number(row[col]))) {
        sum += Number(row[col]);
        hasAnyValue = true;
      }
    }
    return {
      ...row,
      fy_to_date: hasAnyValue ? Math.round(sum * 100) / 100 : null
    };
  });

  const creditedRows = rowsWithFy.filter((r) => String(r.transaction_type || '').toLowerCase() === 'credited');
  const debitedRows = rowsWithFy.filter((r) => String(r.transaction_type || '').toLowerCase() === 'debited');

  const totalCredited = creditedRows.reduce((acc, r) => acc + (Number(r.fy_to_date) || 0), 0);
  const totalDebited = debitedRows.reduce((acc, r) => acc + (Number(r.fy_to_date) || 0), 0);

  return rowsWithFy.map((row) => {
    const isCredited = String(row.transaction_type || '').toLowerCase() === 'credited';
    const total = isCredited ? totalCredited : totalDebited;
    let shares = null;
    if (row.fy_to_date != null && total > 0) {
      shares = Math.round(((Number(row.fy_to_date) || 0) / total) * 1000) / 10;
    }
    return {
      ...row,
      shares
    };
  });
}

function computeByAccountCreditedDebitedRows(
  entries = [],
  existingRows = [],
  accounts = [],
  currentFy = 2026
) {
  const seenEntries = new Set();
  const dedupedEntries = [];
  for (const e of (entries || [])) {
    if (!e || e.deleted || String(e.status || '').toLowerCase().includes('cancel')) continue;

    const sbId = e.supabase_id ? String(e.supabase_id) : (e.id && String(e.id).includes('-') ? String(e.id) : '');
    if (sbId && seenEntries.has(`id:${sbId}`)) continue;
    if (sbId) seenEntries.add(`id:${sbId}`);

    const date = String(e.date || e.transaction_date || '').slice(0, 10);
    const type = String(e.type || e.transaction_type || '').toLowerCase();
    const amt = Math.round(Math.abs(Number(
      e.net_cash != null && e.net_cash !== ''
        ? e.net_cash
        : e.amount != null && e.amount !== '' && e.amount !== 0
          ? e.amount
          : e.netAmount != null && e.netAmount !== ''
            ? e.netAmount
            : (+e.taxable || 0) + (+e.gstAmount || 0) - (+e.tdsAmount || 0)
    )) * 100);
    const cat = String(e.category || e.categoryName || '').trim().toLowerCase();
    const party = String(e.party_name || e.partyName || e.party || '').trim().toLowerCase();
    const desc = String(e.description || e.refNo || e.ref_no || '').trim().toLowerCase();
    const acc = normalizeAccountName(e.account_name || e.accountName || e.paid_from || e.received_into || e.account || e.accountId || '');

    const sig = `sig:${date}|${type}|${amt}|${cat}|${party || desc}|${acc}`;
    if (seenEntries.has(sig)) continue;
    seenEntries.add(sig);
    dedupedEntries.push(e);
  }

  const accountNames = new Set();
  (existingRows || []).forEach(r => {
    if (r.account_name && String(r.account_name).trim()) {
      accountNames.add(String(r.account_name).trim());
    }
  });
  (accounts || []).forEach(a => {
    if (a.name && String(a.name).trim()) {
      const existing = Array.from(accountNames).find(name => normalizeAccountName(name) === normalizeAccountName(a.name));
      if (!existing) accountNames.add(String(a.name).trim());
    }
  });

  const monthEntries = BY_ACCOUNT_CD_MONTH_COLS.map(col => {
    const monthNum = Object.keys(BY_ACCOUNT_CD_MONTH_MAP).find(k => BY_ACCOUNT_CD_MONTH_MAP[k] === col) || '01';
    return { col, monthNum };
  });

  const rows = [];

  for (const accName of accountNames) {
    const normTarget = normalizeAccountName(accName);
    const targetAcc = (accounts || []).find((a) => normalizeAccountName(a.name) === normTarget);
    const targetId = targetAcc?.id;
    const targetSbId = targetAcc?.supabase_id;

    const isTargetFixed = normTarget.includes('fixed') || normTarget.includes('fd');
    const isTargetPetty = normTarget.includes('petty') || normTarget.includes('cash');
    const isTargetCurrent = normTarget.includes('current');
    const isTargetSavings = normTarget.includes('saving');

    const matchesAccount = (entry, isCredit) => {
      let entryAccName = '';
      let entryAccId = '';

      if (!isCredit) {
        entryAccName = entry.paid_from || entry.account_name || entry.accountName || entry.account || '';
        entryAccId = entry.accountId;
      } else {
        const accId = (entry.type === 'transfer' && entry.toAccountId) ? entry.toAccountId : entry.accountId;
        entryAccName = entry.received_into || entry.account_name || entry.accountName || entry.account || '';
        entryAccId = accId;
      }

      if (!entryAccName && entryAccId) {
        const found = (accounts || []).find((a) => a.id === entryAccId || (a.supabase_id && String(a.supabase_id) === String(entryAccId)));
        if (found) entryAccName = found.name || '';
      }

      if (entryAccId && targetId && (entryAccId === targetId || (targetSbId && String(entryAccId) === String(targetSbId)))) {
        return true;
      }

      const normEntry = normalizeAccountName(entryAccName);
      if (!normEntry) return false;

      const isEntryFixed = normEntry.includes('fixed') || normEntry.includes('fd');
      if (isTargetFixed !== isEntryFixed) return false;

      const isEntryPetty = normEntry.includes('petty') || normEntry.includes('cash');
      if (isTargetPetty !== isEntryPetty) return false;

      const isEntryCurrent = normEntry.includes('current');
      const isEntrySavings = normEntry.includes('saving');
      if (isTargetCurrent && isEntrySavings) return false;
      if (isTargetSavings && isEntryCurrent) return false;

      if (normTarget.includes('hdfc') && !normEntry.includes('hdfc')) return false;
      if (normTarget.includes('icici') && !normEntry.includes('icici')) return false;
      if (normEntry.includes('hdfc') && !normTarget.includes('hdfc')) return false;
      if (normEntry.includes('icici') && !normTarget.includes('icici')) return false;

      if (normEntry === normTarget) return true;
      if (normEntry.includes(normTarget) || normTarget.includes(normEntry)) return true;

      const cClean = normEntry.replace(/[-–\s]/g, '');
      const tClean = normTarget.replace(/[-–\s]/g, '');
      return cClean === tClean || cClean.includes(tClean) || tClean.includes(cClean);
    };

    const existingCredited = (existingRows || []).find(r => normalizeAccountName(r.account_name) === normTarget && String(r.transaction_type || '').toLowerCase() === 'credited');
    const existingDebited = (existingRows || []).find(r => normalizeAccountName(r.account_name) === normTarget && String(r.transaction_type || '').toLowerCase() === 'debited');

    const creditedRow = {
      ...(existingCredited || {}),
      account_name: existingCredited?.account_name || accName,
      transaction_type: 'Credited'
    };
    const debitedRow = {
      ...(existingDebited || {}),
      account_name: existingDebited?.account_name || accName,
      transaction_type: 'Debited'
    };

    for (const { col, monthNum } of monthEntries) {
      const matching = dedupedEntries.filter(e => {
        const d = String(e.date || e.transaction_date || '').slice(0, 7);
        if (!d) return false;
        const [yStr, mStr] = d.split('-');
        if (mStr !== monthNum) return false;
        const y = Number(yStr);
        if (Number(monthNum) >= 4) {
          if (y !== currentFy) return false;
        } else {
          if (y !== currentFy + 1) return false;
        }
        return true;
      });

      // 1. Debited
      const debitedEntries = matching.filter(e => {
        if (e.type === 'outflow' || String(e.transaction_type || '').toLowerCase() === 'outflow') return matchesAccount(e, false);
        if (e.type === 'transfer') return matchesAccount(e, false);
        return false;
      });
      const debitedSum = debitedEntries.reduce((sum, e) => {
        const val = Math.abs(Number(
          e.net_cash != null && e.net_cash !== ''
            ? e.net_cash
            : e.amount != null && e.amount !== '' && e.amount !== 0
              ? e.amount
              : e.netAmount != null && e.netAmount !== ''
                ? e.netAmount
                : (+e.taxable || 0) + (+e.gstAmount || 0) - (+e.tdsAmount || 0)
        ));
        return sum + val;
      }, 0);
      if (debitedEntries.length > 0) {
        debitedRow[col] = Math.round(debitedSum * 100) / 100;
      } else {
        debitedRow[col] = null;
      }

      // 2. Credited
      const creditedEntries = matching.filter(e => {
        if (e.type === 'inflow' || String(e.transaction_type || '').toLowerCase() === 'inflow') return matchesAccount(e, true);
        if (e.type === 'transfer') return matchesAccount(e, true);
        return false;
      });
      const creditedSum = creditedEntries.reduce((sum, e) => {
        const val = Math.abs(Number(
          e.net_cash != null && e.net_cash !== ''
            ? e.net_cash
            : e.amount != null && e.amount !== '' && e.amount !== 0
              ? e.amount
              : e.netAmount != null && e.netAmount !== ''
                ? e.netAmount
                : (+e.taxable || 0) + (+e.gstAmount || 0) - (+e.tdsAmount || 0)
        ));
        return sum + val;
      }, 0);
      if (creditedEntries.length > 0) {
        creditedRow[col] = Math.round(creditedSum * 100) / 100;
      } else {
        creditedRow[col] = null;
      }
    }

    rows.push(creditedRow, debitedRow);
  }

  return recomputeByAccountCreditedDebitedFyAndShares(rows);
}

async function testFunction() {
  let allTxns = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('fss_table_transactions')
      .select('*')
      .range(from, from + batchSize - 1);
    if (error) break;
    allTxns.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  const { data: existingRows } = await supabase.from('fss_by_account_credited_debited').select('*');
  const accounts = [
    { name: 'HDFC Bank – Current' },
    { name: 'ICICI Bank – Current' },
    { name: 'Petty Cash' },
    { name: 'HDFC Fixed Deposit' }
  ];

  const results = computeByAccountCreditedDebitedRows(allTxns, existingRows, accounts, 2026);
  results.forEach(r => {
    console.log(`[${r.account_name} - ${r.transaction_type}] Nov: ${r.november} | FY: ${r.fy_to_date} | Share: ${r.shares}%`);
  });
}

testFunction();

