const fs = require('fs');
const path = require('path');

const targetDirs = ['src', 'api', 'supabase/functions', 'scripts'];
const matches = [];

function checkFile(full) {
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

function search(dir) {
  if (!fs.existsSync(dir)) return;
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      search(full);
    } else {
      checkFile(full);
    }
  }
}

targetDirs.forEach(d => search(d));
// Also check root files
['fss.html', 'index.html', 'vite.config.ts'].forEach(f => {
  if (fs.existsSync(f)) checkFile(f);
});

console.log(`Found ${matches.length} matches in app & api files:`);
matches.forEach(m => console.log(`${m.file}:${m.line} -> ${m.text}`));

