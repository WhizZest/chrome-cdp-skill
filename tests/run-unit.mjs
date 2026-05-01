import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const unitDir = resolve(__dirname, 'unit');
const files = readdirSync(unitDir).filter(f => f.endsWith('.test.mjs'));

let passed = 0;
let failed = 0;

for (const f of files) {
  const path = resolve(unitDir, f);
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  ${f}`);
  console.log(`${'═'.repeat(50)}`);
  try {
    execSync(`node "${path}"`, { stdio: 'inherit' });
    passed++;
  } catch {
    failed++;
  }
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`  Test files: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
