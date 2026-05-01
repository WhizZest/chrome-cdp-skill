import assert from 'assert/strict';
import { describe, testAsync, summary } from '../lib/test-runner.mjs';

const CTX_SRC = '../../skills/chrome-cdp/scripts/lib/console-context.mjs';
const WS_SRC = '../../skills/chrome-cdp/scripts/lib/websocket-context.mjs';

function createMockCDP(responses = {}) {
  const events = {};
  const sent = [];
  return {
    onEvent: (name, handler) => {
      events[name] = events[name] || [];
      events[name].push(handler);
      return () => {
        events[name] = events[name].filter(h => h !== handler);
      };
    },
    send: (method, params = {}, sid) => {
      sent.push({ method, params, sid });
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
    sent,
  };
}

const SID = 'test-session-001';

await describe('cross-navigation: console message preservation', async () => {
  await testAsync('onNavigated preserves messages in history', async () => {
    const ctx = await import(CTX_SRC);
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID);

    cdp.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'page1 message' }],
      timestamp: Date.now(),
    }, SID);

    ctx.onNavigated('https://example.com/page2');

    cdp.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'page2 message' }],
      timestamp: Date.now(),
    }, SID);

    const result = ctx.getMessages(null, 1, 50, true);
    const texts = result.messages.map(m => m.text);
    assert.ok(texts.includes('page1 message'), 'Should include messages from previous navigation');
    assert.ok(texts.includes('page2 message'), 'Should include messages from current navigation');

    ctx.disable();
  });

  await testAsync('onNavigated creates separator entries', async () => {
    const ctx = await import(CTX_SRC);
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID);

    cdp.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'before nav' }],
      timestamp: Date.now(),
    }, SID);

    ctx.onNavigated('https://example.com/page2');

    cdp.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'after nav' }],
      timestamp: Date.now(),
    }, SID);

    const result = ctx.getMessages(null, 1, 50, true);
    const separators = result.messages.filter(m => m.separator);
    assert.ok(separators.length >= 2, 'Should have at least 2 navigation separators');

    ctx.disable();
  });

  await testAsync('preservation limited to MAX_NAVIGATION_HISTORY (3)', async () => {
    const ctx = await import(CTX_SRC);
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID);

    for (let i = 1; i <= 5; i++) {
      cdp.emit('Runtime.consoleAPICalled', {
        type: 'log',
        args: [{ type: 'string', value: `page${i} msg` }],
        timestamp: Date.now(),
      }, SID);
      ctx.onNavigated(`https://example.com/page${i + 1}`);
    }

    cdp.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'current msg' }],
      timestamp: Date.now(),
    }, SID);

    const result = ctx.getMessages(null, 1, 50, true);
    const texts = result.messages.map(m => m.text);

    assert.ok(!texts.includes('page1 msg'), 'Oldest navigation (page1) should be evicted');
    assert.ok(!texts.includes('page2 msg'), 'Second oldest navigation (page2) should be evicted');
    assert.ok(texts.includes('page3 msg'), 'Third navigation (page3) should be preserved');
    assert.ok(texts.includes('current msg'), 'Current navigation messages should be preserved');

    ctx.disable();
  });

  await testAsync('without --preserve, only current navigation messages', async () => {
    const ctx = await import(CTX_SRC);
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID);

    cdp.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'old message' }],
      timestamp: Date.now(),
    }, SID);

    ctx.onNavigated('https://example.com/page2');

    cdp.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'new message' }],
      timestamp: Date.now(),
    }, SID);

    const result = ctx.getMessages(null, 1, 50, false);
    const texts = result.messages.map(m => m.text);

    assert.ok(!texts.includes('old message'), 'Should not include old navigation messages');
    assert.ok(texts.includes('new message'), 'Should include current navigation messages');

    ctx.disable();
  });

  await testAsync('onNavigated with empty messages does not add to history', async () => {
    const ctx = await import(CTX_SRC);
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID);

    ctx.onNavigated('https://example.com/page1');
    ctx.onNavigated('https://example.com/page2');

    cdp.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'hello' }],
      timestamp: Date.now(),
    }, SID);

    ctx.onNavigated('https://example.com/page3');

    cdp.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'world' }],
      timestamp: Date.now(),
    }, SID);

    const result = ctx.getMessages(null, 1, 50, true);
    const allItems = result.messages;
    const texts = allItems.filter(m => !m.separator).map(m => m.text);

    assert.ok(!texts.includes('page1'), 'Empty navigation (page1) should not create history');
    assert.ok(texts.includes('hello'), 'Message before page3 nav should be in history');
    assert.ok(texts.includes('world'), 'Current navigation message should appear');

    const historySeparators = allItems.filter(s => s.separator && s.url === 'https://example.com/page1');
    assert.equal(historySeparators.length, 0, 'No separator for empty navigation');

    ctx.disable();
  });

  await testAsync('clear resets navigation history', async () => {
    const ctx = await import(CTX_SRC);
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID);

    cdp.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'before clear' }],
      timestamp: Date.now(),
    }, SID);

    ctx.onNavigated('https://example.com/page2');
    ctx.clear();

    cdp.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'after clear' }],
      timestamp: Date.now(),
    }, SID);

    const result = ctx.getMessages(null, 1, 50, true);
    const texts = result.messages.map(m => m.text);

    assert.ok(!texts.includes('before clear'), 'History should be cleared');
    assert.ok(texts.includes('after clear'), 'New messages after clear should appear');

    ctx.disable();
  });
});

await describe('cross-navigation: WebSocket closed connection retention', async () => {
  await testAsync('closed connections are retained', async () => {
    const wsCtx = await import(WS_SRC);
    const cdp = createMockCDP();
    await wsCtx.enable(cdp, SID);

    cdp.emit('Network.webSocketCreated', {
      requestId: 'ws-001',
      url: 'wss://example.com/socket1',
      timestamp: Date.now(),
    }, SID);

    cdp.emit('Network.webSocketClosed', {
      requestId: 'ws-001',
      timestamp: Date.now(),
    }, SID);

    const conns = wsCtx.getConnections();
    assert.equal(conns.length, 1, 'Closed connection should be retained');
    assert.equal(conns[0].status, 'closed');
    assert.equal(conns[0].url, 'wss://example.com/socket1');

    wsCtx.disable();
  });

  await testAsync('closed connections evicted beyond MAX_CLOSED_CONNECTIONS (50)', async () => {
    const wsCtx = await import(WS_SRC);
    const cdp = createMockCDP();
    await wsCtx.enable(cdp, SID);

    for (let i = 0; i < 55; i++) {
      cdp.emit('Network.webSocketCreated', {
        requestId: `ws-closed-${i}`,
        url: `wss://example.com/socket${i}`,
        timestamp: Date.now() + i,
      }, SID);
      cdp.emit('Network.webSocketClosed', {
        requestId: `ws-closed-${i}`,
        timestamp: Date.now() + i + 100,
      }, SID);
    }

    const conns = wsCtx.getConnections();
    assert.ok(conns.length <= 50, `Should not exceed 50 closed connections, got ${conns.length}`);

    wsCtx.disable();
  });

  await testAsync('open connections are not evicted by closed connection limit', async () => {
    const wsCtx = await import(WS_SRC);
    const cdp = createMockCDP();
    await wsCtx.enable(cdp, SID);

    cdp.emit('Network.webSocketCreated', {
      requestId: 'ws-open-001',
      url: 'wss://example.com/live',
      timestamp: Date.now(),
    }, SID);

    for (let i = 0; i < 55; i++) {
      cdp.emit('Network.webSocketCreated', {
        requestId: `ws-fill-${i}`,
        url: `wss://example.com/fill${i}`,
        timestamp: Date.now() + i + 1,
      }, SID);
      cdp.emit('Network.webSocketClosed', {
        requestId: `ws-fill-${i}`,
        timestamp: Date.now() + i + 200,
      }, SID);
    }

    const conns = wsCtx.getConnections();
    const openConns = conns.filter(c => c.status === 'open');
    assert.ok(openConns.length >= 1, 'Open connection should not be evicted');
    assert.ok(openConns.some(c => c.url === 'wss://example.com/live'));

    wsCtx.disable();
  });

  await testAsync('oldest closed connections evicted first', async () => {
    const wsCtx = await import(WS_SRC);
    const cdp = createMockCDP();
    await wsCtx.enable(cdp, SID);

    for (let i = 0; i < 55; i++) {
      cdp.emit('Network.webSocketCreated', {
        requestId: `ws-age-${i}`,
        url: `wss://example.com/age${i}`,
        timestamp: Date.now() + i,
      }, SID);
      cdp.emit('Network.webSocketClosed', {
        requestId: `ws-age-${i}`,
        timestamp: Date.now() + i + 100,
      }, SID);
    }

    const conns = wsCtx.getConnections();
    const urls = conns.map(c => c.url);
    assert.ok(!urls.includes('wss://example.com/age0'), 'Oldest closed connection should be evicted first');
    assert.ok(urls.includes('wss://example.com/age54'), 'Newest closed connection should be retained');

    wsCtx.disable();
  });
});

await summary();
