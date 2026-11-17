const fs = require('fs');

const content = fs.readFileSync('src/lib/coreEngine.ts', 'utf8');
const lines = content.split('\n');

console.log('Searching in src/lib/coreEngine.ts...');
lines.forEach((line, idx) => {
  if (
    line.includes('PO number') ||
    line.includes('New project code') ||
    line.includes('New project name') ||
    line.includes('New order') ||
    line.includes('order-modal') ||
    line.includes('modal-order') ||
    line.includes('openOrderModal') ||
    line.includes('orderNo') ||
    line.includes('order_number')
  ) {
    console.log(`L${idx + 1}: ${line.trim().slice(0, 150)}`);
  }
});

