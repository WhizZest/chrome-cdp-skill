let selectedFrameId = null;
const frameTree = new Map();
const frameExecutionContexts = new Map();
let cdpRef = null;
let sidRef = null;
let offFrameNavigated = null;
let offFrameAttached = null;
let offFrameDetached = null;
let offCtxCreated = null;
let offCtxDestroyed = null;
let enabled = false;

function onFrameNavigated(params) {
  const frame = params.frame;
  if (!frame) return;
  const existing = frameTree.get(frame.id);
  frameTree.set(frame.id, {
    id: frame.id,
    url: frame.url || '',
    parentId: frame.parentId || null,
    children: existing?.children || [],
  });
  if (frame.parentId && frameTree.has(frame.parentId)) {
    const parent = frameTree.get(frame.parentId);
    if (!parent.children.includes(frame.id)) {
      parent.children.push(frame.id);
    }
  }
}

function onFrameAttached(params) {
  frameTree.set(params.frameId, {
    id: params.frameId,
    url: '',
    parentId: params.parentFrameId || null,
    children: [],
  });
  if (params.parentFrameId && frameTree.has(params.parentFrameId)) {
    const parent = frameTree.get(params.parentFrameId);
    if (!parent.children.includes(params.frameId)) {
      parent.children.push(params.frameId);
    }
  }
}

function onFrameDetached(params) {
  const frameId = params.frameId;
  const frame = frameTree.get(frameId);
  if (frame?.parentId && frameTree.has(frame.parentId)) {
    const parent = frameTree.get(frame.parentId);
    parent.children = parent.children.filter(id => id !== frameId);
  }
  frameTree.delete(frameId);
  frameExecutionContexts.delete(frameId);
  if (selectedFrameId === frameId) selectedFrameId = null;
}

function onExecutionContextCreated(params) {
  const ctx = params.context;
  if (ctx?.auxData?.frameId) {
    frameExecutionContexts.set(ctx.auxData.frameId, ctx.id);
  }
}

function onExecutionContextDestroyed(params) {
  const ctxId = params.executionContextId;
  for (const [frameId, ecId] of frameExecutionContexts) {
    if (ecId === ctxId) {
      frameExecutionContexts.delete(frameId);
      break;
    }
  }
}

async function enable(cdp, sessionId) {
  if (enabled && cdpRef === cdp && sidRef === sessionId) return;

  if (offFrameNavigated) { offFrameNavigated(); offFrameNavigated = null; }
  if (offFrameAttached) { offFrameAttached(); offFrameAttached = null; }
  if (offFrameDetached) { offFrameDetached(); offFrameDetached = null; }
  if (offCtxCreated) { offCtxCreated(); offCtxCreated = null; }
  if (offCtxDestroyed) { offCtxDestroyed(); offCtxDestroyed = null; }

  cdpRef = cdp;
  sidRef = sessionId;

  offFrameNavigated = cdp.onEvent('Page.frameNavigated', (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    onFrameNavigated(params);
  });
  offFrameAttached = cdp.onEvent('Page.frameAttached', (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    onFrameAttached(params);
  });
  offFrameDetached = cdp.onEvent('Page.frameDetached', (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    onFrameDetached(params);
  });
  offCtxCreated = cdp.onEvent('Runtime.executionContextCreated', (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    onExecutionContextCreated(params);
  });
  offCtxDestroyed = cdp.onEvent('Runtime.executionContextDestroyed', (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    onExecutionContextDestroyed(params);
  });

  enabled = true;
}

function disable() {
  if (offFrameNavigated) { offFrameNavigated(); offFrameNavigated = null; }
  if (offFrameAttached) { offFrameAttached(); offFrameAttached = null; }
  if (offFrameDetached) { offFrameDetached(); offFrameDetached = null; }
  if (offCtxCreated) { offCtxCreated(); offCtxCreated = null; }
  if (offCtxDestroyed) { offCtxDestroyed(); offCtxDestroyed = null; }
  clear();
  enabled = false;
  cdpRef = null;
  sidRef = null;
}

function isEnabled() { return enabled; }

function clear() {
  selectedFrameId = null;
  frameTree.clear();
  frameExecutionContexts.clear();
}

function getFlatFrames() {
  return [...frameTree.values()];
}

function getRootFrames() {
  return [...frameTree.values()].filter(f => !f.parentId);
}

function selectFrame(frameId) {
  if (!frameTree.has(frameId)) throw new Error(`Frame ${frameId} not found`);
  selectedFrameId = frameId;
}

function resetFrame() {
  selectedFrameId = null;
}

function getSelectedFrameId() {
  return selectedFrameId;
}

function getExecutionContextId(frameId) {
  const id = frameId || selectedFrameId;
  if (!id) return null;
  return frameExecutionContexts.get(id) ?? null;
}

function updateFromFrameTree(treeResult) {
  function collectFrames(node, parentId = null) {
    const frame = {
      id: node.frame.id,
      url: node.frame.url || '',
      parentId,
      children: (node.childFrames || []).map(c => c.frame.id),
    };
    frameTree.set(frame.id, frame);
    for (const child of node.childFrames || []) {
      collectFrames(child, node.frame.id);
    }
  }
  if (treeResult?.frameTree) {
    collectFrames(treeResult.frameTree);
  }
}

export {
  enable, disable, isEnabled, clear,
  getFlatFrames, getRootFrames,
  selectFrame, resetFrame, getSelectedFrameId,
  getExecutionContextId,
  updateFromFrameTree,
};
