import { registerCommand } from '../lib/command-registry.mjs';
import { WARN_CDP_METHODS, WARN_HINTS } from '../lib/eval-safety.mjs';
import * as dbgCtx from '../lib/debugger-context.mjs';
import { parseEvalArgs, wrapBinaryExpr, handleSaveResult } from '../lib/eval-utils.mjs';

export { parseEvalArgs, wrapBinaryExpr, handleSaveResult } from '../lib/eval-utils.mjs';

export async function evalStr(cdp, sid, expression, contextId = null, awaitPromise = false) {
  await cdp.send('Runtime.enable', {}, sid);
  const params = {
    expression, returnByValue: true, awaitPromise,
  };
  if (contextId) {
    params.contextId = contextId;
  }
  const result = await cdp.send('Runtime.evaluate', params, sid);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description);
  }
  const val = result.result.value;
  return typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val ?? 'undefined');
}

async function evalRawStr(cdp, sid, method, paramsJson) {
  if (!method) throw new Error('CDP method required (e.g. "DOM.getDocument")');
  let params = {};
  if (paramsJson) {
    try { params = JSON.parse(paramsJson); }
    catch { throw new Error(`Invalid JSON params: ${paramsJson}`); }
  }
  if (method === 'Target.detachFromTarget' && params.sessionId === sid) {
    throw new Error('Blocked: detaching the daemon\'s own session would kill it. Use "stop" command instead.');
  }
  const warn = WARN_CDP_METHODS.has(method);
  const result = await cdp.send(method, params, sid);
  const output = JSON.stringify(result, null, 2);
  if (!warn) return output;
  return `⚠ Warning: ${method} may desynchronize daemon state. ${WARN_HINTS[method] || 'Use "debug reset" to recover if needed.'}\n\n${output}`;
}

registerCommand('eval', async ({ cdp, sessionId, args, frameCtx }) => {
  const { expression, saveFile, binary, frameIdx } = parseEvalArgs(args);
  if (!expression) throw new Error('Usage: eval <target> <expr> [--save <file>] [--binary] [--frame <N>]');

  if (dbgCtx.isEnabled() && dbgCtx.isPaused()) {
    if (binary) {
      throw new Error('--binary is not supported while paused. Resume execution first, or use eval without --binary.');
    }

    const state = dbgCtx.getPausedState();
    const idx = frameIdx ?? 0;
    if (idx < 0 || idx >= state.callFrames.length) {
      throw new Error(`frameIndex ${idx} out of range (0-${state.callFrames.length - 1})`);
    }

    const callFrameId = state.callFrames[idx].callFrameId;
    const pausedResult = await dbgCtx.evaluateOnCallFrame(callFrameId, expression);

    if (pausedResult.exceptionDetails) {
      throw new Error(pausedResult.exceptionDetails.text || pausedResult.exceptionDetails.exception?.description);
    }

    const val = pausedResult.result.value;
    const output = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val ?? 'undefined');

    if (saveFile) return handleSaveResult(output, saveFile, false);
    return output;
  }

  const contextId = frameCtx?.getExecutionContextId() || null;
  const actualExpr = binary ? wrapBinaryExpr(expression) : expression;
  const result = await evalStr(cdp, sessionId, actualExpr, contextId, true);

  if (saveFile) return handleSaveResult(result, saveFile, binary);

  if (binary) {
    let parsed;
    try { parsed = JSON.parse(result); } catch { throw new Error('Failed to parse binary result from page'); }
    if (!parsed.__cdpBinary) throw new Error('Page did not return binary data');
    return `Base64 (${parsed.b64.length} chars):\n${parsed.b64}`;
  }

  return result;
});

registerCommand('evalraw', async ({ cdp, sessionId, args }) => {
  return evalRawStr(cdp, sessionId, args[0], args[1]);
});
