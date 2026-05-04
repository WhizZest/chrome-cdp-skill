import { writeFileSync } from 'fs';

export function parseEvalArgs(args) {
  let expression = null;
  let saveFile = null;
  let binary = false;
  let frameIdx = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--save') {
      if (i + 1 >= args.length) throw new Error('--save requires a filename. Usage: eval <target> <expr> [--save <file>] [--binary] [--frame <N>]');
      saveFile = args[++i];
    } else if (args[i] === '--binary') {
      binary = true;
    } else if (args[i] === '--frame') {
      if (i + 1 >= args.length) throw new Error('--frame requires a frame index');
      frameIdx = parseInt(args[++i], 10);
      if (isNaN(frameIdx) || frameIdx < 0) throw new Error('--frame must be a non-negative integer');
    } else if (!expression) {
      expression = args[i];
    }
  }
  return { expression, saveFile, binary, frameIdx };
}

export function wrapBinaryExpr(expr) {
  return `(async()=>{const __r=await(${expr});if(__r instanceof ArrayBuffer){const __u8=new Uint8Array(__r);let __b64='';const __chunk=8192;for(let __i=0;__i<__u8.length;__i+=__chunk){__b64+=String.fromCharCode.apply(null,__u8.subarray(__i,__i+__chunk));}return{__cdpBinary:true,b64:btoa(__b64)};}if(ArrayBuffer.isView(__r)){const __u8=new Uint8Array(__r.buffer,__r.byteOffset,__r.byteLength);let __b64='';const __chunk=8192;for(let __i=0;__i<__u8.length;__i+=__chunk){__b64+=String.fromCharCode.apply(null,__u8.subarray(__i,__i+__chunk));}return{__cdpBinary:true,b64:btoa(__b64)};}throw new Error('Expected ArrayBuffer or TypedArray, got '+typeof __r);})()`;
}

export function handleSaveResult(result, saveFile, binary) {
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
    throw new Error(`Failed to save to ${saveFile}: ${e.message}`);
  }
  return `Saved to ${saveFile} (${byteSize} bytes)`;
}
