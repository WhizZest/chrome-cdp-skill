import { registerCommand } from '../lib/command-registry.mjs';
import * as frameCtx from '../lib/frame-context.mjs';

function formatFrameTree(frames, selectedId, depth = 0) {
  const lines = [];
  const roots = frames.filter(f => !f.parentId);

  function visit(frame, d) {
    const indent = '  '.repeat(d);
    const marker = frame.id === selectedId ? ' ← selected' : '';
    const idx = frames.indexOf(frame);
    lines.push(`${indent}${idx}. [${frame.id.slice(0, 8)}] ${frame.url || '(no url)'}${marker}`);
    for (const childId of frame.children) {
      const child = frames.find(f => f.id === childId);
      if (child) visit(child, d + 1);
    }
  }

  for (const root of roots) visit(root, depth);
  return lines;
}

async function handleFrames({ cdp, sessionId, args }) {
  await frameCtx.enable(cdp, sessionId);

  const sub = args[0];

  if (sub === 'select') {
    const idx = parseInt(args[1]);
    const frames = frameCtx.getFlatFrames();
    if (isNaN(idx) || idx < 0 || idx >= frames.length) {
      throw new Error(`Invalid index. Use 'frames' to list available frames (0-${frames.length - 1})`);
    }
    frameCtx.selectFrame(frames[idx].id);
    return `Selected frame: [${frames[idx].id.slice(0, 8)}] ${frames[idx].url}`;
  }

  if (sub === 'reset') {
    frameCtx.resetFrame();
    return 'Frame selection reset to main frame.';
  }

  await cdp.send('Page.enable', {}, sessionId);
  const treeResult = await cdp.send('Page.getFrameTree', {}, sessionId);
  frameCtx.updateFromFrameTree(treeResult);

  const frames = frameCtx.getFlatFrames();
  const selectedId = frameCtx.getSelectedFrameId();

  if (frames.length === 0) return 'No frames found.';

  const lines = [`Frames (${frames.length}):`];
  lines.push(...formatFrameTree(frames, selectedId));

  const ctxInfo = [];
  for (const f of frames) {
    const ecId = frameCtx.getExecutionContextId(f.id);
    if (ecId) ctxInfo.push(`  Frame [${f.id.slice(0, 8)}] → executionContext #${ecId}`);
  }

  if (ctxInfo.length > 0) {
    lines.push('\nExecution contexts:');
    lines.push(...ctxInfo);
  }

  lines.push('\nUsage:');
  lines.push('  frames <target> select <idx>  — Select frame for eval');
  lines.push('  frames <target> reset         — Reset to main frame');
  lines.push('  eval <target> <expr>          — Eval in selected frame (if any)');

  return lines.join('\n');
}

registerCommand('frames', handleFrames);
