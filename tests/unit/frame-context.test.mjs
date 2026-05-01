import assert from 'assert/strict';
import { describe, testAsync, summary } from '../lib/test-runner.mjs';

const FRAME_CTX_SRC = '../../skills/chrome-cdp/scripts/lib/frame-context.mjs';

function createMockCDP() {
  const events = {};
  return {
    onEvent: (name, handler) => {
      events[name] = events[name] || [];
      events[name].push(handler);
      return () => {
        events[name] = events[name].filter(h => h !== handler);
      };
    },
    send: () => Promise.resolve({}),
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

await describe('frame-context: frame registration', async () => {
  await testAsync('onFrameNavigated adds frame to tree', async () => {
    const frameCtx = await import(FRAME_CTX_SRC);
    const cdp = createMockCDP();
    await frameCtx.enable(cdp, SID);

    cdp.emit('Page.frameNavigated', {
      frame: { id: 'main-001', url: 'https://example.com' },
    }, SID);

    const frames = frameCtx.getFlatFrames();
    assert.equal(frames.length, 1);
    assert.equal(frames[0].id, 'main-001');
    assert.equal(frames[0].url, 'https://example.com');

    frameCtx.disable();
  });

  await testAsync('parent-child relationship', async () => {
    const frameCtx = await import(FRAME_CTX_SRC);
    const cdp = createMockCDP();
    await frameCtx.enable(cdp, SID);

    cdp.emit('Page.frameNavigated', {
      frame: { id: 'main-002', url: 'https://example.com' },
    }, SID);
    cdp.emit('Page.frameAttached', {
      frameId: 'iframe-001',
      parentFrameId: 'main-002',
    }, SID);
    cdp.emit('Page.frameNavigated', {
      frame: { id: 'iframe-001', url: 'https://cdn.example.com/widget', parentId: 'main-002' },
    }, SID);

    const frames = frameCtx.getFlatFrames();
    assert.equal(frames.length, 2);

    const main = frames.find(f => f.id === 'main-002');
    assert.ok(main);
    assert.ok(main.children.includes('iframe-001'));

    const iframe = frames.find(f => f.id === 'iframe-001');
    assert.equal(iframe.parentId, 'main-002');

    frameCtx.disable();
  });
});

await describe('frame-context: executionContext mapping', async () => {
  await testAsync('executionContextCreated maps frameId to contextId', async () => {
    const frameCtx = await import(FRAME_CTX_SRC);
    const cdp = createMockCDP();
    await frameCtx.enable(cdp, SID);

    cdp.emit('Page.frameNavigated', {
      frame: { id: 'main-003', url: 'https://example.com' },
    }, SID);
    cdp.emit('Runtime.executionContextCreated', {
      context: { id: 42, auxData: { frameId: 'main-003' } },
    }, SID);

    const ecId = frameCtx.getExecutionContextId('main-003');
    assert.equal(ecId, 42);

    frameCtx.disable();
  });

  await testAsync('executionContextDestroyed removes mapping', async () => {
    const frameCtx = await import(FRAME_CTX_SRC);
    const cdp = createMockCDP();
    await frameCtx.enable(cdp, SID);

    cdp.emit('Page.frameNavigated', {
      frame: { id: 'main-004', url: 'https://example.com' },
    }, SID);
    cdp.emit('Runtime.executionContextCreated', {
      context: { id: 99, auxData: { frameId: 'main-004' } },
    }, SID);

    assert.equal(frameCtx.getExecutionContextId('main-004'), 99);

    cdp.emit('Runtime.executionContextDestroyed', {
      executionContextId: 99,
    }, SID);

    assert.equal(frameCtx.getExecutionContextId('main-004'), null);

    frameCtx.disable();
  });
});

await describe('frame-context: select and reset', async () => {
  await testAsync('selectFrame sets selected frame', async () => {
    const frameCtx = await import(FRAME_CTX_SRC);
    const cdp = createMockCDP();
    await frameCtx.enable(cdp, SID);

    cdp.emit('Page.frameNavigated', {
      frame: { id: 'main-005', url: 'https://example.com' },
    }, SID);
    cdp.emit('Page.frameAttached', {
      frameId: 'iframe-005',
      parentFrameId: 'main-005',
    }, SID);

    frameCtx.selectFrame('iframe-005');
    assert.equal(frameCtx.getSelectedFrameId(), 'iframe-005');

    frameCtx.resetFrame();
    assert.equal(frameCtx.getSelectedFrameId(), null);

    frameCtx.disable();
  });

  await testAsync('selectFrame throws for unknown frame', async () => {
    const frameCtx = await import(FRAME_CTX_SRC);
    const cdp = createMockCDP();
    await frameCtx.enable(cdp, SID);

    assert.throws(
      () => frameCtx.selectFrame('nonexistent'),
      /not found/
    );

    frameCtx.disable();
  });

  await testAsync('frameDetached clears selection', async () => {
    const frameCtx = await import(FRAME_CTX_SRC);
    const cdp = createMockCDP();
    await frameCtx.enable(cdp, SID);

    cdp.emit('Page.frameNavigated', {
      frame: { id: 'main-006', url: 'https://example.com' },
    }, SID);
    cdp.emit('Page.frameAttached', {
      frameId: 'iframe-006',
      parentFrameId: 'main-006',
    }, SID);

    frameCtx.selectFrame('iframe-006');
    assert.equal(frameCtx.getSelectedFrameId(), 'iframe-006');

    cdp.emit('Page.frameDetached', {
      frameId: 'iframe-006',
    }, SID);

    assert.equal(frameCtx.getSelectedFrameId(), null);

    frameCtx.disable();
  });
});

await describe('frame-context: updateFromFrameTree', async () => {
  await testAsync('updates frame tree from Page.getFrameTree result', async () => {
    const frameCtx = await import(FRAME_CTX_SRC);
    const cdp = createMockCDP();
    await frameCtx.enable(cdp, SID);

    frameCtx.updateFromFrameTree({
      frameTree: {
        frame: { id: 'main-007', url: 'https://example.com' },
        childFrames: [
          {
            frame: { id: 'iframe-007a', url: 'https://cdn.example.com/a' },
            childFrames: [],
          },
          {
            frame: { id: 'iframe-007b', url: 'https://cdn.example.com/b' },
            childFrames: [],
          },
        ],
      },
    });

    const frames = frameCtx.getFlatFrames();
    assert.equal(frames.length, 3);

    const main = frames.find(f => f.id === 'main-007');
    assert.ok(main);
    assert.deepEqual(main.children, ['iframe-007a', 'iframe-007b']);

    frameCtx.disable();
  });
});

await describe('frame-context: getExecutionContextId with selected frame', async () => {
  await testAsync('returns contextId for selected frame when no frameId given', async () => {
    const frameCtx = await import(FRAME_CTX_SRC);
    const cdp = createMockCDP();
    await frameCtx.enable(cdp, SID);

    cdp.emit('Page.frameNavigated', {
      frame: { id: 'main-008', url: 'https://example.com' },
    }, SID);
    cdp.emit('Runtime.executionContextCreated', {
      context: { id: 55, auxData: { frameId: 'main-008' } },
    }, SID);

    frameCtx.selectFrame('main-008');
    const ecId = frameCtx.getExecutionContextId();
    assert.equal(ecId, 55);

    frameCtx.disable();
  });

  await testAsync('returns null when no frame selected', async () => {
    const frameCtx = await import(FRAME_CTX_SRC);
    const cdp = createMockCDP();
    await frameCtx.enable(cdp, SID);

    const ecId = frameCtx.getExecutionContextId();
    assert.equal(ecId, null);

    frameCtx.disable();
  });
});

await summary();
