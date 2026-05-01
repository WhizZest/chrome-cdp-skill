import assert from 'assert/strict';
import { describe, testAsync, summary } from '../lib/test-runner.mjs';

const DBG_SRC = '../../skills/chrome-cdp/scripts/lib/debugger-context.mjs';

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

async function withDebugger(fn) {
  const dbg = await import(DBG_SRC);
  const cdp = createMockCDP({
    'Debugger.setBreakpointByUrl': (params) => ({
      breakpointId: `bp-${params.lineNumber}-${params.columnNumber}-${Date.now()}`,
      locations: [],
    }),
  });
  await dbg.enable(cdp, SID);
  try {
    await fn(dbg, cdp);
  } finally {
    try { await dbg.removeAllBreakpoints(); } catch {}
    await dbg.disable();
  }
}

await describe('logpoint: condition expression generation', async () => {
  await testAsync('custom expression wraps in console.log + false', async () => {
    await withDebugger(async (dbg) => {
      const info = await dbg.setBreakpoint(
        'https://example.com/app.js', 41, 0,
        '(console.log(JSON.stringify({key: secretKey})), false)',
        true
      );
      assert.equal(info.isLogpoint, true);
      assert.equal(info.condition, '(console.log(JSON.stringify({key: secretKey})), false)');
    });
  });

  await testAsync('default expression includes line number', async () => {
    await withDebugger(async (dbg) => {
      const line = 41;
      const defaultCondition = `(console.log('[Logpoint L${line + 1}]', JSON.stringify({line: ${line + 1}})), false)`;
      const info = await dbg.setBreakpoint(
        'https://example.com/app.js', line, 0,
        defaultCondition,
        true
      );
      assert.equal(info.isLogpoint, true);
      assert.ok(info.condition.includes('Logpoint L42'));
    });
  });

  await testAsync('regular breakpoint has isLogpoint false', async () => {
    await withDebugger(async (dbg) => {
      const info = await dbg.setBreakpoint(
        'https://example.com/app.js', 10, 0,
        'x > 5'
      );
      assert.equal(info.isLogpoint, false);
      assert.equal(info.condition, 'x > 5');
    });
  });

  await testAsync('breakpoint without condition has isLogpoint false', async () => {
    await withDebugger(async (dbg) => {
      const info = await dbg.setBreakpoint(
        'https://example.com/app.js', 10, 0
      );
      assert.equal(info.isLogpoint, false);
      assert.equal(info.condition, null);
    });
  });
});

await describe('logpoint: extractLogExpr', async () => {
  function extractLogExpr(condition) {
    if (!condition) return '';
    const match = condition.match(/^\(console\.log\((.+)\), false\)$/);
    return match ? match[1] : condition;
  }

  await testAsync('extracts expression from logpoint condition', () => {
    const result = extractLogExpr('(console.log(x), false)');
    assert.equal(result, 'x');
  });

  await testAsync('extracts complex expression', () => {
    const result = extractLogExpr('(console.log(JSON.stringify({a:1})), false)');
    assert.equal(result, 'JSON.stringify({a:1})');
  });

  await testAsync('returns raw condition for non-logpoint', () => {
    const result = extractLogExpr('x > 5');
    assert.equal(result, 'x > 5');
  });

  await testAsync('returns empty for null condition', () => {
    const result = extractLogExpr(null);
    assert.equal(result, '');
  });
});

await describe('logpoint: setBreakpointByUrlRegex with isLogpoint', async () => {
  await testAsync('urlRegex breakpoint supports isLogpoint', async () => {
    await withDebugger(async (dbg) => {
      const info = await dbg.setBreakpointByUrlRegex(
        '.*\\.js', 10, 0,
        '(console.log("test"), false)',
        true
      );
      assert.equal(info.isLogpoint, true);
      assert.equal(info.isRegex, true);
    });
  });
});

await describe('logpoint: breaks display', async () => {
  await testAsync('logpoint appears in getBreakpoints with isLogpoint flag', async () => {
    await withDebugger(async (dbg) => {
      await dbg.setBreakpoint('https://example.com/app.js', 10, 0, '(console.log(x), false)', true);
      await dbg.setBreakpoint('https://example.com/app.js', 20, 0, 'y > 0', false);

      const bps = dbg.getBreakpoints();
      assert.equal(bps.length, 2);

      const logpoint = bps.find(bp => bp.isLogpoint);
      const regularBp = bps.find(bp => !bp.isLogpoint);

      assert.ok(logpoint);
      assert.ok(regularBp);
      assert.equal(logpoint.condition, '(console.log(x), false)');
      assert.equal(regularBp.condition, 'y > 0');
    });
  });

  await testAsync('unbreak removes logpoint', async () => {
    await withDebugger(async (dbg) => {
      const info = await dbg.setBreakpoint('https://example.com/app.js', 10, 0, '(console.log(x), false)', true);
      assert.equal(dbg.getBreakpoints().length, 1);

      await dbg.removeBreakpoint(info.breakpointId);
      assert.equal(dbg.getBreakpoints().length, 0);
    });
  });
});

console.log(summary());
