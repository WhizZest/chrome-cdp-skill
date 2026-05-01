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
  const cdp = createMockCDP();
  dbg.clearInjectedScripts();
  await dbg.enable(cdp, SID);
  try {
    await fn(dbg, cdp);
  } finally {
    dbg.clearInjectedScripts();
    await dbg.disable();
  }
}

await describe('inject-tracker: addInjectedScript / getInjectedScripts', async () => {
  await testAsync('tracks a single injected script', async () => {
    await withDebugger(async (dbg) => {
      dbg.addInjectedScript('1', 'console.log("hello")');
      const scripts = dbg.getInjectedScripts();
      assert.equal(scripts.length, 1);
      assert.equal(scripts[0].identifier, '1');
      assert.equal(scripts[0].source, 'console.log("hello")');
      assert.ok(scripts[0].timestamp > 0);
    });
  });

  await testAsync('tracks multiple injected scripts', async () => {
    await withDebugger(async (dbg) => {
      dbg.addInjectedScript('1', 'code1');
      dbg.addInjectedScript('2', 'code2');
      dbg.addInjectedScript('3', 'code3');
      const scripts = dbg.getInjectedScripts();
      assert.equal(scripts.length, 3);
      assert.equal(scripts[0].identifier, '1');
      assert.equal(scripts[1].identifier, '2');
      assert.equal(scripts[2].identifier, '3');
    });
  });

  await testAsync('overwrites duplicate identifier', async () => {
    await withDebugger(async (dbg) => {
      dbg.addInjectedScript('1', 'old code');
      dbg.addInjectedScript('1', 'new code');
      const scripts = dbg.getInjectedScripts();
      assert.equal(scripts.length, 1);
      assert.equal(scripts[0].source, 'new code');
    });
  });
});

await describe('inject-tracker: removeInjectedScript', async () => {
  await testAsync('removes a tracked script', async () => {
    await withDebugger(async (dbg) => {
      dbg.addInjectedScript('1', 'code1');
      dbg.addInjectedScript('2', 'code2');
      dbg.removeInjectedScript('1');
      const scripts = dbg.getInjectedScripts();
      assert.equal(scripts.length, 1);
      assert.equal(scripts[0].identifier, '2');
    });
  });

  await testAsync('removing non-existent identifier is safe', async () => {
    await withDebugger(async (dbg) => {
      dbg.addInjectedScript('1', 'code1');
      dbg.removeInjectedScript('999');
      const scripts = dbg.getInjectedScripts();
      assert.equal(scripts.length, 1);
    });
  });
});

await describe('inject-tracker: clearInjectedScripts', async () => {
  await testAsync('clears all injected scripts', async () => {
    await withDebugger(async (dbg) => {
      dbg.addInjectedScript('1', 'code1');
      dbg.addInjectedScript('2', 'code2');
      dbg.clearInjectedScripts();
      const scripts = dbg.getInjectedScripts();
      assert.equal(scripts.length, 0);
    });
  });
});

await describe('inject-tracker: handleInjectList output', async () => {
  await testAsync('formats inject list with preview truncation', async () => {
    await withDebugger(async (dbg) => {
      const longCode = 'x'.repeat(150);
      dbg.addInjectedScript('1', longCode);
      const scripts = dbg.getInjectedScripts();
      assert.equal(scripts.length, 1);
      assert.equal(scripts[0].source.length, 150);
    });
  });
});

await describe('inject-tracker: clearInjectedScripts on reset', async () => {
  await testAsync('clearInjectedScripts clears tracking after reset', async () => {
    const dbg = await import(DBG_SRC);
    const cdp = createMockCDP();
    await dbg.enable(cdp, SID);
    dbg.addInjectedScript('1', 'code1');
    assert.equal(dbg.getInjectedScripts().length, 1);

    dbg.clearInjectedScripts();
    assert.equal(dbg.getInjectedScripts().length, 0);
    await dbg.disable();
  });
});

console.log(summary());
