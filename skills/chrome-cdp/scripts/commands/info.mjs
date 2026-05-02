import { registerCommand } from '../lib/command-registry.mjs';
import { evalStr } from './eval.mjs';

async function handleInfo({ cdp, sessionId, args, frameCtx }) {
  const [title, url, dpr, frames] = await Promise.all([
    evalStr(cdp, sessionId, 'document.title').catch(() => 'N/A'),
    evalStr(cdp, sessionId, 'location.href').catch(() => 'N/A'),
    evalStr(cdp, sessionId, 'window.devicePixelRatio').catch(() => '1'),
    Promise.resolve(frameCtx ? frameCtx.getFlatFrames() : []),
  ]);

  const lines = [
    `URL:   ${url}`,
    `Title: ${title}`,
    `DPR:   ${dpr}`,
    `Frames:${frames.length > 1 ? ` ${frames.length} (use "frames" to list)` : ' 1 (main only)'}`,
  ];
  return lines.join('\n');
}

registerCommand('info', handleInfo);

export { handleInfo };
