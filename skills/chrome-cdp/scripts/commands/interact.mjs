import { registerCommand } from '../lib/command-registry.mjs';
import { KEY_MAP } from '../lib/constants.mjs';
import { sleep } from '../lib/utils.mjs';
import { evalStr } from './eval.mjs';

async function clickStr(cdp, sid, selector) {
  if (!selector) throw new Error('CSS selector required');
  const expr = `
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, error: 'Element not found: ' + ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { ok: true, tag: el.tagName, text: el.textContent.trim().substring(0, 80) };
    })()
  `;
  const result = await evalStr(cdp, sid, expr);
  const r = JSON.parse(result);
  if (!r.ok) throw new Error(r.error);
  return `Clicked <${r.tag}> "${r.text}"`;
}

async function clickXyStr(cdp, sid, x, y) {
  const cx = parseFloat(x);
  const cy = parseFloat(y);
  if (isNaN(cx) || isNaN(cy)) throw new Error('x and y must be numbers (CSS pixels)');
  const base = { x: cx, y: cy, button: 'left', clickCount: 1, modifiers: 0 };
  await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved' }, sid);
  await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' }, sid);
  await sleep(50);
  await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' }, sid);
  return `Clicked at CSS (${cx}, ${cy})`;
}

async function typeStr(cdp, sid, text) {
  if (text == null || text === '') throw new Error('text required');
  await cdp.send('Input.insertText', { text }, sid);
  return `Typed ${text.length} characters`;
}

async function keypressStr(cdp, sid, keyName) {
  if (!keyName) throw new Error('key name required (e.g. ArrowRight, Enter, F5)');
  let keyDef;
  if (KEY_MAP[keyName]) {
    keyDef = KEY_MAP[keyName];
  } else if (keyName.length === 1) {
    const upper = keyName.toUpperCase();
    const vk = upper.charCodeAt(0);
    let code;
    if (/[0-9]/.test(keyName)) {
      code = `Digit${keyName}`;
    } else if (/[a-zA-Z]/.test(keyName)) {
      code = `Key${upper}`;
    } else {
      throw new Error(`Unsupported single character: "${keyName}". Only a-z and 0-9 are supported.`);
    }
    keyDef = { key: keyName, code, keyCode: vk, windowsVirtualKeyCode: vk };
  } else {
    throw new Error(`Unknown key: "${keyName}". Supported: ${Object.keys(KEY_MAP).join(', ')}, or single characters like a-z, 0-9`);
  }
  const downParams = { type: 'keyDown', ...keyDef, modifiers: 0 };
  const upParams = { type: 'keyUp', ...keyDef, modifiers: 0 };
  await cdp.send('Input.dispatchKeyEvent', downParams, sid);
  await sleep(30);
  await cdp.send('Input.dispatchKeyEvent', upParams, sid);
  return `Pressed ${keyName}`;
}

async function loadAllStr(cdp, sid, selector, intervalMs = 1500) {
  if (!selector) throw new Error('CSS selector required');
  let clicks = 0;
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const exists = await evalStr(cdp, sid,
      `!!document.querySelector(${JSON.stringify(selector)})`
    );
    if (exists !== 'true') break;
    const clickExpr = `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      })()
    `;
    const clicked = await evalStr(cdp, sid, clickExpr);
    if (clicked !== 'true') break;
    clicks++;
    await sleep(intervalMs);
  }
  return `Clicked "${selector}" ${clicks} time(s) until it disappeared`;
}

registerCommand('click', async ({ cdp, sessionId, args }) => clickStr(cdp, sessionId, args[0]));
registerCommand('clickxy', async ({ cdp, sessionId, args }) => clickXyStr(cdp, sessionId, args[0], args[1]));
registerCommand('type', async ({ cdp, sessionId, args }) => typeStr(cdp, sessionId, args[0]));
registerCommand('keypress', async ({ cdp, sessionId, args }) => keypressStr(cdp, sessionId, args[0]));
registerCommand('loadall', async ({ cdp, sessionId, args }) => loadAllStr(cdp, sessionId, args[0], args[1] ? parseInt(args[1]) : 1500));
