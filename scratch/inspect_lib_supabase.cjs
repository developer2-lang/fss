const fs = require('fs');

const content = fs.readFileSync('src/lib/supabase.ts', 'utf8');
const lines = content.split('\n');

console.log('Searching src/lib/supabase.ts...');
lines.forEach((line, idx) => {
  const lineNum = idx + 1;
  if (line.includes('.rpc(')) {
    console.log(`RPC [L${lineNum}]: ${line.trim()}`);
  }
  if (line.includes('postgres_changes') || line.includes('schema:')) {
    console.log(`REALTIME/SCHEMA [L${lineNum}]: ${line.trim()}`);
  }
  if (line.includes('public.') || line.includes("'public'") || line.includes('"public"')) {
    console.log(`PUBLIC [L${lineNum}]: ${line.trim()}`);
  }
});

