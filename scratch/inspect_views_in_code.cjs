const fs = require('fs');
const content = fs.readFileSync('src/lib/supabase.ts', 'utf8');
const lines = content.split('\n');

function inspectPattern(name) {
  console.log(`=== Matches for ${name} ===`);
  lines.forEach((l, i) => {
    if (l.includes(name)) {
      console.log(`L${i + 1}: ${l.trim()}`);
    }
  });
}

inspectPattern('fss_cash_inflow');
inspectPattern('fss_outflow_oc_people_report');
inspectPattern('fss_by_account_credited_debited');

