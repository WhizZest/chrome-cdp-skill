import assert from 'assert/strict';
import { describe, testAsync, summary } from '../lib/test-runner.mjs';

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
  await testAsync('calls setDeviceMetricsOverride before captureScreenshot', async () => {
    const page = await import(PAGE_SRC);
    const cdp = createMockCDP({
      'Page.getLayoutMetrics': () => ({
        cssContentSize: { width: 1200, height: 8000 },
        cssVisualViewport: { clientWidth: 1200, clientHeight: 800 },
        visualViewport: { clientWidth: 2400, clientHeight: 1600 },
      }),
      'Emulation.getDeviceMetricsOverride': () => {
        throw new Error('Not overridden');
      },
      'Emulation.setDeviceMetricsOverride': () => ({}),
      'Emulation.clearDeviceMetricsOverride': () => ({}),
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
    const setIdx = methods.indexOf('Emulation.setDeviceMetricsOverride');
    const captureIdx = methods.indexOf('Page.captureScreenshot');
    assert.ok(setIdx >= 0, 'setDeviceMetricsOverride should be called');
    assert.ok(captureIdx >= 0, 'captureScreenshot should be called');
    assert.ok(setIdx < captureIdx, 'setDeviceMetricsOverride must be called before captureScreenshot');
  });

  await testAsync('calls clearDeviceMetricsOverride after captureScreenshot when no original metrics', async () => {
    const page = await import(PAGE_SRC);
    const cdp = createMockCDP({
      'Page.getLayoutMetrics': () => ({
        cssContentSize: { width: 1200, height: 5000 },
        cssVisualViewport: { clientWidth: 1200, clientHeight: 800 },
        visualViewport: { clientWidth: 1200, clientHeight: 800 },
      }),
      'Emulation.getDeviceMetricsOverride': () => {
        throw new Error('Not overridden');
      },
      'Emulation.setDeviceMetricsOverride': () => ({}),
      'Emulation.clearDeviceMetricsOverride': () => ({}),
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
    const captureIdx = methods.indexOf('Page.captureScreenshot');
    const clearIdx = methods.indexOf('Emulation.clearDeviceMetricsOverride');
    assert.ok(clearIdx >= 0, 'clearDeviceMetricsOverride should be called');
    assert.ok(captureIdx < clearIdx, 'clearDeviceMetricsOverride must be called after captureScreenshot');
  });

  await testAsync('restores original metrics when they existed', async () => {
    const page = await import(PAGE_SRC);
    const originalMetrics = { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false };
    const cdp = createMockCDP({
      'Page.getLayoutMetrics': () => ({
        cssContentSize: { width: 1200, height: 5000 },
        cssVisualViewport: { clientWidth: 1200, clientHeight: 800 },
        visualViewport: { clientWidth: 1200, clientHeight: 800 },
      }),
      'Emulation.getDeviceMetricsOverride': () => originalMetrics,
      'Emulation.setDeviceMetricsOverride': () => ({}),
      'Emulation.clearDeviceMetricsOverride': () => ({}),
      'Page.captureScreenshot': () => ({ data: Buffer.from('fake-png').toString('base64') }),
      'Runtime.enable': () => ({}),
      'Runtime.evaluate': () => ({ result: { value: 1 } }),
    });

    try {
      await page.shotStr(cdp, SID, null, TARGET_ID, ['--full']);
    } catch (e) {
      if (!e.message.includes('ENOENT') && !e.message.includes('write')) throw e;
    }

    const setCalls = cdp.sent.filter(s => s.method === 'Emulation.setDeviceMetricsOverride');
    assert.ok(setCalls.length >= 2, 'setDeviceMetricsOverride should be called at least twice (set + restore)');

    const lastSetCall = setCalls[setCalls.length - 1];
    assert.equal(lastSetCall.params.width, 1920, 'Should restore original width');
    assert.equal(lastSetCall.params.height, 1080, 'Should restore original height');
  });
});

await describe('fullpage screenshot: without --full', async () => {
  await testAsync('does not call setDeviceMetricsOverride', async () => {
    const page = await import(PAGE_SRC);
    const cdp = createMockCDP({
      'Page.getLayoutMetrics': () => ({
        cssVisualViewport: { clientWidth: 1200, clientHeight: 800 },
        visualViewport: { clientWidth: 1200, clientHeight: 800 },
      }),
      'Emulation.getDeviceMetricsOverride': () => {
        throw new Error('Not overridden');
      },
      'Page.captureScreenshot': () => ({ data: Buffer.from('fake-png').toString('base64') }),
      'Runtime.enable': () => ({}),
      'Runtime.evaluate': () => ({ result: { value: 1 } }),
    });

    try {
      await page.shotStr(cdp, SID, null, TARGET_ID, []);
    } catch (e) {
      if (!e.message.includes('ENOENT') && !e.message.includes('write')) throw e;
    }

    const methods = cdp.sent.map(s => s.method);
    assert.ok(!methods.includes('Emulation.setDeviceMetricsOverride'), 'Should not call setDeviceMetricsOverride');
    assert.ok(!methods.includes('Emulation.clearDeviceMetricsOverride'), 'Should not call clearDeviceMetricsOverride');
  });
});

await describe('fullpage screenshot: height truncation via CDP', async () => {
  await testAsync('caps height at 16384 when page is taller', async () => {
    const page = await import(PAGE_SRC);
    const cdp = createMockCDP({
      'Page.getLayoutMetrics': () => ({
        cssContentSize: { width: 1200, height: 20000 },
        cssVisualViewport: { clientWidth: 1200, clientHeight: 800 },
        visualViewport: { clientWidth: 1200, clientHeight: 800 },
      }),
      'Emulation.getDeviceMetricsOverride': () => {
        throw new Error('Not overridden');
      },
      'Emulation.setDeviceMetricsOverride': () => ({}),
      'Emulation.clearDeviceMetricsOverride': () => ({}),
      'Page.captureScreenshot': () => ({ data: Buffer.from('fake-png').toString('base64') }),
      'Runtime.enable': () => ({}),
      'Runtime.evaluate': () => ({ result: { value: 1 } }),
    });

    try {
      await page.shotStr(cdp, SID, null, TARGET_ID, ['--full']);
    } catch (e) {
      if (!e.message.includes('ENOENT') && !e.message.includes('write')) throw e;
    }

    const setCall = cdp.sent.find(s => s.method === 'Emulation.setDeviceMetricsOverride');
    assert.ok(setCall, 'setDeviceMetricsOverride should be called');
    assert.equal(setCall.params.height, 16384, 'Height should be capped at 16384');
    assert.equal(setCall.params.width, 1200, 'Width should be preserved');
  });
});

await summary();
