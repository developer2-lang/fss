const fs = require('fs');

const content = fs.readFileSync('src/lib/supabase.ts', 'utf8');
const lines = content.split('\n');

const tables = new Set();
const tableRegex = /\.from\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
const tableVarRegex = /\.from\(\s*([a-zA-Z0-9_]+)\s*\)/g;

let match;
while ((match = tableRegex.exec(content)) !== null) {
  tables.add(match[1]);
}

const vars = new Set();
while ((match = tableVarRegex.exec(content)) !== null) {
  if (match[1] !== 'tableName' && match[1] !== 'table' && match[1] !== 'TRAVEL_TABLE') {
    vars.add(match[1]);
  } else {
    vars.add(`(var: ${match[1]})`);
  }
}

console.log('Explicit table names used in supabase.from():');
console.log(Array.from(tables).sort());

console.log('\nVariable table names used in supabase.from():');
console.log(Array.from(vars).sort());

