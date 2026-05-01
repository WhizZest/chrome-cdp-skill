import assert from 'assert/strict';
import { describe, testAsync, summary } from '../lib/test-runner.mjs';

const CTX_SRC = '../../skills/chrome-cdp/scripts/lib/console-context.mjs';
const CMD_SRC = '../../skills/chrome-cdp/scripts/commands/console.mjs';

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

async function withConsole(fn) {
  const ctx = await import(CTX_SRC);
  const cdp = createMockCDP();
  await ctx.enable(cdp, SID);
  try {
    await fn(ctx, cdp);
  } finally {
    ctx.disable();
  }
}

describe('console-context: enable/disable lifecycle', () => {
  testAsync('enable registers event listeners', async () => {
    await withConsole(async (ctx, cdp) => {
      assert.equal(ctx.isEnabled(), true);
      const enableCall = cdp.sent.find(s => s.method === 'Runtime.enable');
      assert.ok(enableCall);
    });
  });

  testAsync('disable clears state', async () => {
    await withConsole(async (ctx) => {
      assert.equal(ctx.isEnabled(), true);
    });
    const ctx = await import(CTX_SRC);
    assert.equal(ctx.isEnabled(), false);
  });
});

describe('console-context: event caching', () => {
  testAsync('consoleAPICalled event adds message', async () => {
    await withConsole(async (ctx, cdp) => {
      cdp.emit('Runtime.consoleAPICalled', {
        type: 'log',
        args: [{ type: 'string', value: 'hello' }],
        timestamp: 1000,
        stackTrace: {
          callFrames: [{ url: 'https://example.com/app.js', lineNumber: 42, columnNumber: 5 }],
        },
      }, SID);

      const result = ctx.getMessages(null, 1, 20);
      assert.equal(result.total, 1);
      assert.equal(result.messages[0].type, 'log');
      assert.equal(result.messages[0].text, 'hello');
      assert.equal(result.messages[0].url, 'https://example.com/app.js');
      assert.equal(result.messages[0].lineNumber, 42);
    });
  });

  testAsync('different console types are recorded', async () => {
    await withConsole(async (ctx, cdp) => {
      const types = ['log', 'warning', 'error', 'info', 'debug', 'table'];
      for (const type of types) {
        cdp.emit('Runtime.consoleAPICalled', {
          type,
          args: [{ type: 'string', value: `msg-${type}` }],
          timestamp: 1000,
        }, SID);
      }

      const result = ctx.getMessages(null, 1, 20);
      assert.equal(result.total, types.length);
    });
  });

  testAsync('exceptionThrown event adds error message', async () => {
    await withConsole(async (ctx, cdp) => {
      cdp.emit('Runtime.exceptionThrown', {
        exceptionDetails: {
          text: 'Uncaught TypeError',
          exception: { description: 'TypeError: Cannot read property' },
          stackTrace: {
            callFrames: [{ url: 'app.js', lineNumber: 10, columnNumber: 0 }],
          },
        },
        timestamp: 2000,
      }, SID);

      const result = ctx.getMessages(null, 1, 20);
      assert.equal(result.total, 1);
      assert.equal(result.messages[0].type, 'error');
      assert.ok(result.messages[0].text.includes('TypeError'));
    });
  });

  testAsync('events from different sessionId are ignored', async () => {
    await withConsole(async (ctx, cdp) => {
      cdp.emit('Runtime.consoleAPICalled', {
        type: 'log',
        args: [{ type: 'string', value: 'from-other-session' }],
        timestamp: 1000,
      }, 'other-session');

      const result = ctx.getMessages(null, 1, 20);
      assert.equal(result.total, 0);
    });
  });
});

describe('console-context: args parsing', () => {
  testAsync('string arg', async () => {
    await withConsole(async (ctx, cdp) => {
      cdp.emit('Runtime.consoleAPICalled', {
        type: 'log',
        args: [{ type: 'string', value: 'hello world' }],
        timestamp: 1000,
      }, SID);
      const result = ctx.getMessages(null, 1, 20);
      assert.equal(result.messages[0].text, 'hello world');
    });
  });

  testAsync('number arg', async () => {
    await withConsole(async (ctx, cdp) => {
      cdp.emit('Runtime.consoleAPICalled', {
        type: 'log',
        args: [{ type: 'number', value: 42 }],
        timestamp: 1000,
      }, SID);
      const result = ctx.getMessages(null, 1, 20);
      assert.equal(result.messages[0].text, '42');
    });
  });

  testAsync('object arg with description', async () => {
    await withConsole(async (ctx, cdp) => {
      cdp.emit('Runtime.consoleAPICalled', {
        type: 'log',
        args: [{ type: 'object', description: 'Array(3)' }],
        timestamp: 1000,
      }, SID);
      const result = ctx.getMessages(null, 1, 20);
      assert.equal(result.messages[0].text, 'Array(3)');
    });
  });

  testAsync('undefined arg', async () => {
    await withConsole(async (ctx, cdp) => {
      cdp.emit('Runtime.consoleAPICalled', {
        type: 'log',
        args: [{ type: 'undefined' }],
        timestamp: 1000,
      }, SID);
      const result = ctx.getMessages(null, 1, 20);
      assert.equal(result.messages[0].text, 'undefined');
    });
  });

  testAsync('null arg', async () => {
    await withConsole(async (ctx, cdp) => {
      cdp.emit('Runtime.consoleAPICalled', {
        type: 'log',
        args: [{ type: 'object', subtype: 'null' }],
        timestamp: 1000,
      }, SID);
      const result = ctx.getMessages(null, 1, 20);
      assert.equal(result.messages[0].text, 'null');
    });
  });

  testAsync('multiple args joined', async () => {
    await withConsole(async (ctx, cdp) => {
      cdp.emit('Runtime.consoleAPICalled', {
        type: 'log',
        args: [
          { type: 'string', value: 'x =' },
          { type: 'number', value: 10 },
        ],
        timestamp: 1000,
      }, SID);
      const result = ctx.getMessages(null, 1, 20);
      assert.equal(result.messages[0].text, 'x = 10');
    });
  });
});

describe('console-context: FIFO eviction', () => {
  testAsync('messages beyond 1000 are evicted', async () => {
    await withConsole(async (ctx, cdp) => {
      for (let i = 0; i < 1010; i++) {
        cdp.emit('Runtime.consoleAPICalled', {
          type: 'log',
          args: [{ type: 'number', value: i }],
          timestamp: 1000 + i,
        }, SID);
      }
      const result = ctx.getMessages(null, 1, 20);
      assert.equal(result.total, 1000);
      assert.equal(result.messages[0].text, '10');
    });
  });
});

describe('console-context: type filtering', () => {
  testAsync('filter by error type', async () => {
    await withConsole(async (ctx, cdp) => {
      cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: 'info' }], timestamp: 1 }, SID);
      cdp.emit('Runtime.consoleAPICalled', { type: 'error', args: [{ type: 'string', value: 'err1' }], timestamp: 2 }, SID);
      cdp.emit('Runtime.consoleAPICalled', { type: 'error', args: [{ type: 'string', value: 'err2' }], timestamp: 3 }, SID);

      const result = ctx.getMessages('error', 1, 20);
      assert.equal(result.total, 2);
      assert.equal(result.messages[0].type, 'error');
    });
  });

  testAsync('warn maps to warning type', async () => {
    await withConsole(async (ctx, cdp) => {
      cdp.emit('Runtime.consoleAPICalled', { type: 'warning', args: [{ type: 'string', value: 'caution' }], timestamp: 1 }, SID);

      const result = ctx.getMessages('warn', 1, 20);
      assert.equal(result.total, 1);
      assert.equal(result.messages[0].type, 'warning');
    });
  });
});

describe('console-context: clear', () => {
  testAsync('clear empties messages', async () => {
    await withConsole(async (ctx, cdp) => {
      cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: 'test' }], timestamp: 1 }, SID);
      assert.equal(ctx.getMessages(null, 1, 20).total, 1);

      const count = ctx.clear();
      assert.equal(count, 1);
      assert.equal(ctx.getMessages(null, 1, 20).total, 0);
    });
  });
});

describe('console-context: pagination', () => {
  testAsync('page and size work correctly', async () => {
    await withConsole(async (ctx, cdp) => {
      for (let i = 0; i < 25; i++) {
        cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'number', value: i }], timestamp: i }, SID);
      }

      const page1 = ctx.getMessages(null, 1, 10);
      assert.equal(page1.messages.length, 10);
      assert.equal(page1.total, 25);
      assert.equal(page1.page, 1);
      assert.equal(page1.totalPages, 3);

      const page3 = ctx.getMessages(null, 3, 10);
      assert.equal(page3.messages.length, 5);
      assert.equal(page3.page, 3);
    });
  });
});

describe('console-context: getMessageById', () => {
  testAsync('returns message by id', async () => {
    await withConsole(async (ctx, cdp) => {
      cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: 'find-me' }], timestamp: 1 }, SID);
      const msg = ctx.getMessageById(1);
      assert.ok(msg);
      assert.equal(msg.text, 'find-me');
    });
  });

  testAsync('returns null for missing id', async () => {
    await withConsole(async (ctx) => {
      const msg = ctx.getMessageById(999);
      assert.equal(msg, null);
    });
  });
});

describe('console command: output formatting', () => {
  testAsync('handleConsole lists messages', async () => {
    const ctx = await import(CTX_SRC);
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID);

    cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: 'hello' }], timestamp: 1 }, SID);
    cdp.emit('Runtime.consoleAPICalled', { type: 'error', args: [{ type: 'string', value: 'oops' }], timestamp: 2 }, SID);

    const result = await cmd.handleConsole({ cdp, sessionId: SID, args: [] });
    assert.ok(result.includes('2 total'));
    assert.ok(result.includes('hello'));
    assert.ok(result.includes('oops'));

    ctx.disable();
  });

  testAsync('handleConsole clear', async () => {
    const ctx = await import(CTX_SRC);
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID);

    cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: 'test' }], timestamp: 1 }, SID);

    const result = await cmd.handleConsole({ cdp, sessionId: SID, args: ['clear'] });
    assert.ok(result.includes('Cleared 1'));

    ctx.disable();
  });

  testAsync('handleConsole message detail', async () => {
    const ctx = await import(CTX_SRC);
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID);

    cdp.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'detail-test' }],
      timestamp: 1,
      stackTrace: { callFrames: [{ url: 'app.js', lineNumber: 5, columnNumber: 0 }] },
    }, SID);

    const result = await cmd.handleConsole({ cdp, sessionId: SID, args: ['1'] });
    assert.ok(result.includes('Message #1'));
    assert.ok(result.includes('detail-test'));
    assert.ok(result.includes('app.js'));

    ctx.disable();
  });

  testAsync('handleConsole type filter', async () => {
    const ctx = await import(CTX_SRC);
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID);

    cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: 'info-msg' }], timestamp: 1 }, SID);
    cdp.emit('Runtime.consoleAPICalled', { type: 'error', args: [{ type: 'string', value: 'err-msg' }], timestamp: 2 }, SID);

    const result = await cmd.handleConsole({ cdp, sessionId: SID, args: ['error'] });
    assert.ok(result.includes('1 total'));
    assert.ok(result.includes('err-msg'));
    assert.ok(!result.includes('info-msg'));

    ctx.disable();
  });
});

summary();
