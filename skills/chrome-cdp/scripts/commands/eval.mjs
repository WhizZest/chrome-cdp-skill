import { writeFileSync } from 'fs';
import { registerCommand } from '../lib/command-registry.mjs';
import { WARN_CDP_METHODS, WARN_HINTS } from '../lib/eval-safety.mjs';

export async function evalStr(cdp, sid, expression) {
  await cdp.send('Runtime.enable', {}, sid);
  const result = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sid);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description);
  }
  const val = result.result.value;
  return typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val ?? '');
}

export function parseEvalArgs(args) {
  let expression = null;
  let saveFile = null;
  let binary = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--save' && i + 1 < args.length) {
      saveFile = args[++i];
    } else if (args[i] === '--binary') {
      binary = true;
    } else if (!expression) {
      expression = args[i];
    }
  }
  return { expression, saveFile, binary };
}

export function wrapBinaryExpr(expr) {
  return `(async()=>{const __r=await(${expr});if(__r instanceof ArrayBuffer||ArrayBuffer.isView(__r)){const __u8=new Uint8Array(__r instanceof ArrayBuffer?__r:__r.buffer);let __b64='';const __chunk=8192;for(let __i=0;__i<__u8.length;__i+=__chunk){__b64+=String.fromCharCode.apply(null,__u8.subarray(__i,__i+__chunk));}return btoa(__b64);}return __r;})()`;
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

registerCommand('eval', async ({ cdp, sessionId, args }) => {
  const { expression, saveFile, binary } = parseEvalArgs(args);
  if (!expression) throw new Error('Usage: eval <target> <expr> [--save <file>] [--binary]');

  const actualExpr = binary ? wrapBinaryExpr(expression) : expression;
  const result = await evalStr(cdp, sessionId, actualExpr);

  if (saveFile) {
    let content;
    if (binary) {
      const b64 = result.replace(/^"|"$/g, '');
      content = Buffer.from(b64, 'base64');
    } else {
      content = result;
    }
    writeFileSync(saveFile, content);
    const size = typeof content === 'string' ? content.length : content.length;
    return `Saved to ${saveFile} (${size} bytes)`;
  }

  if (binary) {
    return `Base64 (${result.length} chars):\n${result}`;
  }

  return result;
});

registerCommand('evalraw', async ({ cdp, sessionId, args }) => {
  return evalRawStr(cdp, sessionId, args[0], args[1]);
});
