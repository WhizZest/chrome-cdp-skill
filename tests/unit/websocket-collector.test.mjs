import assert from 'assert/strict';
import { describe, testAsync, summary } from '../lib/test-runner.mjs';

const CTX_SRC = '../../skills/chrome-cdp/scripts/lib/websocket-context.mjs';
const CMD_SRC = '../../skills/chrome-cdp/scripts/commands/ws.mjs';

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

async function withWs(fn) {
  const ctx = await import(CTX_SRC);
  const cdp = createMockCDP();
  await ctx.enable(cdp, SID);
  try {
    await fn(ctx, cdp);
  } finally {
    ctx.disable();
  }
}

describe('websocket-context: connection lifecycle', () => {
  testAsync('webSocketCreated adds connection', async () => {
    await withWs(async (ctx, cdp) => {
      cdp.emit('Network.webSocketCreated', {
        requestId: '1.1',
        url: 'wss://example.com/ws',
        timestamp: 1000,
      }, SID);

      const conns = ctx.getConnections();
      assert.equal(conns.length, 1);
      assert.equal(conns[0].url, 'wss://example.com/ws');
      assert.equal(conns[0].status, 'open');
      assert.equal(conns[0].wsId, 1);
    });
  });

  testAsync('webSocketClosed marks connection closed', async () => {
    await withWs(async (ctx, cdp) => {
      cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://example.com/ws', timestamp: 1000 }, SID);
      cdp.emit('Network.webSocketClosed', { requestId: '1.1', timestamp: 2000 }, SID);

      const conns = ctx.getConnections();
      assert.equal(conns[0].status, 'closed');
      assert.equal(conns[0].closedTime, 2000);
    });
  });

  testAsync('webSocketFrameError marks connection error', async () => {
    await withWs(async (ctx, cdp) => {
      cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://example.com/ws', timestamp: 1000 }, SID);
      cdp.emit('Network.webSocketFrameError', { requestId: '1.1', errorMessage: 'Invalid frame' }, SID);

      const conns = ctx.getConnections();
      assert.equal(conns[0].status, 'error');
    });
  });

  testAsync('events from different sessionId are ignored', async () => {
    await withWs(async (ctx, cdp) => {
      cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://example.com/ws', timestamp: 1000 }, 'other-session');
      const conns = ctx.getConnections();
      assert.equal(conns.length, 0);
    });
  });
});

describe('websocket-context: frame storage', () => {
  testAsync('webSocketFrameSent stores frame', async () => {
    await withWs(async (ctx, cdp) => {
      cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://example.com/ws', timestamp: 1000 }, SID);
      cdp.emit('Network.webSocketFrameSent', {
        requestId: '1.1',
        response: { payloadData: '{"type":"ping"}', opcode: 1 },
        timestamp: 1100,
      }, SID);

      const data = ctx.getFrames(1);
      assert.ok(data);
      assert.equal(data.frames.length, 1);
      assert.equal(data.frames[0].direction, 'sent');
      assert.equal(data.frames[0].payload, '{"type":"ping"}');
    });
  });

  testAsync('webSocketFrameReceived stores frame', async () => {
    await withWs(async (ctx, cdp) => {
      cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://example.com/ws', timestamp: 1000 }, SID);
      cdp.emit('Network.webSocketFrameReceived', {
        requestId: '1.1',
        response: { payloadData: '{"type":"pong"}', opcode: 1 },
        timestamp: 1200,
      }, SID);

      const data = ctx.getFrames(1);
      assert.equal(data.frames[0].direction, 'received');
      assert.equal(data.frames[0].payload, '{"type":"pong"}');
    });
  });

  testAsync('frameCount and byteCount track correctly', async () => {
    await withWs(async (ctx, cdp) => {
      cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://example.com/ws', timestamp: 1000 }, SID);
      cdp.emit('Network.webSocketFrameSent', { requestId: '1.1', response: { payloadData: 'hello', opcode: 1 }, timestamp: 1100 }, SID);
      cdp.emit('Network.webSocketFrameReceived', { requestId: '1.1', response: { payloadData: 'world!!', opcode: 1 }, timestamp: 1200 }, SID);

      const conn = ctx.getConnectionByWsId(1);
      assert.equal(conn.frameCount.sent, 1);
      assert.equal(conn.frameCount.received, 1);
      assert.equal(conn.byteCount.sent, 5);
      assert.equal(conn.byteCount.received, 7);
    });
  });
});

describe('websocket-context: direction filtering', () => {
  testAsync('--sent filters to sent frames only', async () => {
    await withWs(async (ctx, cdp) => {
      cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://example.com/ws', timestamp: 1000 }, SID);
      cdp.emit('Network.webSocketFrameSent', { requestId: '1.1', response: { payloadData: 'sent-msg', opcode: 1 }, timestamp: 1100 }, SID);
      cdp.emit('Network.webSocketFrameReceived', { requestId: '1.1', response: { payloadData: 'recv-msg', opcode: 1 }, timestamp: 1200 }, SID);

      const data = ctx.getFrames(1, { direction: 'sent' });
      assert.equal(data.frames.length, 1);
      assert.equal(data.frames[0].direction, 'sent');
    });
  });

  testAsync('--received filters to received frames only', async () => {
    await withWs(async (ctx, cdp) => {
      cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://example.com/ws', timestamp: 1000 }, SID);
      cdp.emit('Network.webSocketFrameSent', { requestId: '1.1', response: { payloadData: 'sent-msg', opcode: 1 }, timestamp: 1100 }, SID);
      cdp.emit('Network.webSocketFrameReceived', { requestId: '1.1', response: { payloadData: 'recv-msg', opcode: 1 }, timestamp: 1200 }, SID);

      const data = ctx.getFrames(1, { direction: 'received' });
      assert.equal(data.frames.length, 1);
      assert.equal(data.frames[0].direction, 'received');
    });
  });
});

describe('websocket-context: URL filtering', () => {
  testAsync('getConnections filters by URL', async () => {
    await withWs(async (ctx, cdp) => {
      cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://api.example.com/ws', timestamp: 1000 }, SID);
      cdp.emit('Network.webSocketCreated', { requestId: '2.1', url: 'wss://chat.example.com/ws', timestamp: 1001 }, SID);

      const filtered = ctx.getConnections('api');
      assert.equal(filtered.length, 1);
      assert.ok(filtered[0].url.includes('api'));
    });
  });
});

describe('websocket-context: pattern analysis', () => {
  testAsync('analyzeFrames groups by prefix+direction+size', async () => {
    await withWs(async (ctx, cdp) => {
      cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://example.com/ws', timestamp: 1000 }, SID);

      for (let i = 0; i < 3; i++) {
        cdp.emit('Network.webSocketFrameSent', { requestId: '1.1', response: { payloadData: `{"type":"sub","id":${i}}`, opcode: 1 }, timestamp: 1100 + i }, SID);
      }
      for (let i = 0; i < 5; i++) {
        cdp.emit('Network.webSocketFrameReceived', { requestId: '1.1', response: { payloadData: `{"type":"upd","data":${i}}`, opcode: 1 }, timestamp: 1200 + i }, SID);
      }

      const analysis = ctx.analyzeFrames(1);
      assert.ok(analysis);
      assert.equal(analysis.totalFrames, 8);
      assert.ok(analysis.groups.length >= 2);

      const sentGroup = analysis.groups.find(g => g.direction === 'sent');
      assert.ok(sentGroup);
      assert.equal(sentGroup.count, 3);

      const recvGroup = analysis.groups.find(g => g.direction === 'received');
      assert.ok(recvGroup);
      assert.equal(recvGroup.count, 5);
    });
  });

  testAsync('group labels are A, B, C...', async () => {
    await withWs(async (ctx, cdp) => {
      cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://example.com/ws', timestamp: 1000 }, SID);
      cdp.emit('Network.webSocketFrameSent', { requestId: '1.1', response: { payloadData: 'AAAA_sent', opcode: 1 }, timestamp: 1100 }, SID);
      cdp.emit('Network.webSocketFrameReceived', { requestId: '1.1', response: { payloadData: 'BBBB_recv', opcode: 1 }, timestamp: 1200 }, SID);

      const analysis = ctx.analyzeFrames(1);
      const labels = analysis.groups.map(g => g.label);
      assert.ok(labels.includes('A'));
      assert.ok(labels.includes('B'));
    });
  });
});

describe('websocket-context: FIFO eviction', () => {
  testAsync('connections beyond 100 are evicted', async () => {
    await withWs(async (ctx, cdp) => {
      for (let i = 0; i < 105; i++) {
        cdp.emit('Network.webSocketCreated', { requestId: `req-${i}`, url: `wss://ws${i}.example.com`, timestamp: 1000 + i }, SID);
      }
      const conns = ctx.getConnections();
      assert.equal(conns.length, 100);
    });
  });
});

describe('websocket-context: clear', () => {
  testAsync('clear empties all connections', async () => {
    await withWs(async (ctx, cdp) => {
      cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://example.com/ws', timestamp: 1000 }, SID);
      assert.equal(ctx.getConnections().length, 1);

      const count = ctx.clear();
      assert.equal(count, 1);
      assert.equal(ctx.getConnections().length, 0);
    });
  });
});

describe('websocket-context: classifySize', () => {
  testAsync('size classification', async () => {
    const ctx = await import(CTX_SRC);
    assert.equal(ctx.classifySize(10), 'tiny');
    assert.equal(ctx.classifySize(100), 'small');
    assert.equal(ctx.classifySize(1000), 'medium');
    assert.equal(ctx.classifySize(10000), 'large');
    assert.equal(ctx.classifySize(60000), 'xlarge');
  });
});

describe('ws command: output formatting', () => {
  testAsync('handleWs lists connections', async () => {
    const ctx = await import(CTX_SRC);
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID);

    cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://example.com/ws', timestamp: 1000 }, SID);

    const result = await cmd.handleWs({ cdp, sessionId: SID, args: [] });
    assert.ok(result.includes('1 total'));
    assert.ok(result.includes('wss://example.com/ws'));

    ctx.disable();
  });

  testAsync('handleWs shows frames for connection', async () => {
    const ctx = await import(CTX_SRC);
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID);

    cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://example.com/ws', timestamp: 1000 }, SID);
    cdp.emit('Network.webSocketFrameSent', { requestId: '1.1', response: { payloadData: 'hello', opcode: 1 }, timestamp: 1100 }, SID);

    const result = await cmd.handleWs({ cdp, sessionId: SID, args: ['1'] });
    assert.ok(result.includes('hello'));

    ctx.disable();
  });

  testAsync('handleWs clear', async () => {
    const ctx = await import(CTX_SRC);
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID);

    cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://example.com/ws', timestamp: 1000 }, SID);

    const result = await cmd.handleWs({ cdp, sessionId: SID, args: ['clear'] });
    assert.ok(result.includes('Cleared 1'));

    ctx.disable();
  });

  testAsync('handleWs --analyze', async () => {
    const ctx = await import(CTX_SRC);
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID);

    cdp.emit('Network.webSocketCreated', { requestId: '1.1', url: 'wss://example.com/ws', timestamp: 1000 }, SID);
    cdp.emit('Network.webSocketFrameSent', { requestId: '1.1', response: { payloadData: '{"type":"sub"}', opcode: 1 }, timestamp: 1100 }, SID);
    cdp.emit('Network.webSocketFrameReceived', { requestId: '1.1', response: { payloadData: '{"type":"upd"}', opcode: 1 }, timestamp: 1200 }, SID);

    const result = await cmd.handleWs({ cdp, sessionId: SID, args: ['1', '--analyze'] });
    assert.ok(result.includes('Pattern Analysis'));
    assert.ok(result.includes('Pattern A'));

    ctx.disable();
  });
});

summary();
