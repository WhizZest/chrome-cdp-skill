import { writeFileSync } from 'fs';
import { registerCommand } from '../lib/command-registry.mjs';
import { WARN_CDP_METHODS, WARN_HINTS } from '../lib/eval-safety.mjs';

export async function evalStr(cdp, sid, expression, contextId = null) {
  await cdp.send('Runtime.enable', {}, sid);
  const params = {
    expression, returnByValue: true, awaitPromise: true,
  };
  if (contextId) {
    params.contextId = contextId;
  }
  const result = await cdp.send('Runtime.evaluate', params, sid);
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
    if (args[i] === '--save') {
      if (i + 1 >= args.length) throw new Error('--save requires a filename. Usage: eval <target> <expr> [--save <file>] [--binary]');
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
  return `(async()=>{const __r=await(${expr});if(__r instanceof ArrayBuffer){const __u8=new Uint8Array(__r);let __b64='';const __chunk=8192;for(let __i=0;__i<__u8.length;__i+=__chunk){__b64+=String.fromCharCode.apply(null,__u8.subarray(__i,__i+__chunk));}return{__cdpBinary:true,b64:btoa(__b64)};}if(ArrayBuffer.isView(__r)){const __u8=new Uint8Array(__r.buffer,__r.byteOffset,__r.byteLength);let __b64='';const __chunk=8192;for(let __i=0;__i<__u8.length;__i+=__chunk){__b64+=String.fromCharCode.apply(null,__u8.subarray(__i,__i+__chunk));}return{__cdpBinary:true,b64:btoa(__b64)};}throw new Error('Expected ArrayBuffer or TypedArray, got '+typeof __r);})()`;
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
  const { expression, saveFile, binary } = parseEvalArgs(args);
  if (!expression) throw new Error('Usage: eval <target> <expr> [--save <file>] [--binary]');

  const contextId = frameCtx?.getExecutionContextId() || null;
  const actualExpr = binary ? wrapBinaryExpr(expression) : expression;
  const result = await evalStr(cdp, sessionId, actualExpr, contextId);

  if (saveFile) {
    let content;
    let byteSize;
    if (binary) {
      let parsed;
      try { parsed = JSON.parse(result); } catch { throw new Error('Failed to parse binary result from page'); }
      if (!parsed.__cdpBinary) throw new Error('Page did not return binary data');
      content = Buffer.from(parsed.b64, 'base64');
      byteSize = content.length;
    } else {
      content = result;
      byteSize = Buffer.byteLength(content, 'utf8');
    }
    try {
      writeFileSync(saveFile, content);
    } catch (e) {
      return `Failed to save to ${saveFile}: ${e.message}`;
    }
    return `Saved to ${saveFile} (${byteSize} bytes)`;
  }

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
