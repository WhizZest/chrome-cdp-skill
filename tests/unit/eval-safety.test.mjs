import assert from 'assert/strict';
import { describe, test, testAsync, summary } from '../lib/test-runner.mjs';

const WARN_CDP_METHODS = new Set([
  'Debugger.disable', 'Debugger.enable', 'Network.disable', 'Network.enable',
  'Page.disable', 'Page.enable',
  'Target.detachFromTarget', 'Target.closeTarget',
  'Target.disposeBrowserContext',
]);

function evalRawCheck(method, paramsJson, sid) {
  if (!method) throw new Error('CDP method required (e.g. "DOM.getDocument")');
  let params = {};
  if (paramsJson) {
    try { params = JSON.parse(paramsJson); }
    catch { throw new Error(`Invalid JSON params: ${paramsJson}`); }
  }
  if (method === 'Target.detachFromTarget' && params.sessionId === sid) {
    throw new Error('Blocked: detaching the daemon\'s own session would kill it. Use "stop" command instead.');
  }
  const warn = WARN_CDP_METHODS.has(method);
  if (!warn) return { type: 'pass' };
  const hints = {
    'Debugger.disable': 'Use "debug reset" to recover debugger state.',
    'Debugger.enable': 'This may conflict with the debugger\'s internal state.',
    'Network.disable': 'Daemon network caching will stop working.',
    'Network.enable': 'This may cause duplicate network events.',
    'Page.disable': 'Navigation commands will stop working.',
    'Page.enable': 'This may cause duplicate page events.',
    'Target.detachFromTarget': 'Detaching a session may break debugging for that target.',
    'Target.closeTarget': 'Closing the current tab will kill the daemon.',
    'Target.disposeBrowserContext': 'Disposing the default context will break the session.',
  };
  return { type: 'warn', hint: hints[method] };
}

describe('evalraw: blocked commands', () => {
  test('Target.detachFromTarget with daemon session is blocked', () => {
    assert.throws(
      () => evalRawCheck('Target.detachFromTarget', '{"sessionId":"ABC123"}', 'ABC123'),
      /Blocked/
    );
  });

  test('Target.detachFromTarget with different session is not blocked', () => {
    const result = evalRawCheck('Target.detachFromTarget', '{"sessionId":"OTHER"}', 'ABC123');
    assert.equal(result.type, 'warn');
  });

  test('Target.detachFromTarget without sessionId param is not blocked', () => {
    const result = evalRawCheck('Target.detachFromTarget', '{}', 'ABC123');
    assert.equal(result.type, 'warn');
  });
});

describe('evalraw: warned commands', () => {
  test('Debugger.disable produces warning', () => {
    const result = evalRawCheck('Debugger.disable', null, 'ABC123');
    assert.equal(result.type, 'warn');
    assert.ok(result.hint.includes('debug reset'));
  });

  test('Debugger.enable produces warning', () => {
    const result = evalRawCheck('Debugger.enable', null, 'ABC123');
    assert.equal(result.type, 'warn');
  });

  test('Network.disable produces warning', () => {
    const result = evalRawCheck('Network.disable', null, 'ABC123');
    assert.equal(result.type, 'warn');
    assert.ok(result.hint.includes('caching'));
  });

  test('Page.disable produces warning', () => {
    const result = evalRawCheck('Page.disable', null, 'ABC123');
    assert.equal(result.type, 'warn');
    assert.ok(result.hint.includes('Navigation'));
  });

  test('Target.closeTarget produces warning', () => {
    const result = evalRawCheck('Target.closeTarget', null, 'ABC123');
    assert.equal(result.type, 'warn');
    assert.ok(result.hint.includes('kill the daemon'));
  });

  test('Target.disposeBrowserContext produces warning', () => {
    const result = evalRawCheck('Target.disposeBrowserContext', null, 'ABC123');
    assert.equal(result.type, 'warn');
  });
});

describe('evalraw: allowed commands (no warning)', () => {
  test('Target.attachToTarget is allowed', () => {
    const result = evalRawCheck('Target.attachToTarget', '{"targetId":"test"}', 'ABC123');
    assert.equal(result.type, 'pass');
  });

  test('Target.createBrowserContext is allowed', () => {
    const result = evalRawCheck('Target.createBrowserContext', null, 'ABC123');
    assert.equal(result.type, 'pass');
  });

  test('DOM.getDocument is allowed', () => {
    const result = evalRawCheck('DOM.getDocument', null, 'ABC123');
    assert.equal(result.type, 'pass');
  });

  test('Runtime.evaluate is allowed', () => {
    const result = evalRawCheck('Runtime.evaluate', '{"expression":"1+1"}', 'ABC123');
    assert.equal(result.type, 'pass');
  });

  test('Network.getResponseBody is allowed', () => {
    const result = evalRawCheck('Network.getResponseBody', '{"requestId":"123"}', 'ABC123');
    assert.equal(result.type, 'pass');
  });

  test('Debugger.getScriptSource is allowed', () => {
    const result = evalRawCheck('Debugger.getScriptSource', '{"scriptId":"1"}', 'ABC123');
    assert.equal(result.type, 'pass');
  });
});

describe('evalraw: input validation', () => {
  test('empty method throws error', () => {
    assert.throws(
      () => evalRawCheck('', null, 'ABC123'),
      /CDP method required/
    );
  });

  test('invalid JSON params throws error', () => {
    assert.throws(
      () => evalRawCheck('DOM.getDocument', '{bad json}', 'ABC123'),
      /Invalid JSON params/
    );
  });
});

summary();
