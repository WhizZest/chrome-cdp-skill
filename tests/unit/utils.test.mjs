import assert from 'assert/strict';
import { describe, test, testAsync, summary } from '../lib/test-runner.mjs';
import { resolvePrefix, redactHeaders, isTextMimeType, getDisplayPrefixLength } from '../../skills/chrome-cdp/scripts/lib/utils.mjs';

describe('utils: resolvePrefix', () => {
  test('exact match returns value', () => {
    assert.equal(resolvePrefix('ABC', ['ABCDEF', 'XYZ123']), 'ABCDEF');
  });

  test('unique prefix returns match', () => {
    assert.equal(resolvePrefix('AB', ['ABCDEF', 'XYZ123']), 'ABCDEF');
  });

  test('ambiguous prefix throws error', () => {
    assert.throws(
      () => resolvePrefix('A', ['ABC', 'ABD']),
      /Ambiguous/
    );
  });

  test('no match throws error', () => {
    assert.throws(
      () => resolvePrefix('ZZZ', ['ABC', 'DEF']),
      /No target matching/
    );
  });

  test('case insensitive matching', () => {
    assert.equal(resolvePrefix('abc', ['ABCDEF']), 'ABCDEF');
  });
});

describe('utils: redactHeaders', () => {
  test('redacts sensitive headers', () => {
    const headers = {
      'content-type': 'application/json',
      'authorization': 'Bearer token123',
      'cookie': 'session=abc',
      'x-api-key': 'secret',
    };
    const result = redactHeaders(headers);
    assert.equal(result['content-type'], 'application/json');
    assert.equal(result['authorization'], '[REDACTED]');
    assert.equal(result['cookie'], '[REDACTED]');
    assert.equal(result['x-api-key'], '[REDACTED]');
  });

  test('raw mode skips redaction', () => {
    const headers = { 'authorization': 'Bearer token123' };
    const result = redactHeaders(headers, true);
    assert.equal(result['authorization'], 'Bearer token123');
  });

  test('null headers returns null', () => {
    assert.equal(redactHeaders(null), null);
  });
});

describe('utils: isTextMimeType', () => {
  test('text/html is text', () => {
    assert.equal(isTextMimeType('text/html'), true);
  });

  test('application/json is text', () => {
    assert.equal(isTextMimeType('application/json'), true);
  });

  test('image/png is not text', () => {
    assert.equal(isTextMimeType('image/png'), false);
  });

  test('null is not text', () => {
    assert.equal(isTextMimeType(null), false);
  });

  test('empty string is not text', () => {
    assert.equal(isTextMimeType(''), false);
  });
});

describe('utils: getDisplayPrefixLength', () => {
  test('empty array returns minimum', () => {
    assert.equal(getDisplayPrefixLength([]), 8);
  });

  test('unique prefixes at length 8', () => {
    const ids = ['ABCDEF01', 'XYZ12345'];
    assert.equal(getDisplayPrefixLength(ids), 8);
  });

  test('needs longer prefix when 8 chars collide', () => {
    const ids = ['ABCDEF01', 'ABCDEF01XYZ'];
    assert.ok(getDisplayPrefixLength(ids) > 8);
  });
});

summary();
