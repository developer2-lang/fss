const fs = require('fs');
const path = require('path');

function search(dir) {
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      search(full);
    } else if (full.endsWith('.ts') || full.endsWith('.tsx') || full.endsWith('.js') || full.endsWith('.css')) {
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      lines.forEach((l, idx) => {
        if (l.toLowerCase().includes('public')) {
          console.log(`${full}:${idx + 1} -> ${l.trim()}`);
        }
      });
    }
  }
}

search('src');
search('api');

