import assert from 'assert/strict';
import { describe, testAsync, summary } from '../lib/test-runner.mjs';

const CTX_SRC = '../../skills/chrome-cdp/scripts/lib/intercept-context.mjs';
const CMD_SRC = '../../skills/chrome-cdp/scripts/commands/intercept.mjs';

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

describe('intercept-context: rule management', () => {
  testAsync('addRule creates rule with correct fields', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const rule = ctx.addRule('https://api.example.com/*', 'mock', 'Request', { status: 200, body: '{"ok":true}' });
    assert.equal(rule.ruleId, 'R1');
    assert.equal(rule.action, 'mock');
    assert.equal(rule.pattern, 'https://api.example.com/*');
    assert.equal(rule.hitCount, 0);
    ctx.reset();
  });

  testAsync('removeRule deletes rule', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const rule = ctx.addRule('*', 'block', 'Request');
    assert.equal(ctx.getRules().length, 1);
    const removed = ctx.removeRule(rule.ruleId);
    assert.equal(removed, true);
    assert.equal(ctx.getRules().length, 0);
    ctx.reset();
  });

  testAsync('clearRules removes all rules', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    ctx.addRule('*', 'block', 'Request');
    ctx.addRule('https://*', 'mock', 'Request');
    const count = ctx.clearRules();
    assert.equal(count, 2);
    assert.equal(ctx.getRules().length, 0);
    ctx.reset();
  });
});

describe('intercept-context: matchUrl', () => {
  testAsync('exact match', async () => {
    const ctx = await import(CTX_SRC);
    assert.equal(ctx.matchUrl('https://api.example.com/data', 'https://api.example.com/data'), true);
    assert.equal(ctx.matchUrl('https://api.example.com/data', 'https://other.com/data'), false);
  });

  testAsync('wildcard * matches all', async () => {
    const ctx = await import(CTX_SRC);
    assert.equal(ctx.matchUrl('*', 'https://anything.com/path'), true);
  });

  testAsync('substring match', async () => {
    const ctx = await import(CTX_SRC);
    assert.equal(ctx.matchUrl('api.example', 'https://api.example.com/data'), true);
    assert.equal(ctx.matchUrl('other.example', 'https://api.example.com/data'), false);
  });

  testAsync('glob pattern with *', async () => {
    const ctx = await import(CTX_SRC);
    assert.equal(ctx.matchUrl('https://api.example.com/*', 'https://api.example.com/data'), true);
    assert.equal(ctx.matchUrl('https://api.example.com/*', 'https://api.example.com/v1/users'), true);
    assert.equal(ctx.matchUrl('https://api.example.com/*', 'https://other.com/data'), false);
  });
});

describe('intercept-context: findMatchingRule', () => {
  testAsync('finds matching rule by stage and url', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    ctx.addRule('https://api.example.com/*', 'mock', 'Request');
    ctx.addRule('https://api.example.com/*', 'mock', 'Response');

    const reqRule = ctx.findMatchingRule('https://api.example.com/data', 'Request');
    assert.ok(reqRule);
    assert.equal(reqRule.stage, 'Request');

    const resRule = ctx.findMatchingRule('https://api.example.com/data', 'Response');
    assert.ok(resRule);
    assert.equal(resRule.stage, 'Response');

    ctx.reset();
  });

  testAsync('returns null when no match', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    ctx.addRule('https://other.com/*', 'block', 'Request');
    const rule = ctx.findMatchingRule('https://api.example.com/data', 'Request');
    assert.equal(rule, null);
    ctx.reset();
  });
});

describe('intercept-context: enable/disable', () => {
  testAsync('enable sends Fetch.enable with patterns', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID, ['Request']);
    assert.ok(cdp.sent.some(s => s.method === 'Fetch.enable'));
    const fetchEnable = cdp.sent.find(s => s.method === 'Fetch.enable');
    assert.ok(fetchEnable.params.patterns);
    assert.equal(fetchEnable.params.patterns[0].requestStage, 'Request');
    await ctx.disable(cdp, SID);
    ctx.reset();
  });

  testAsync('disable sends Fetch.disable', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID, ['Request']);
    await ctx.disable(cdp, SID);
    assert.ok(cdp.sent.some(s => s.method === 'Fetch.disable'));
    ctx.reset();
  });
});

describe('intercept-context: requestPaused handling', () => {
  testAsync('unmatched request passes through with continueRequest', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID, ['Request']);

    cdp.emit('Fetch.requestPaused', {
      requestId: 'req-1',
      request: { url: 'https://example.com/page' },
    }, SID);

    await new Promise(r => setTimeout(r, 10));

    assert.ok(cdp.sent.some(s => s.method === 'Fetch.continueRequest'));
    await ctx.disable(cdp, SID);
    ctx.reset();
  });

  testAsync('matched mock rule fulfills request', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID, ['Request']);
    ctx.addRule('https://api.example.com/*', 'mock', 'Request', { status: 200, body: '{"mocked":true}', headers: { 'Content-Type': 'application/json' } });

    cdp.emit('Fetch.requestPaused', {
      requestId: 'req-2',
      request: { url: 'https://api.example.com/data' },
    }, SID);

    await new Promise(r => setTimeout(r, 10));

    assert.ok(cdp.sent.some(s => s.method === 'Fetch.fulfillRequest'));
    const fulfill = cdp.sent.find(s => s.method === 'Fetch.fulfillRequest');
    assert.equal(fulfill.params.responseCode, 200);
    await ctx.disable(cdp, SID);
    ctx.reset();
  });

  testAsync('matched block rule fails request', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID, ['Request']);
    ctx.addRule('https://ads.example.com/*', 'block', 'Request');

    cdp.emit('Fetch.requestPaused', {
      requestId: 'req-3',
      request: { url: 'https://ads.example.com/banner.js' },
    }, SID);

    await new Promise(r => setTimeout(r, 10));

    assert.ok(cdp.sent.some(s => s.method === 'Fetch.failRequest'));
    const fail = cdp.sent.find(s => s.method === 'Fetch.failRequest');
    assert.equal(fail.params.errorReason, 'BlockedByClient');
    await ctx.disable(cdp, SID);
    ctx.reset();
  });

  testAsync('matched modify-header rule continues with headers', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID, ['Request']);
    ctx.addRule('https://api.example.com/*', 'modify-header', 'Request', { headerName: 'X-Custom', headerValue: 'test123' });

    cdp.emit('Fetch.requestPaused', {
      requestId: 'req-4',
      request: { url: 'https://api.example.com/data', headers: { 'Accept': 'application/json' } },
    }, SID);

    await new Promise(r => setTimeout(r, 10));

    assert.ok(cdp.sent.some(s => s.method === 'Fetch.continueRequest'));
    const cont = cdp.sent.find(s => s.method === 'Fetch.continueRequest');
    assert.ok(cont.params.headers);
    const customHeader = cont.params.headers.find(h => h.name === 'X-Custom');
    assert.ok(customHeader);
    assert.equal(customHeader.value, 'test123');
    await ctx.disable(cdp, SID);
    ctx.reset();
  });

  testAsync('response stage uses continueResponse for unmatched', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID, ['Response']);

    cdp.emit('Fetch.requestPaused', {
      requestId: 'req-5',
      request: { url: 'https://example.com/page' },
      responseStatusCode: 200,
    }, SID);

    await new Promise(r => setTimeout(r, 10));

    assert.ok(cdp.sent.some(s => s.method === 'Fetch.continueResponse'));
    await ctx.disable(cdp, SID);
    ctx.reset();
  });

  testAsync('hitCount increments on match', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID, ['Request']);
    const rule = ctx.addRule('https://api.example.com/*', 'mock', 'Request', { status: 200, body: 'ok' });

    cdp.emit('Fetch.requestPaused', { requestId: 'req-6', request: { url: 'https://api.example.com/data' } }, SID);
    await new Promise(r => setTimeout(r, 10));
    cdp.emit('Fetch.requestPaused', { requestId: 'req-7', request: { url: 'https://api.example.com/data' } }, SID);
    await new Promise(r => setTimeout(r, 10));

    assert.equal(rule.hitCount, 2);
    await ctx.disable(cdp, SID);
    ctx.reset();
  });
});

describe('intercept-context: stats', () => {
  testAsync('getStats returns correct data', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    ctx.addRule('*', 'block', 'Request');
    ctx.addRule('https://*', 'mock', 'Request');

    const stats = ctx.getStats();
    assert.equal(stats.totalRules, 2);
    assert.equal(stats.totalHits, 0);
    assert.equal(stats.rules.length, 2);
    ctx.reset();
  });
});

describe('intercept command: output formatting', () => {
  testAsync('handleIntercept on enables interception', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();

    const result = await cmd.handleIntercept({ cdp, sessionId: SID, args: ['on'] });
    assert.ok(result.includes('enabled'));
    await ctx.disable(cdp, SID);
    ctx.reset();
  });

  testAsync('handleIntercept off disables interception', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();
    await ctx.enable(cdp, SID, ['Request']);

    const result = await cmd.handleIntercept({ cdp, sessionId: SID, args: ['off'] });
    assert.ok(result.includes('disabled'));
    ctx.reset();
  });

  testAsync('handleIntercept modify-header adds rule', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();

    const result = await cmd.handleIntercept({ cdp, sessionId: SID, args: ['modify-header', 'https://api.example.com/*', 'X-Token', 'abc123'] });
    assert.ok(result.includes('R1'));
    assert.ok(result.includes('modify header'));
    assert.ok(result.includes('X-Token'));
    ctx.reset();
  });

  testAsync('handleIntercept mock adds rule', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();

    const result = await cmd.handleIntercept({ cdp, sessionId: SID, args: ['mock', 'https://api.example.com/*', '200', '{"ok":true}'] });
    assert.ok(result.includes('R1'));
    assert.ok(result.includes('mock'));
    ctx.reset();
  });

  testAsync('handleIntercept block adds rule', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();

    const result = await cmd.handleIntercept({ cdp, sessionId: SID, args: ['block', 'https://ads.example.com/*'] });
    assert.ok(result.includes('R1'));
    assert.ok(result.includes('block'));
    ctx.reset();
  });

  testAsync('handleIntercept list shows rules', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();

    ctx.addRule('*', 'block', 'Request');
    const result = await cmd.handleIntercept({ cdp, sessionId: SID, args: ['list'] });
    assert.ok(result.includes('1 Rules') || result.includes('Rules (1)'));
    ctx.reset();
  });

  testAsync('handleIntercept remove deletes rule', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();

    const rule = ctx.addRule('*', 'block', 'Request');
    const result = await cmd.handleIntercept({ cdp, sessionId: SID, args: ['remove', rule.ruleId] });
    assert.ok(result.includes('removed'));
    assert.equal(ctx.getRules().length, 0);
    ctx.reset();
  });

  testAsync('handleIntercept stats shows statistics', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();

    ctx.addRule('*', 'block', 'Request');
    const result = await cmd.handleIntercept({ cdp, sessionId: SID, args: ['stats'] });
    assert.ok(result.includes('Statistics'));
    assert.ok(result.includes('Total rules: 1'));
    ctx.reset();
  });

  testAsync('handleIntercept unknown subcommand throws', async () => {
    const ctx = await import(CTX_SRC);
    ctx.reset();
    const cmd = await import(CMD_SRC);
    const cdp = createMockCDP();

    try {
      await cmd.handleIntercept({ cdp, sessionId: SID, args: ['unknown'] });
      assert.fail('Should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('Unknown'));
    }
    ctx.reset();
  });
});

summary();
