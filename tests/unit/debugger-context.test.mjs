import assert from 'assert/strict';
import { describe, testAsync, summary } from '../lib/test-runner.mjs';

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
const SRC = '../../skills/chrome-cdp/scripts/lib/debugger-context.mjs';

async function withDebugger(fn) {
  const dbg = await import(SRC);
  const cdp = createMockCDP();
  await dbg.enable(cdp, SID);
  try {
    await fn(dbg, cdp);
  } finally {
    try { await dbg.disable(); } catch {}
  }
}

describe('debugger-context: enable/disable lifecycle', () => {
  testAsync('enable sets enabled state', async () => {
    const dbg = await import(SRC);
    const cdp = createMockCDP();
    await dbg.enable(cdp, SID);
    assert.equal(dbg.isEnabled(), true);
    const enableCall = cdp.sent.find(s => s.method === 'Debugger.enable');
    assert.ok(enableCall);
    assert.equal(enableCall.sid, SID);
    await dbg.disable();
  });

  testAsync('disable clears enabled state', async () => {
    const dbg = await import(SRC);
    const cdp = createMockCDP();
    await dbg.enable(cdp, SID);
    await dbg.disable();
    assert.equal(dbg.isEnabled(), false);
  });

  testAsync('isPaused returns false after enable', async () => {
    await withDebugger(async (dbg) => {
      assert.equal(dbg.isPaused(), false);
    });
  });
});

describe('debugger-context: script tracking', () => {
  testAsync('scriptParsed event registers script', async () => {
    await withDebugger(async (dbg, cdp) => {
      cdp.emit('Debugger.scriptParsed', {
        scriptId: 's1',
        url: 'https://example.com/app.js',
        startLine: 0, startColumn: 0, endLine: 100, endColumn: 0,
        hash: 'abc123',
      }, SID);

      const scripts = dbg.getScripts();
      assert.equal(scripts.length, 1);
      assert.equal(scripts[0].scriptId, 's1');
      assert.equal(scripts[0].url, 'https://example.com/app.js');
    });
  });

  testAsync('getScriptsByUrl returns matching scripts', async () => {
    await withDebugger(async (dbg, cdp) => {
      cdp.emit('Debugger.scriptParsed', {
        scriptId: 's1', url: 'https://example.com/app.js',
        startLine: 0, startColumn: 0, endLine: 100, endColumn: 0, hash: 'h1',
      }, SID);
      cdp.emit('Debugger.scriptParsed', {
        scriptId: 's2', url: 'https://example.com/other.js',
        startLine: 0, startColumn: 0, endLine: 50, endColumn: 0, hash: 'h2',
      }, SID);

      const matched = dbg.getScriptsByUrl('https://example.com/app.js');
      assert.equal(matched.length, 1);
      assert.equal(matched[0].scriptId, 's1');
    });
  });

  testAsync('scripts from different sessionId are ignored', async () => {
    await withDebugger(async (dbg, cdp) => {
      cdp.emit('Debugger.scriptParsed', {
        scriptId: 's-other', url: 'https://example.com/other-session.js',
        startLine: 0, startColumn: 0, endLine: 10, endColumn: 0, hash: 'h3',
      }, 'different-session');

      const scripts = dbg.getScripts();
      assert.equal(scripts.length, 0);
    });
  });
});

describe('debugger-context: breakpoint management', () => {
  testAsync('setBreakpoint registers and returns breakpoint', async () => {
    const dbg = await import(SRC);
    let bpCounter = 0;
    const cdp = createMockCDP({
      'Debugger.setBreakpointByUrl': (params) => {
        bpCounter++;
        return {
          breakpointId: `bp-set-${bpCounter}`,
          locations: [{ scriptId: 's1', lineNumber: params.lineNumber, columnNumber: params.columnNumber ?? 0 }],
        };
      },
      'Debugger.removeBreakpoint': () => ({}),
    });
    await dbg.enable(cdp, SID);

    const bp = await dbg.setBreakpoint('https://example.com/app.js', 42, 0);
    assert.ok(bp.breakpointId);
    assert.equal(bp.url, 'https://example.com/app.js');
    assert.equal(bp.lineNumber, 42);

    const allBps = dbg.getBreakpoints();
    assert.equal(allBps.length, 1);

    await dbg.disable();
  });

  testAsync('removeBreakpoint removes from internal map', async () => {
    const dbg = await import(SRC);
    let bpCounter = 0;
    const cdp = createMockCDP({
      'Debugger.setBreakpointByUrl': () => {
        bpCounter++;
        return { breakpointId: `bp-rm-${bpCounter}`, locations: [] };
      },
      'Debugger.removeBreakpoint': () => ({}),
    });
    await dbg.enable(cdp, SID);
    await dbg.removeAllBreakpoints();

    const bp = await dbg.setBreakpoint('https://example.com/app.js', 10);
    assert.equal(dbg.getBreakpoints().length, 1);

    await dbg.removeBreakpoint(bp.breakpointId);
    assert.equal(dbg.getBreakpoints().length, 0);

    await dbg.disable();
  });

  testAsync('setXHRBreakpoint adds to internal set', async () => {
    await withDebugger(async (dbg) => {
      await dbg.setXHRBreakpoint('/api/data');
      const xhrBps = dbg.getXHRBreakpoints();
      assert.ok(xhrBps.includes('/api/data'));
    });
  });

  testAsync('removeXHRBreakpoint removes from internal set', async () => {
    await withDebugger(async (dbg) => {
      await dbg.setXHRBreakpoint('/api/data');
      await dbg.removeXHRBreakpoint('/api/data');
      const xhrBps = dbg.getXHRBreakpoints();
      assert.ok(!xhrBps.includes('/api/data'));
    });
  });
});

describe('debugger-context: reset preserves breakpoints', () => {
  testAsync('reset re-enables and restores breakpoints', async () => {
    const dbg = await import(SRC);
    let bpCounter = 0;
    const cdp = createMockCDP({
      'Debugger.setBreakpointByUrl': () => {
        bpCounter++;
        return { breakpointId: `bp-reset-${bpCounter}`, locations: [] };
      },
      'Debugger.removeBreakpoint': () => ({}),
      'DOMDebugger.setXHRBreakpoint': () => ({}),
      'DOMDebugger.removeXHRBreakpoint': () => ({}),
    });
    await dbg.enable(cdp, SID);
    await dbg.removeAllBreakpoints();

    await dbg.setBreakpoint('https://example.com/app.js', 5);
    await dbg.setXHRBreakpoint('/api/test');
    assert.equal(dbg.getBreakpoints().length, 1);
    assert.equal(dbg.getXHRBreakpoints().length, 1);

    const result = await dbg.reset(cdp, SID);
    assert.ok(result.includes('Restored 1 breakpoint(s)'));
    assert.ok(result.includes('1 XHR breakpoint(s)'));
    assert.equal(dbg.isEnabled(), true);

    await dbg.disable();
  });

  testAsync('disable preserves breakpoint definitions for restore', async () => {
    const dbg = await import(SRC);
    let bpCounter = 0;
    const cdp = createMockCDP({
      'Debugger.setBreakpointByUrl': () => {
        bpCounter++;
        return { breakpointId: `bp-preserve-${bpCounter}`, locations: [] };
      },
      'Debugger.removeBreakpoint': () => ({}),
      'DOMDebugger.removeXHRBreakpoint': () => ({}),
    });
    await dbg.enable(cdp, SID);
    await dbg.removeAllBreakpoints();

    await dbg.setBreakpoint('https://example.com/app.js', 20);
    assert.equal(dbg.getBreakpoints().length, 1);

    await dbg.disable();
    assert.equal(dbg.isEnabled(), false);

    const cdp2 = createMockCDP({
      'Debugger.setBreakpointByUrl': () => {
        bpCounter++;
        return { breakpointId: `bp-preserve2-${bpCounter}`, locations: [] };
      },
    });
    await dbg.enable(cdp2, SID);
    const result = await dbg.restoreBreakpoints();
    assert.ok(result.includes('Restored 1 breakpoint(s)'));

    await dbg.disable();
  });
});

describe('debugger-context: paused state', () => {
  testAsync('Debugger.paused event sets isPaused', async () => {
    await withDebugger(async (dbg, cdp) => {
      cdp.emit('Debugger.paused', {
        reason: 'breakpoint',
        callFrames: [{
          callFrameId: 'cf1',
          functionName: 'testFunc',
          location: { scriptId: 's1', lineNumber: 10, columnNumber: 0 },
          url: 'https://example.com/app.js',
          scopeChain: [],
          this: { type: 'object' },
        }],
        hitBreakpoints: ['bp-1'],
      }, SID);

      assert.equal(dbg.isPaused(), true);
      const state = dbg.getPausedState();
      assert.equal(state.reason, 'breakpoint');
      assert.equal(state.callFrames.length, 1);
    });
  });

  testAsync('Debugger.resumed event clears isPaused', async () => {
    await withDebugger(async (dbg, cdp) => {
      cdp.emit('Debugger.paused', {
        reason: 'breakpoint',
        callFrames: [{ callFrameId: 'cf1', functionName: 'fn', location: { scriptId: 's1', lineNumber: 1, columnNumber: 0 }, url: '', scopeChain: [], this: { type: 'object' } }],
        hitBreakpoints: ['bp-1'],
      }, SID);
      assert.equal(dbg.isPaused(), true);

      cdp.emit('Debugger.resumed', {}, SID);
      assert.equal(dbg.isPaused(), false);
    });
  });

  testAsync('debugger; statement auto-resumes (reason=other, no hitBreakpoints)', async () => {
    await withDebugger(async (dbg, cdp) => {
      cdp.emit('Debugger.paused', {
        reason: 'other',
        callFrames: [{ callFrameId: 'cf1', functionName: 'fn', location: { scriptId: 's1', lineNumber: 1, columnNumber: 0 }, url: '', scopeChain: [], this: { type: 'object' } }],
        hitBreakpoints: [],
      }, SID);

      assert.equal(dbg.isPaused(), false);
      const resumeCall = cdp.sent.find(s => s.method === 'Debugger.resume');
      assert.ok(resumeCall);
    });
  });
});

describe('debugger-context: resume with state sync', () => {
  testAsync('resume throws when not paused', async () => {
    await withDebugger(async (dbg) => {
      await assert.rejects(
        () => dbg.resume(),
        /Execution is not paused/
      );
    });
  });

  testAsync('resume syncs state when CDP says not paused', async () => {
    const dbg = await import(SRC);
    const cdp = createMockCDP({
      'Debugger.resume': () => Promise.reject(new Error('Can only perform operation while paused')),
    });
    await dbg.enable(cdp, SID);

    cdp.emit('Debugger.paused', {
      reason: 'breakpoint',
      callFrames: [{ callFrameId: 'cf1', functionName: 'fn', location: { scriptId: 's1', lineNumber: 1, columnNumber: 0 }, url: '', scopeChain: [], this: { type: 'object' } }],
      hitBreakpoints: ['bp-1'],
    }, SID);
    assert.equal(dbg.isPaused(), true);

    await assert.rejects(
      () => dbg.resume(),
      /state synchronized/
    );
    assert.equal(dbg.isPaused(), false);

    await dbg.disable();
  });
});

summary();
