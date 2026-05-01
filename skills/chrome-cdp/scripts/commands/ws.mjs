import { registerCommand } from '../lib/command-registry.mjs';
import * as wsCtx from '../lib/websocket-context.mjs';

function formatConnectionList(conns) {
  if (conns.length === 0) return 'No WebSocket connections.';

  const lines = [`WebSocket connections (${conns.length} total):`];
  for (const conn of conns) {
    const status = conn.status.padEnd(6);
    const totalBytes = conn.byteCount.sent + conn.byteCount.received;
    lines.push(`  [${conn.wsId}] ${conn.url}  ${status}  sent: ${conn.frameCount.sent}  recv: ${conn.frameCount.received}  total: ${wsCtx.formatBytes(totalBytes)}`);
  }
  lines.push('Use "ws <wsid>" to view messages.');
  return lines.join('\n');
}

function formatFrameList(data, showContent) {
  if (!data) return 'WebSocket connection not found.';
  if (data.frames.length === 0) return `WebSocket [${data.wsId}] ${data.url} (${data.status}): no frames yet.`;

  const lines = [`WebSocket [${data.wsId}] ${data.url} (${data.status}, ${data.totalFrames} frames, showing ${data.frames.length}):`];
  for (let i = 0; i < data.frames.length; i++) {
    const f = data.frames[i];
    const arrow = f.direction === 'sent' ? '→' : '←';
    const payload = showContent ? f.payload : f.displayPayload;
    const sizeStr = wsCtx.formatBytes(f.length);
    lines.push(`  #${i}  ${arrow}  ${payload}  ${sizeStr}`);
  }
  lines.push('Use "ws <wsid> --frame <idx>" for details, "--analyze" for pattern analysis.');
  return lines.join('\n');
}

function formatFrameDetail(frame, idx) {
  if (!frame) return 'Frame not found.';
  const arrow = frame.direction === 'sent' ? '→ Sent' : '← Received';
  const lines = [`Frame #${idx} ${arrow}`];
  lines.push(`  Opcode: ${frame.opcode}`);
  lines.push(`  Length: ${frame.length} bytes`);
  lines.push(`  Timestamp: ${frame.timestamp}`);
  lines.push(`  Payload:`);
  lines.push(frame.payload.length > 5000
    ? frame.payload.substring(0, 5000) + `... (${frame.payload.length} chars total)`
    : frame.payload);
  return lines.join('\n');
}

function formatAnalysis(analysis) {
  if (!analysis) return 'WebSocket connection not found.';
  if (analysis.groups.length === 0) return `WebSocket [${analysis.wsId}]: no frames to analyze.`;

  const lines = [`WebSocket [${analysis.wsId}] Pattern Analysis (${analysis.totalFrames} frames, ${analysis.groups.length} patterns):\n`];

  for (const g of analysis.groups) {
    const arrow = g.direction === 'sent' ? '→' : '←';
    lines.push(`  Pattern ${g.label} (${g.count} frames, ${g.percentage}%): ${arrow} ${g.sizeClass}, prefix "${g.prefix}"`);
    lines.push(`    Sample: ${g.sample}`);
    lines.push('');
  }

  lines.push('Use "ws <wsid> --group <label>" to see all frames in a pattern.');
  return lines.join('\n');
}

function formatGroupFrames(data) {
  if (!data) return 'Pattern not found.';

  const arrow = data.direction === 'sent' ? '→' : '←';
  const lines = [`Pattern ${data.groupLabel} (${data.count} frames, ${arrow} ${data.sizeClass}):\n`];

  for (const f of data.frames) {
    const fArrow = f.direction === 'sent' ? '→' : '←';
    lines.push(`  ${fArrow} ${f.payload.length > 200 ? f.payload.substring(0, 200) + '...' : f.payload}  ${wsCtx.formatBytes(f.length)}`);
  }
  return lines.join('\n');
}

async function handleWs({ cdp, sessionId, args }) {
  await wsCtx.enable(cdp, sessionId);

  const first = args[0];

  if (first === 'clear') {
    const count = wsCtx.clear();
    return `Cleared ${count} WebSocket connections`;
  }

  if (!first || first.startsWith('--')) {
    const urlFilterIdx = args.indexOf('--url-filter');
    const urlFilter = urlFilterIdx >= 0 ? args[urlFilterIdx + 1] : null;
    const conns = wsCtx.getConnections(urlFilter);
    return formatConnectionList(conns);
  }

  const wsId = parseInt(first);
  if (isNaN(wsId)) {
    const urlFilterIdx = args.indexOf('--url-filter');
    const urlFilter = urlFilterIdx >= 0 ? args[urlFilterIdx + 1] : first;
    const conns = wsCtx.getConnections(urlFilter);
    return formatConnectionList(conns);
  }

  const rest = args.slice(1);
  const showContent = rest.includes('--content');
  const direction = rest.includes('--sent') ? 'sent' : rest.includes('--received') ? 'received' : null;

  const analyzeIdx = rest.indexOf('--analyze');
  if (analyzeIdx >= 0) {
    return formatAnalysis(wsCtx.analyzeFrames(wsId));
  }

  const groupIdx = rest.indexOf('--group');
  if (groupIdx >= 0 && rest[groupIdx + 1]) {
    return formatGroupFrames(wsCtx.getGroupFrames(wsId, rest[groupIdx + 1]));
  }

  const frameIdx = rest.indexOf('--frame');
  if (frameIdx >= 0 && rest[frameIdx + 1]) {
    const idx = parseInt(rest[frameIdx + 1]);
    const frame = wsCtx.getFrameDetail(wsId, idx);
    return formatFrameDetail(frame, idx);
  }

  const data = wsCtx.getFrames(wsId, { direction, content: showContent });
  return formatFrameList(data, showContent);
}

registerCommand('ws', handleWs);
registerCommand('websocket', handleWs);

export { handleWs, formatConnectionList, formatFrameList, formatFrameDetail, formatAnalysis, formatGroupFrames };
