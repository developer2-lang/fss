const fs = require('fs');
const path = require('path');

function searchDir(dir) {
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      searchDir(full);
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (
          line.includes('supabaseClient') ||
          (line.includes('supabase') && line.includes('from')) ||
          line.includes('.from(') ||
          line.includes('.rpc(')
        ) {
          console.log(`${full}:${idx + 1} -> ${line.trim()}`);
        }
      });
    }
  }
}

searchDir('src');

