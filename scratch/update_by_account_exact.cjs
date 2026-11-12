const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(supabaseUrl, supabaseKey);

async function updateByAccountTable() {
  const updates = [
    {
      id: 1, // HDFC Bank - Current, Credited
      account_name: 'HDFC Bank – Current',
      transaction_type: 'Credited',
      april: 2797200,
      may: 2538000,
      june: 2161912,
      july: 3742800,
      august: 399600,
      september: 1967512,
      october: 574023,
      november: 1900,
      december: null,
      jan: null,
      feb: null,
      march: null,
      fy_to_date: 14182947,
      shares: 51.3,
      updated_at: new Date().toISOString()
    },
    {
      id: 2, // HDFC Bank - Current, Debited
      account_name: 'HDFC Bank – Current',
      transaction_type: 'Debited',
      april: 2634999,
      may: 2777074,
      june: 3484853,
      july: 2723634,
      august: 2557750,
      september: 3114999,
      october: 10900,
      november: 46422,
      december: null,
      jan: null,
      feb: null,
      march: null,
      fy_to_date: 17350631,
      shares: 92.1,
      updated_at: new Date().toISOString()
    },
    {
      id: 3, // ICICI Bank - Current, Credited
      account_name: 'ICICI Bank – Current',
      transaction_type: 'Credited',
      april: 129600,
      may: 1360800,
      june: 1198800,
      july: 129600,
      august: 2527200,
      september: 1555200,
      october: 6544680,
      november: 4372,
      december: null,
      jan: null,
      feb: null,
      march: null,
      fy_to_date: 13450252,
      shares: 48.7,
      updated_at: new Date().toISOString()
    },
    {
      id: 4, // ICICI Bank - Current, Debited
      account_name: 'ICICI Bank – Current',
      transaction_type: 'Debited',
      april: 145251,
      may: 57539,
      june: 542571,
      july: 149095,
      august: 369897,
      september: 155055,
      october: null,
      november: null,
      december: null,
      jan: null,
      feb: null,
      march: null,
      fy_to_date: 1419408,
      shares: 7.5,
      updated_at: new Date().toISOString()
    },
    {
      id: 5, // HDFC Fixed Deposit, Credited
      account_name: 'HDFC Fixed Deposit',
      transaction_type: 'Credited',
      april: null,
      may: null,
      june: null,
      july: null,
      august: null,
      september: null,
      october: null,
      november: null,
      december: null,
      jan: null,
      feb: null,
      march: null,
      fy_to_date: null,
      shares: null,
      updated_at: new Date().toISOString()
    },
    {
      id: 6, // HDFC Fixed Deposit, Debited
      account_name: 'HDFC Fixed Deposit',
      transaction_type: 'Debited',
      april: null,
      may: null,
      june: null,
      july: null,
      august: null,
      september: null,
      october: null,
      november: null,
      december: null,
      jan: null,
      feb: null,
      march: null,
      fy_to_date: null,
      shares: null,
      updated_at: new Date().toISOString()
    },
    {
      id: 7, // Petty Cash, Credited
      account_name: 'Petty Cash',
      transaction_type: 'Credited',
      april: null,
      may: null,
      june: null,
      july: null,
      august: null,
      september: null,
      october: null,
      november: null,
      december: null,
      jan: null,
      feb: null,
      march: null,
      fy_to_date: null,
      shares: null,
      updated_at: new Date().toISOString()
    },
    {
      id: 8, // Petty Cash, Debited
      account_name: 'Petty Cash',
      transaction_type: 'Debited',
      april: 9500,
      may: 11900,
      june: 13400,
      july: 11800,
      august: 14000,
      september: 16300,
      october: null,
      november: null,
      december: null,
      jan: null,
      feb: null,
      march: null,
      fy_to_date: 76900,
      shares: 0.4,
      updated_at: new Date().toISOString()
    }
  ];

  for (const row of updates) {
    const { id, ...payload } = row;
    const { data, error } = await supabase
      .from('fss_by_account_credited_debited')
      .update(payload)
      .eq('id', id)
      .select();

    if (error) {
      console.error(`Error updating id ${id}:`, error);
    } else {
      console.log(`Updated row id ${id} (${payload.account_name} ${payload.transaction_type}):`, data);
    }
  }

  console.log('Finished updating Supabase table fss_by_account_credited_debited.');
}

updateByAccountTable();

