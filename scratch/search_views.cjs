const fs = require('fs');
const path = require('path');

const terms = ['fss_cash_inflow', 'fss_by_account_credited_debited', 'fss_outflow_oc_people_report'];

function search(dir) {
  for (const item of fs.readdirSync(dir)) {
    if (item === 'node_modules' || item === '.git' || item === 'dist') continue;
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      search(full);
    } else {
      const content = fs.readFileSync(full, 'utf8');
      terms.forEach(t => {
        if (content.includes(t)) {
          console.log(`Found "${t}" in ${full}`);
        }
      });
    }
  }
}

search('.');

