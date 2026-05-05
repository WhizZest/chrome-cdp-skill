import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
import { execFileSync } from 'child_process';
import { TIMEOUT, IS_WINDOWS } from './constants.mjs';
import { getDisplayPrefixLength } from './utils.mjs';

function isWsl() {
  try {
    const version = readFileSync('/proc/version', 'utf8').toLowerCase();
    return version.includes('microsoft') || version.includes('wsl');
  } catch {
    return false;
  }
}

function getWslLocalAppData() {
  const winPathOf = (varExpr) => {
    try {
      return execFileSync('cmd.exe', ['/C', `echo ${varExpr}`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r?\n$/, '');
    } catch { return null; }
  };
  try {
    const winPath = winPathOf('%LOCALAPPDATA%') || `${winPathOf('%USERPROFILE%')}\\AppData\\Local`;
    if (!winPath) return null;
    return execFileSync('wslpath', ['-u', winPath], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function getWsUrl() {
  const home = homedir();
  const wsl = isWsl();
  const wslLocalAppData = wsl ? getWslLocalAppData() : null;

  const macBrowsers = [
    'Google/Chrome', 'Google/Chrome Beta', 'Google/Chrome for Testing',
    'Chromium', 'BraveSoftware/Brave-Browser', 'Microsoft Edge',
  ];
  const linuxBrowsers = [
    'google-chrome', 'google-chrome-beta', 'chromium',
    'vivaldi', 'vivaldi-snapshot',
    'BraveSoftware/Brave-Browser', 'microsoft-edge',
  ];
  const flatpakBrowsers = [
    ['org.chromium.Chromium', 'chromium'],
    ['com.google.Chrome', 'google-chrome'],
    ['com.brave.Browser', 'BraveSoftware/Brave-Browser'],
    ['com.microsoft.Edge', 'microsoft-edge'],
    ['com.vivaldi.Vivaldi', 'vivaldi'],
  ];
  const windowsBrowsers = [
    'Google/Chrome',
    'Google/Chrome Beta',
    'Chromium',
    'BraveSoftware/Brave-Browser',
    'Microsoft/Edge',
  ];

  const candidates = [
    process.env.CDP_PORT_FILE,
    ...macBrowsers.flatMap(b => [
      resolve(home, 'Library/Application Support', b, 'DevToolsActivePort'),
      resolve(home, 'Library/Application Support', b, 'Default/DevToolsActivePort'),
    ]),
    ...linuxBrowsers.flatMap(b => [
      resolve(home, '.config', b, 'DevToolsActivePort'),
      resolve(home, '.config', b, 'Default/DevToolsActivePort'),
    ]),
    ...flatpakBrowsers.flatMap(([appId, name]) => [
      resolve(home, '.var/app', appId, 'config', name, 'DevToolsActivePort'),
      resolve(home, '.var/app', appId, 'config', name, 'Default/DevToolsActivePort'),
    ]),
    ...(IS_WINDOWS ? windowsBrowsers.flatMap(b => {
      const base = process.env.LOCALAPPDATA || resolve(home, 'AppData/Local');
      return [
        resolve(base, b, 'User Data/DevToolsActivePort'),
        resolve(base, b, 'User Data/Default/DevToolsActivePort'),
      ];
    }) : []),
    ...(wsl && wslLocalAppData ? windowsBrowsers.flatMap(b => [
      resolve(wslLocalAppData, b, 'User Data/DevToolsActivePort'),
      resolve(wslLocalAppData, b, 'User Data/Default/DevToolsActivePort'),
    ]) : []),
  ].filter(Boolean);

  const portFile = candidates.find(p => existsSync(p));
  if (!portFile) throw new Error('No DevToolsActivePort found. Enable remote debugging at chrome://inspect/#remote-debugging');

  const lines = readFileSync(portFile, 'utf8').trim().split('\n');
  if (lines.length < 2 || !lines[0] || !lines[1]) throw new Error(`Invalid DevToolsActivePort file: ${portFile}`);
  const host = process.env.CDP_HOST || '127.0.0.1';
  return `ws://${host}:${lines[0]}${lines[1]}`;
}

export class CDP {
  #ws; #id = 0; #pending = new Map(); #eventHandlers = new Map(); #closeHandlers = [];

  async connect(wsUrl) {
    return new Promise((res, rej) => {
      this.#ws = new WebSocket(wsUrl);
      this.#ws.onopen = () => res();
      this.#ws.onerror = (e) => rej(new Error('WebSocket error: ' + (e.message || e.type)));
      this.#ws.onclose = () => this.#closeHandlers.forEach(h => h());
      this.#ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.#pending.has(msg.id)) {
          const { resolve, reject } = this.#pending.get(msg.id);
          this.#pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        } else if (msg.method && this.#eventHandlers.has(msg.method)) {
          for (const handler of [...this.#eventHandlers.get(msg.method)]) {
            handler(msg.params || {}, msg);
          }
        }
      };
    });
  }

  send(method, params = {}, sessionId, timeout = TIMEOUT) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.#ws.send(JSON.stringify(msg));
      setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, timeout);
    });
  }

  onEvent(method, handler) {
    if (!this.#eventHandlers.has(method)) this.#eventHandlers.set(method, new Set());
    const handlers = this.#eventHandlers.get(method);
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.#eventHandlers.delete(method);
    };
  }

  waitForEvent(method, timeout = TIMEOUT) {
    let settled = false;
    let off;
    let timer;
    const promise = new Promise((resolve, reject) => {
      off = this.onEvent(method, (params) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off();
        resolve(params);
      });
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        off();
        reject(new Error(`Timeout waiting for event: ${method}`));
      }, timeout);
    });
    return {
      promise,
      cancel() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off?.();
      },
    };
  }

  onClose(handler) { this.#closeHandlers.push(handler); }
  close() { this.#ws.close(); }
}

export async function getPages(cdp) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  return targetInfos.filter(t => t.type === 'page' && !t.url.startsWith('chrome://'));
}

export function formatPageList(pages) {
  const prefixLen = getDisplayPrefixLength(pages.map(p => p.targetId));
  return pages.map(p => {
    const id = p.targetId.slice(0, prefixLen).padEnd(prefixLen);
    const title = p.title.substring(0, 54).padEnd(54);
    return `${id}  ${title}  ${p.url}`;
  }).join('\n');
}
