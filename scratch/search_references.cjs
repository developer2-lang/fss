const fs = require('fs');
const path = require('path');

const skip = new Set(['node_modules', '.git', 'dist', '.vercel', 'src-backup']);
const matches = [];

function search(dir) {
  for (const item of fs.readdirSync(dir)) {
    if (skip.has(item)) continue;
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      search(full);
    } else {
      const ext = path.extname(full);
      if (['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.html', '.sql', '.toml', '.json'].includes(ext)) {
        const content = fs.readFileSync(full, 'utf8');
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          const lower = line.toLowerCase();
          if (
            line.includes('createClient') ||
            line.includes('.schema(') ||
            lower.includes('public.') ||
            line.includes("'public'") ||
            line.includes('"public"') ||
            lower.includes('schema:') ||
            lower.includes('schema =') ||
            lower.includes('schemas =')
          ) {
            matches.push({ file: full, line: idx + 1, text: line.trim() });
          }
        });
      }
    }
  }
}

search('.');
const nonScratch = matches.filter(m => !m.file.startsWith('scratch'));
console.log(`Found ${nonScratch.length} matches (excluding scratch):`);
nonScratch.forEach(m => console.log(`${m.file}:${m.line} -> ${m.text}`));
