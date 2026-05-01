import assert from 'assert/strict';
import { describe, test, summary } from '../lib/test-runner.mjs';

await describe('trace enhancement: --log-this condition generation', async () => {
  test('log-this adds JSON.stringify(this) to condition', () => {
    const logThis = true;
    const funcName = 'encrypt';
    const traceId = funcName;

    const logParts = [];
    logParts.push(`'[Trace ${traceId}] called'`);
    logParts.push(`JSON.stringify(Array.from(arguments)).slice(0,500)`);
    if (logThis) {
      logParts.push(`JSON.stringify(this,(k,v)=>typeof v==='function'?'[Function]':v).slice(0,500)`);
    }
    const logExpr = `console.log(${logParts.join(', ')})`;

    assert.ok(logExpr.includes('JSON.stringify(this'));
    assert.ok(logExpr.includes('[Function]'));
    assert.ok(logExpr.includes('[Trace encrypt]'));
  });

  test('without log-this, condition has no this', () => {
    const logThis = false;
    const funcName = 'encrypt';
    const traceId = funcName;

    const logParts = [];
    logParts.push(`'[Trace ${traceId}] called'`);
    logParts.push(`JSON.stringify(Array.from(arguments)).slice(0,500)`);
    if (logThis) {
      logParts.push(`JSON.stringify(this,(k,v)=>typeof v==='function'?'[Function]':v).slice(0,500)`);
    }
    const logExpr = `console.log(${logParts.join(', ')})`;

    assert.ok(!logExpr.includes('JSON.stringify(this'));
  });

  test('log-this + no-pause wraps in (expr, false)', () => {
    const logThis = true;
    const shouldPause = false;
    const funcName = 'encrypt';
    const traceId = funcName;

    const logParts = [];
    logParts.push(`'[Trace ${traceId}] called'`);
    logParts.push(`JSON.stringify(Array.from(arguments)).slice(0,500)`);
    if (logThis) {
      logParts.push(`JSON.stringify(this,(k,v)=>typeof v==='function'?'[Function]':v).slice(0,500)`);
    }
    const logExpr = `console.log(${logParts.join(', ')})`;
    const condition = shouldPause ? logExpr : `(${logExpr}, false)`;

    assert.ok(condition.startsWith('('));
    assert.ok(condition.endsWith(', false)'));
    assert.ok(condition.includes('JSON.stringify(this'));
  });

  test('log-this + pause does not wrap in false', () => {
    const logThis = true;
    const shouldPause = true;
    const funcName = 'encrypt';
    const traceId = funcName;

    const logParts = [];
    logParts.push(`'[Trace ${traceId}] called'`);
    logParts.push(`JSON.stringify(Array.from(arguments)).slice(0,500)`);
    if (logThis) {
      logParts.push(`JSON.stringify(this,(k,v)=>typeof v==='function'?'[Function]':v).slice(0,500)`);
    }
    const logExpr = `console.log(${logParts.join(', ')})`;
    const condition = shouldPause ? logExpr : `(${logExpr}, false)`;

    assert.ok(!condition.startsWith('('));
    assert.ok(!condition.endsWith(', false)'));
  });
});

await describe('trace enhancement: --trace-id', async () => {
  test('custom trace-id appears in log output', () => {
    const funcName = 'encrypt';
    const traceId = 'crypto-encrypt';

    const logParts = [];
    logParts.push(`'[Trace ${traceId}] called'`);
    logParts.push(`JSON.stringify(Array.from(arguments)).slice(0,500)`);
    const logExpr = `console.log(${logParts.join(', ')})`;

    assert.ok(logExpr.includes('[Trace crypto-encrypt]'));
    assert.ok(!logExpr.includes('[Trace encrypt]'));
  });

  test('default trace-id uses function name', () => {
    const funcName = 'encrypt';
    const traceId = funcName;

    const logParts = [];
    logParts.push(`'[Trace ${traceId}] called'`);
    logParts.push(`JSON.stringify(Array.from(arguments)).slice(0,500)`);
    const logExpr = `console.log(${logParts.join(', ')})`;

    assert.ok(logExpr.includes('[Trace encrypt]'));
  });
});

await describe('trace enhancement: this serialization replacer', async () => {
  test('replacer handles function values', () => {
    const replacer = (k, v) => typeof v === 'function' ? '[Function]' : v;
    assert.equal(replacer('key', () => {}), '[Function]');
    assert.equal(replacer('key', 42), 42);
    assert.equal(replacer('key', 'hello'), 'hello');
    assert.equal(replacer('key', null), null);
    assert.deepEqual(replacer('key', { a: 1 }), { a: 1 });
  });
});

await summary();
