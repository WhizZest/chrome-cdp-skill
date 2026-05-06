import assert from 'assert/strict';
import { describe, testAsync, summary } from '../lib/test-runner.mjs';
import { TimeoutError } from '../../skills/chrome-cdp/scripts/lib/cdp-client.mjs';

const PAGE_SRC = '../../skills/chrome-cdp/scripts/commands/page.mjs';

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
const TARGET_ID = 'abc12345def67890';

await describe('fullpage screenshot: CDP call order with --full', async () => {
  await testAsync('calls bringToFront before captureScreenshot', async () => {
    const page = await import(PAGE_SRC);
    const cdp = createMockCDP({
      'Page.getLayoutMetrics': () => ({
        cssVisualViewport: { clientWidth: 1200, clientHeight: 800 },
        visualViewport: { clientWidth: 1200, clientHeight: 800 },
      }),
      'Page.bringToFront': () => ({}),
      'Page.captureScreenshot': () => ({ data: Buffer.from('fake-png').toString('base64') }),
      'Runtime.enable': () => ({}),
      'Runtime.evaluate': () => ({ result: { value: 1 } }),
    });

    try {
      await page.shotStr(cdp, SID, null, TARGET_ID, ['--full']);
    } catch (e) {
      if (!e.message.includes('ENOENT') && !e.message.includes('write')) throw e;
    }

    const methods = cdp.sent.map(s => s.method);
    const bringIdx = methods.indexOf('Page.bringToFront');
    const captureIdx = methods.indexOf('Page.captureScreenshot');
    assert.ok(bringIdx >= 0, 'bringToFront should be called');
    assert.ok(captureIdx >= 0, 'captureScreenshot should be called');
    assert.ok(bringIdx < captureIdx, 'bringToFront must be called before captureScreenshot');
  });

  await testAsync('passes captureBeyondViewport when --full', async () => {
    const page = await import(PAGE_SRC);
    const cdp = createMockCDP({
      'Page.getLayoutMetrics': () => ({
        cssVisualViewport: { clientWidth: 1200, clientHeight: 800 },
        visualViewport: { clientWidth: 1200, clientHeight: 800 },
      }),
      'Page.bringToFront': () => ({}),
      'Page.captureScreenshot': () => ({ data: Buffer.from('fake-png').toString('base64') }),
      'Runtime.enable': () => ({}),
      'Runtime.evaluate': () => ({ result: { value: 1 } }),
    });

    try {
      await page.shotStr(cdp, SID, null, TARGET_ID, ['--full']);
    } catch (e) {
      if (!e.message.includes('ENOENT') && !e.message.includes('write')) throw e;
    }

    const captureCall = cdp.sent.find(s => s.method === 'Page.captureScreenshot');
    assert.ok(captureCall, 'captureScreenshot should be called');
    assert.equal(captureCall.params.captureBeyondViewport, true, 'captureBeyondViewport should be true');
    assert.equal(captureCall.params.fromSurface, true, 'fromSurface should be true');
  });
});

await describe('fullpage screenshot: without --full', async () => {
  await testAsync('does not pass captureBeyondViewport', async () => {
    const page = await import(PAGE_SRC);
    const cdp = createMockCDP({
      'Page.getLayoutMetrics': () => ({
        cssVisualViewport: { clientWidth: 1200, clientHeight: 800 },
        visualViewport: { clientWidth: 1200, clientHeight: 800 },
      }),
      'Page.bringToFront': () => ({}),
      'Page.captureScreenshot': () => ({ data: Buffer.from('fake-png').toString('base64') }),
      'Runtime.enable': () => ({}),
      'Runtime.evaluate': () => ({ result: { value: 1 } }),
    });

    try {
      await page.shotStr(cdp, SID, null, TARGET_ID, []);
    } catch (e) {
      if (!e.message.includes('ENOENT') && !e.message.includes('write')) throw e;
    }

    const captureCall = cdp.sent.find(s => s.method === 'Page.captureScreenshot');
    assert.ok(captureCall, 'captureScreenshot should be called');
    assert.ok(!captureCall.params.captureBeyondViewport, 'captureBeyondViewport should not be set');
  });
});

await describe('fullpage screenshot: timeout retry', async () => {
  await testAsync('retries with fromSurface false on TimeoutError', async () => {
    const page = await import(PAGE_SRC);
    let callCount = 0;
    const cdp = createMockCDP({
      'Page.getLayoutMetrics': () => ({
        cssVisualViewport: { clientWidth: 1200, clientHeight: 800 },
        visualViewport: { clientWidth: 1200, clientHeight: 800 },
      }),
      'Page.bringToFront': () => ({}),
      'Page.captureScreenshot': () => {
        callCount++;
        if (callCount === 1) {
          throw new TimeoutError('Page.captureScreenshot');
        }
        return { data: Buffer.from('fake-png').toString('base64') };
      },
      'Runtime.enable': () => ({}),
      'Runtime.evaluate': () => ({ result: { value: 1 } }),
    });

    try {
      await page.shotStr(cdp, SID, null, TARGET_ID, ['--full']);
    } catch (e) {
      if (!e.message.includes('ENOENT') && !e.message.includes('write')) throw e;
    }

    assert.equal(callCount, 2, 'Should retry once after timeout');

    const captureCalls = cdp.sent.filter(s => s.method === 'Page.captureScreenshot');
    assert.equal(captureCalls.length, 2, 'captureScreenshot should be called twice');
    assert.equal(captureCalls[0].params.fromSurface, true, 'First call should use fromSurface true');
    assert.equal(captureCalls[1].params.fromSurface, false, 'Retry should use fromSurface false');
    assert.equal(captureCalls[1].params.captureBeyondViewport, true, 'Retry should still use captureBeyondViewport');
  });
});

await summary();
