const MAX_WS_CONNECTIONS = 100;
const MAX_CLOSED_CONNECTIONS = 50;
const MAX_FRAMES_PER_CONNECTION = 500;

const connectionsByReqId = new Map();
let wsIdCounter = 1;
let cdpRef = null;
let sidRef = null;
let offCreated = null;
let offFrameSent = null;
let offFrameReceived = null;
let offFrameError = null;
let offClosed = null;
let enabled = false;

function classifySize(len) {
  if (len < 50) return 'tiny';
  if (len < 500) return 'small';
  if (len < 5000) return 'medium';
  if (len < 50000) return 'large';
  return 'xlarge';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function enable(cdp, sessionId) {
  if (enabled && cdpRef === cdp && sidRef === sessionId) return;

  if (offCreated) { offCreated(); offCreated = null; }
  if (offFrameSent) { offFrameSent(); offFrameSent = null; }
  if (offFrameReceived) { offFrameReceived(); offFrameReceived = null; }
  if (offFrameError) { offFrameError(); offFrameError = null; }
  if (offClosed) { offClosed(); offClosed = null; }

  cdpRef = cdp;
  sidRef = sessionId;

  offCreated = cdp.onEvent('Network.webSocketCreated', (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    const conn = {
      wsId: wsIdCounter++,
      requestId: params.requestId,
      url: params.url || '',
      status: 'open',
      createdTime: params.timestamp || Date.now(),
      closedTime: null,
      frames: [],
      frameCount: { sent: 0, received: 0 },
      byteCount: { sent: 0, received: 0 },
    };
    connectionsByReqId.set(params.requestId, conn);
    if (connectionsByReqId.size > MAX_WS_CONNECTIONS) {
      const oldest = connectionsByReqId.keys().next().value;
      connectionsByReqId.delete(oldest);
    }
  });

  offFrameSent = cdp.onEvent('Network.webSocketFrameSent', (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    const conn = connectionsByReqId.get(params.requestId);
    if (!conn) return;
    const payload = params.response?.payloadData ?? '';
    conn.frames.push({
      direction: 'sent',
      opcode: params.response?.opcode ?? 1,
      payload,
      length: payload.length,
      timestamp: params.timestamp || Date.now(),
    });
    conn.frameCount.sent++;
    conn.byteCount.sent += payload.length;
    if (conn.frames.length > MAX_FRAMES_PER_CONNECTION) conn.frames.shift();
  });

  offFrameReceived = cdp.onEvent('Network.webSocketFrameReceived', (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    const conn = connectionsByReqId.get(params.requestId);
    if (!conn) return;
    const payload = params.response?.payloadData ?? '';
    conn.frames.push({
      direction: 'received',
      opcode: params.response?.opcode ?? 1,
      payload,
      length: payload.length,
      timestamp: params.timestamp || Date.now(),
    });
    conn.frameCount.received++;
    conn.byteCount.received += payload.length;
    if (conn.frames.length > MAX_FRAMES_PER_CONNECTION) conn.frames.shift();
  });

  offFrameError = cdp.onEvent('Network.webSocketFrameError', (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    const conn = connectionsByReqId.get(params.requestId);
    if (!conn) return;
    conn.status = 'error';
  });

  offClosed = cdp.onEvent('Network.webSocketClosed', (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    const conn = connectionsByReqId.get(params.requestId);
    if (!conn) return;
    conn.status = 'closed';
    conn.closedTime = params.timestamp || Date.now();

    const closedConns = Array.from(connectionsByReqId.values())
      .filter(c => c.status === 'closed')
      .sort((a, b) => (a.closedTime || 0) - (b.closedTime || 0));
    while (closedConns.length > MAX_CLOSED_CONNECTIONS) {
      const oldest = closedConns.shift();
      connectionsByReqId.delete(oldest.requestId);
    }
  });

  enabled = true;
}

function disable() {
  if (offCreated) { offCreated(); offCreated = null; }
  if (offFrameSent) { offFrameSent(); offFrameSent = null; }
  if (offFrameReceived) { offFrameReceived(); offFrameReceived = null; }
  if (offFrameError) { offFrameError(); offFrameError = null; }
  if (offClosed) { offClosed(); offClosed = null; }
  connectionsByReqId.clear();
  wsIdCounter = 1;
  enabled = false;
  cdpRef = null;
  sidRef = null;
}

function isEnabled() { return enabled; }

function getConnections(urlFilter) {
  let conns = Array.from(connectionsByReqId.values());
  if (urlFilter) {
    const lower = urlFilter.toLowerCase();
    conns = conns.filter(c => c.url.toLowerCase().includes(lower));
  }
  return conns;
}

function getConnectionByWsId(wsId) {
  for (const conn of connectionsByReqId.values()) {
    if (conn.wsId === wsId) return conn;
  }
  return null;
}

function getFrames(wsId, options = {}) {
  const conn = getConnectionByWsId(wsId);
  if (!conn) return null;

  let frames = conn.frames;
  if (options.direction === 'sent') {
    frames = frames.filter(f => f.direction === 'sent');
  } else if (options.direction === 'received') {
    frames = frames.filter(f => f.direction === 'received');
  }

  const showContent = options.content || false;
  const maxLen = showContent ? Infinity : 200;

  return {
    wsId: conn.wsId,
    url: conn.url,
    status: conn.status,
    totalFrames: conn.frameCount.sent + conn.frameCount.received,
    frames: frames.map(f => ({
      ...f,
      displayPayload: f.payload.length > maxLen
        ? f.payload.substring(0, maxLen) + '...'
        : f.payload,
    })),
  };
}

function getFrameDetail(wsId, frameIdx) {
  const conn = getConnectionByWsId(wsId);
  if (!conn) return null;
  if (frameIdx < 0 || frameIdx >= conn.frames.length) return null;
  return conn.frames[frameIdx];
}

function analyzeFrames(wsId) {
  const conn = getConnectionByWsId(wsId);
  if (!conn) return null;

  const groups = new Map();
  const groupIdMap = new Map();
  let nextGroupId = 0;
  const GROUP_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  for (const frame of conn.frames) {
    const prefix = frame.payload.substring(0, 4);
    const sizeClass = classifySize(frame.length);
    const key = `${frame.direction}:${prefix}:${sizeClass}`;

    if (!groups.has(key)) {
      const label = GROUP_LABELS[nextGroupId] || `G${nextGroupId}`;
      nextGroupId++;
      groups.set(key, {
        label,
        direction: frame.direction,
        prefix,
        sizeClass,
        frames: [],
        sample: frame.payload.length > 100 ? frame.payload.substring(0, 100) + '...' : frame.payload,
      });
      groupIdMap.set(label, key);
    }
    groups.get(key).frames.push(frame);
  }

  const totalFrames = conn.frames.length;
  const groupList = Array.from(groups.values()).map(g => ({
    label: g.label,
    direction: g.direction,
    prefix: g.prefix,
    sizeClass: g.sizeClass,
    count: g.frames.length,
    percentage: totalFrames > 0 ? Math.round(g.frames.length / totalFrames * 100) : 0,
    sample: g.sample,
    frameIndices: g.frames.map(f => conn.frames.indexOf(f)),
  }));

  return {
    wsId: conn.wsId,
    url: conn.url,
    totalFrames,
    groups: groupList,
  };
}

function getGroupFrames(wsId, groupLabel) {
  const analysis = analyzeFrames(wsId);
  if (!analysis) return null;
  const group = analysis.groups.find(g => g.label === groupLabel);
  if (!group) return null;

  const conn = getConnectionByWsId(wsId);
  return {
    wsId,
    groupLabel,
    direction: group.direction,
    sizeClass: group.sizeClass,
    count: group.count,
    frames: group.frameIndices.map(idx => conn.frames[idx]),
  };
}

function clear() {
  const count = connectionsByReqId.size;
  connectionsByReqId.clear();
  wsIdCounter = 1;
  return count;
}

export {
  enable, disable, isEnabled,
  getConnections, getConnectionByWsId,
  getFrames, getFrameDetail,
  analyzeFrames, getGroupFrames,
  clear, classifySize, formatBytes,
};
