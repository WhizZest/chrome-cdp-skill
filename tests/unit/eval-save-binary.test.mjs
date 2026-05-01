import assert from 'assert/strict';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { describe, testAsync, summary } from '../lib/test-runner.mjs';

const EVAL_SRC = '../../skills/chrome-cdp/scripts/commands/eval.mjs';

function createMockCDP(responses = {}) {
  return {
    onEvent: () => () => {},
    send: (method, params = {}, sid) => {
      if (responses[method]) {
        const resp = responses[method];
        if (typeof resp === 'function') return Promise.resolve(resp(params));
        return Promise.resolve(resp);
      }
      return Promise.resolve({});
    },
    close: () => {},
  };
}

const SID = 'test-session-001';
const TEMP_DIR = path.join(os.tmpdir(), 'cdp-eval-test');

const mod = await import(EVAL_SRC);

describe('eval: parseEvalArgs', () => {
  testAsync('parses plain expression', () => {
    const result = mod.parseEvalArgs(['1+1']);
    assert.equal(result.expression, '1+1');
    assert.equal(result.saveFile, null);
    assert.equal(result.binary, false);
  });

  testAsync('parses --save flag', () => {
    const result = mod.parseEvalArgs(['1+1', '--save', 'output.txt']);
    assert.equal(result.expression, '1+1');
    assert.equal(result.saveFile, 'output.txt');
    assert.equal(result.binary, false);
  });

  testAsync('parses --binary flag', () => {
    const result = mod.parseEvalArgs(['fetch("/api/data")', '--binary']);
    assert.equal(result.expression, 'fetch("/api/data")');
    assert.equal(result.saveFile, null);
    assert.equal(result.binary, true);
  });

  testAsync('parses --binary --save together', () => {
    const result = mod.parseEvalArgs(['fetch("/api/data")', '--binary', '--save', 'data.bin']);
    assert.equal(result.expression, 'fetch("/api/data")');
    assert.equal(result.binary, true);
    assert.equal(result.saveFile, 'data.bin');
  });

  testAsync('flags before expression', () => {
    const result = mod.parseEvalArgs(['--binary', '--save', 'out.bin', 'myExpr']);
    assert.equal(result.expression, 'myExpr');
    assert.equal(result.binary, true);
    assert.equal(result.saveFile, 'out.bin');
  });

  testAsync('throws when --save has no filename', () => {
    assert.throws(
      () => mod.parseEvalArgs(['1+1', '--save']),
      /--save requires a filename/
    );
  });
});

describe('eval: wrapBinaryExpr', () => {
  testAsync('wraps expression in async IIFE with btoa', () => {
    const wrapped = mod.wrapBinaryExpr('fetch("/api").then(r=>r.arrayBuffer())');
    assert.ok(wrapped.includes('async'));
    assert.ok(wrapped.includes('btoa'));
    assert.ok(wrapped.includes('Uint8Array'));
    assert.ok(wrapped.includes('fetch("/api").then(r=>r.arrayBuffer())'));
  });

  testAsync('uses byteOffset/byteLength for views', () => {
    const wrapped = mod.wrapBinaryExpr('new Uint8Array([1,2,3])');
    assert.ok(wrapped.includes('byteOffset'));
    assert.ok(wrapped.includes('byteLength'));
  });

  testAsync('returns tagged object with __cdpBinary', () => {
    const wrapped = mod.wrapBinaryExpr('new ArrayBuffer(4)');
    assert.ok(wrapped.includes('__cdpBinary'));
    assert.ok(wrapped.includes('b64'));
  });
});

describe('eval: --save writes file', () => {
  testAsync('saves text result to file', async () => {
    mkdirSync(TEMP_DIR, { recursive: true });
    const cdp = createMockCDP({
      'Runtime.enable': {},
      'Runtime.evaluate': () => ({
        result: { type: 'string', value: 'hello world' },
      }),
    });

    const savePath = path.join(TEMP_DIR, `eval-test-text-${Date.now()}.txt`);
    try {
      const result = await mod.evalStr(cdp, SID, '"hello world"');
      writeFileSync(savePath, result);
      const content = readFileSync(savePath, 'utf8');
      assert.equal(content, 'hello world');
      assert.ok(existsSync(savePath));
    } finally {
      if (existsSync(savePath)) unlinkSync(savePath);
    }
  });

  testAsync('saves binary base64 decoded to file', async () => {
    mkdirSync(TEMP_DIR, { recursive: true });
    const testData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const b64 = testData.toString('base64');

    const savePath = path.join(TEMP_DIR, `eval-test-bin-${Date.now()}.bin`);
    try {
      const content = Buffer.from(b64, 'base64');
      writeFileSync(savePath, content);
      const read = readFileSync(savePath);
      assert.deepEqual(read, testData);
    } finally {
      if (existsSync(savePath)) unlinkSync(savePath);
    }
  });
});

describe('eval: evalStr basic', () => {
  testAsync('returns string value', async () => {
    const cdp = createMockCDP({
      'Runtime.enable': {},
      'Runtime.evaluate': () => ({
        result: { type: 'string', value: '42' },
      }),
    });
    const result = await mod.evalStr(cdp, SID, '42');
    assert.equal(result, '42');
  });

  testAsync('returns object as JSON', async () => {
    const cdp = createMockCDP({
      'Runtime.enable': {},
      'Runtime.evaluate': () => ({
        result: { type: 'object', value: { a: 1 } },
      }),
    });
    const result = await mod.evalStr(cdp, SID, '({a:1})');
    assert.ok(result.includes('"a"'));
    assert.ok(result.includes('1'));
  });

  testAsync('throws on exception', async () => {
    const cdp = createMockCDP({
      'Runtime.enable': {},
      'Runtime.evaluate': () => ({
        exceptionDetails: { text: 'ReferenceError: x is not defined' },
      }),
    });
    await assert.rejects(
      () => mod.evalStr(cdp, SID, 'x'),
      /ReferenceError/
    );
  });
});

try { rmSync(TEMP_DIR, { recursive: true }); } catch {}

console.log(summary());
