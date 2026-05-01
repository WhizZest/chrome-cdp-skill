let passed = 0;
let failed = 0;
const failures = [];
const queue = [];

export function test(name, fn) {
  queue.push({ name, fn, async: false });
}

export function testAsync(name, fn) {
  queue.push({ name, fn, async: true });
}

export function describe(suiteName, fn) {
  console.log(`\n${suiteName}`);
  fn();
}

export async function summary() {
  for (const t of queue) {
    try {
      if (t.async) {
        await t.fn();
      } else {
        t.fn();
      }
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      failed++;
      failures.push({ name: t.name, error: e });
      console.log(`  ✗ ${t.name}`);
      console.log(`    ${e.message}`);
    }
  }
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
      console.log(`    - ${f.name}: ${f.error.message}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}
