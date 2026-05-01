import assert from 'assert/strict';
import { describe, testAsync, summary } from '../lib/test-runner.mjs';

const SRC = '../../skills/chrome-cdp/scripts/commands/network.mjs';

function makeCachedRequests() {
  return [
    {
      id: 1,
      requestId: 'req-1',
      url: 'https://example.com/api/data',
      method: 'GET',
      type: 'fetch',
      status: 200,
      statusText: 'OK',
      requestHeaders: {},
      responseHeaders: {},
      requestBody: null,
      initiator: {
        type: 'script',
        url: '',
        lineNumber: -1,
        stack: {
          callFrames: [
            { functionName: 'fetchData', url: 'https://example.com/app.js', lineNumber: 42, columnNumber: 5, scriptId: 's1' },
            { functionName: 'onClick', url: 'https://example.com/app.js', lineNumber: 30, columnNumber: 3, scriptId: 's1' },
          ],
          parent: {
            callFrames: [
              { functionName: 'setTimeout', url: 'https://example.com/app.js', lineNumber: 25, columnNumber: 1, scriptId: 's1' },
            ],
            parent: null,
          },
        },
      },
    },
    {
      id: 2,
      requestId: 'req-2',
      url: 'https://example.com/page.html',
      method: 'GET',
      type: 'document',
      status: 200,
      statusText: 'OK',
      requestHeaders: {},
      responseHeaders: {},
      requestBody: null,
      initiator: {
        type: 'parser',
        url: 'https://example.com/index.html',
        lineNumber: 10,
        stack: null,
      },
    },
    {
      id: 3,
      requestId: 'req-3',
      url: 'https://example.com/api/no-initiator',
      method: 'POST',
      type: 'fetch',
      status: 200,
      statusText: 'OK',
      requestHeaders: {},
      responseHeaders: {},
      requestBody: null,
      initiator: null,
    },
    {
      id: 4,
      requestId: 'req-4',
      url: 'https://example.com/api/other-init',
      method: 'GET',
      type: 'fetch',
      status: 200,
      statusText: 'OK',
      requestHeaders: {},
      responseHeaders: {},
      requestBody: null,
      initiator: {
        type: 'other',
        url: '',
        lineNumber: -1,
        stack: null,
      },
    },
    {
      id: 5,
      requestId: 'req-5',
      url: 'https://example.com/api/deep-async',
      method: 'GET',
      type: 'fetch',
      status: 200,
      statusText: 'OK',
      requestHeaders: {},
      responseHeaders: {},
      requestBody: null,
      initiator: {
        type: 'script',
        url: '',
        lineNumber: -1,
        stack: {
          callFrames: [
            { functionName: 'deepCall', url: 'https://example.com/app.js', lineNumber: 100, columnNumber: 0, scriptId: 's2' },
          ],
          parent: {
            callFrames: [
              { functionName: 'Promise.then', url: '', lineNumber: 0, columnNumber: 0, scriptId: '' },
            ],
            parent: {
              callFrames: [
                { functionName: 'setTimeout', url: 'https://example.com/app.js', lineNumber: 50, columnNumber: 2, scriptId: 's2' },
              ],
              parent: null,
            },
          },
        },
      },
    },
  ];
}

function createMockCDP(responses = {}) {
  const events = {};
  return {
    onEvent: (name, handler) => {
      events[name] = events[name] || [];
      events[name].push(handler);
      return () => {
        events[name] = events[name].filter(h => h !== handler);
      };
    },
    send: (method, params = {}, sid) => {
      if (responses[method]) {
        const resp = responses[method];
        if (typeof resp === 'function') return Promise.resolve(resp(params));
        return Promise.resolve(resp);
      }
      return Promise.resolve({});
    },
    close: () => {},
    emit: (name, params, sessionId) => {
      const handlers = events[name] || [];
      for (const h of handlers) {
        h(params, { sessionId });
      }
    },
  };
}

const SID = 'test-session-001';

describe('network-initiator: initiator subcommand', () => {
  testAsync('net initiator <id> shows script initiator with call stack', async () => {
    const mod = await import(SRC);
    const cachedRequests = makeCachedRequests();
    const requestIdState = { next: 6 };
    const cdp = createMockCDP();

    const result = await mod.netHandleCommand(cdp, SID, cachedRequests, requestIdState, ['initiator', '1']);
    assert.ok(result.includes('type: script'));
    assert.ok(result.includes('fetchData'));
    assert.ok(result.includes('app.js:43:6'));
    assert.ok(result.includes('onClick'));
    assert.ok(result.includes('Async Parent Stack'));
    assert.ok(result.includes('setTimeout'));
  });

  testAsync('net initiator <id> shows parser initiator', async () => {
    const mod = await import(SRC);
    const cachedRequests = makeCachedRequests();
    const requestIdState = { next: 6 };
    const cdp = createMockCDP();

    const result = await mod.netHandleCommand(cdp, SID, cachedRequests, requestIdState, ['initiator', '2']);
    assert.ok(result.includes('type: parser'));
    assert.ok(result.includes('index.html:11'));
    assert.ok(!result.includes('Call Stack'));
  });

  testAsync('net initiator <id> shows no initiator info when null', async () => {
    const mod = await import(SRC);
    const cachedRequests = makeCachedRequests();
    const requestIdState = { next: 6 };
    const cdp = createMockCDP();

    const result = await mod.netHandleCommand(cdp, SID, cachedRequests, requestIdState, ['initiator', '3']);
    assert.ok(result.includes('No initiator info'));
  });

  testAsync('net initiator <id> shows other type without stack', async () => {
    const mod = await import(SRC);
    const cachedRequests = makeCachedRequests();
    const requestIdState = { next: 6 };
    const cdp = createMockCDP();

    const result = await mod.netHandleCommand(cdp, SID, cachedRequests, requestIdState, ['initiator', '4']);
    assert.ok(result.includes('type: other'));
  });

  testAsync('net initiator <id> shows deep async chain', async () => {
    const mod = await import(SRC);
    const cachedRequests = makeCachedRequests();
    const requestIdState = { next: 6 };
    const cdp = createMockCDP();

    const result = await mod.netHandleCommand(cdp, SID, cachedRequests, requestIdState, ['initiator', '5']);
    assert.ok(result.includes('deepCall'));
    assert.ok(result.includes('Async Parent Stack (depth 1)'));
    assert.ok(result.includes('Async Parent Stack (depth 2)'));
    assert.ok(result.includes('setTimeout'));
  });

  testAsync('net initiator <id> throws for missing request', async () => {
    const mod = await import(SRC);
    const cachedRequests = makeCachedRequests();
    const requestIdState = { next: 6 };
    const cdp = createMockCDP();

    await assert.rejects(
      () => mod.netHandleCommand(cdp, SID, cachedRequests, requestIdState, ['initiator', '99']),
      { message: 'Request 99 not found' }
    );
  });
});

describe('network-initiator: detail output includes initiator', () => {
  testAsync('net <id> JSON output includes initiator field', async () => {
    const mod = await import(SRC);
    const cachedRequests = makeCachedRequests();
    const requestIdState = { next: 6 };
    const cdp = createMockCDP({
      'Network.getResponseBody': () => ({ body: '{}', base64Encoded: false }),
    });

    const result = await mod.netHandleCommand(cdp, SID, cachedRequests, requestIdState, ['1']);
    const parsed = JSON.parse(result);
    assert.ok(parsed.initiator);
    assert.equal(parsed.initiator.type, 'script');
    assert.ok(parsed.initiator.stack);
    assert.equal(parsed.initiator.stack.callFrames.length, 2);
  });

  testAsync('net <id> JSON output has null initiator when absent', async () => {
    const mod = await import(SRC);
    const cachedRequests = makeCachedRequests();
    const requestIdState = { next: 6 };
    const cdp = createMockCDP({
      'Network.getResponseBody': () => ({ body: '{}', base64Encoded: false }),
    });

    const result = await mod.netHandleCommand(cdp, SID, cachedRequests, requestIdState, ['3']);
    const parsed = JSON.parse(result);
    assert.equal(parsed.initiator, null);
  });
});

summary();
