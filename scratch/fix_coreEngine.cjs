const { execSync } = require('child_process');
const fs = require('fs');

const current = fs.readFileSync('src/lib/coreEngine.ts', 'utf8').split('\n');
const prefix = current.slice(0, 5626); // ends at line 5626: <div class="em-grid">

const full43 = execSync('git show 43a061b:src/lib/coreEngine.ts').toString().split('\n');
// line 4801 in full43: index 4800 is `<div class="em-grid">`, index 4801 is `<div class="lbl">To</div>...`
const suffix = full43.slice(4801);

console.log('Prefix ends with:', prefix[prefix.length - 1]);
console.log('Suffix starts with:', suffix[0]);

const combined = prefix.concat(suffix).join('\n');
fs.writeFileSync('src/lib/coreEngine.ts', combined, 'utf8');
console.log('Successfully wrote combined file! Total lines:', prefix.length + suffix.length);

