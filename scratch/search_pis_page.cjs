const fs = require('fs');

const content = fs.readFileSync('src/lib/coreEngine.ts', 'utf8');
const lines = content.split('\n');

lines.forEach((l, i) => {
  if (
    l.includes('Proforma invoices') ||
    l.includes('new-pi') ||
    l.includes('New PI') ||
    l.includes("name: 'pis'") ||
    l.includes("route === 'pis'") ||
    l.includes("page === 'pis'")
  ) {
    console.log((i + 1) + ': ' + l.trim().slice(0, 160));
  }
});

