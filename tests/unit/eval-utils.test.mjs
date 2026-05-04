import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseEvalArgs, wrapBinaryExpr, handleSaveResult } from '../../skills/chrome-cdp/scripts/lib/eval-utils.mjs';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('parseEvalArgs', () => {
  it('parses expression only', () => {
    const result = parseEvalArgs(['1+1']);
    assert.strictEqual(result.expression, '1+1');
    assert.strictEqual(result.saveFile, null);
    assert.strictEqual(result.binary, false);
    assert.strictEqual(result.frameIdx, null);
  });

  it('parses --save flag', () => {
    const result = parseEvalArgs(['1+1', '--save', 'out.txt']);
    assert.strictEqual(result.expression, '1+1');
    assert.strictEqual(result.saveFile, 'out.txt');
    assert.strictEqual(result.binary, false);
  });

  it('parses --binary flag', () => {
    const result = parseEvalArgs(['1+1', '--binary']);
    assert.strictEqual(result.expression, '1+1');
    assert.strictEqual(result.binary, true);
  });

  it('parses --frame flag', () => {
    const result = parseEvalArgs(['expr', '--frame', '2']);
    assert.strictEqual(result.expression, 'expr');
    assert.strictEqual(result.frameIdx, 2);
  });

  it('parses all flags combined', () => {
    const result = parseEvalArgs(['myExpr', '--save', 'out.txt', '--binary', '--frame', '3']);
    assert.strictEqual(result.expression, 'myExpr');
    assert.strictEqual(result.saveFile, 'out.txt');
    assert.strictEqual(result.binary, true);
    assert.strictEqual(result.frameIdx, 3);
  });

  it('throws on --save without filename', () => {
    assert.throws(() => parseEvalArgs(['1+1', '--save']), /--save requires a filename/);
  });

  it('throws on --frame without index', () => {
    assert.throws(() => parseEvalArgs(['expr', '--frame']), /--frame requires a frame index/);
  });

  it('throws on --frame with negative index', () => {
    assert.throws(() => parseEvalArgs(['expr', '--frame', '-1']), /--frame must be a non-negative integer/);
  });

  it('throws on --frame with non-numeric index', () => {
    assert.throws(() => parseEvalArgs(['expr', '--frame', 'abc']), /--frame must be a non-negative integer/);
  });

  it('returns null frameIdx when --frame not specified', () => {
    const result = parseEvalArgs(['1+1', '--save', 'out.txt']);
    assert.strictEqual(result.frameIdx, null);
  });
});

describe('wrapBinaryExpr', () => {
  it('wraps expression in async IIFE', () => {
    const result = wrapBinaryExpr('myVar');
    assert.ok(result.startsWith('(async()=>{'));
    assert.ok(result.includes('myVar'));
    assert.ok(result.endsWith('})()'));
  });
});

describe('handleSaveResult', () => {
  it('saves text result to file', () => {
    const tmpFile = join(tmpdir(), 'eval-test-' + Date.now() + '.txt');
    const result = handleSaveResult('hello world', tmpFile, false);
    assert.ok(result.includes('Saved to'));
    assert.ok(result.includes('bytes'));
    assert.ok(existsSync(tmpFile));
    unlinkSync(tmpFile);
  });

  it('saves binary result to file', () => {
    const tmpFile = join(tmpdir(), 'eval-test-' + Date.now() + '.bin');
    const b64 = Buffer.from('hello').toString('base64');
    const jsonResult = JSON.stringify({ __cdpBinary: true, b64 });
    const result = handleSaveResult(jsonResult, tmpFile, true);
    assert.ok(result.includes('Saved to'));
    assert.ok(existsSync(tmpFile));
    const content = readFileSync(tmpFile);
    assert.strictEqual(content.toString(), 'hello');
    unlinkSync(tmpFile);
  });

  it('throws on invalid binary JSON', () => {
    assert.throws(() => handleSaveResult('not json', '/tmp/test.bin', true), /Failed to parse binary result/);
  });

  it('throws on missing __cdpBinary flag', () => {
    assert.throws(() => handleSaveResult('{"foo":"bar"}', '/tmp/test.bin', true), /Page did not return binary data/);
  });
});
