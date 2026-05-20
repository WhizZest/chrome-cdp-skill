import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { resolve, dirname } from 'path';
import { execFileSync, spawn } from 'child_process';
import { TIMEOUT, IS_WINDOWS, RUNTIME_DIR, BROWSERS, LAST_BROWSER_FILE } from './constants.mjs';
import { getDisplayPrefixLength, sleep } from './utils.mjs';

let launching = false;

function launchChrome(port, profileDir, executable) {
  if (launching) return;
  launching = true;
  if (IS_WINDOWS) {
    spawn(executable, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--window-size=1280,720',
      'about:blank',
    ], {
      detached: true,
      stdio: 'ignore',
    });
  } else if (process.platform === 'darwin') {
    spawn('open', ['-a', executable, '--args',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--window-size=1280,720',
      'about:blank',
    ], {
      detached: true,
      stdio: 'ignore',
    });
  } else {
    spawn(executable, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--window-size=1280,720',
      'about:blank',
    ], {
      detached: true,
      stdio: 'ignore',
    });
  }
}

// TODO: WSL support is legacy — remove isWsl() and getWslLocalAppData() when CDP_PORT_FILE fallback is retired
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

function getWsUrlFromPortFile() {
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

export function pickBrowser(browserId) {
  if (browserId) {
    const browser = BROWSERS.find(b => b.id === browserId);
    if (!browser) {
      throw new Error(`Unknown browser: ${browserId}. Available: ${BROWSERS.map(b => b.id).join(', ')}`);
    }
    const executable = browser.executables.find(e => existsSync(e));
    if (!executable) {
      throw new Error(`${browser.name} executable not found. Tried:\n  ${browser.executables.join('\n  ')}`);
    }
    return { ...browser, executable };
  }

  const lastUsed = loadLastBrowser();
  if (lastUsed) {
    const browser = BROWSERS.find(b => b.id === lastUsed);
    if (browser) {
      const executable = browser.executables.find(e => existsSync(e));
      if (executable) return { ...browser, executable };
    }
  }

  for (const browser of BROWSERS) {
    const executable = browser.executables.find(e => existsSync(e));
    if (executable) {
      saveLastBrowser(browser.id);
      return { ...browser, executable };
    }
  }

  throw new Error(`No browser found. Tried:\n${BROWSERS.flatMap(b => b.executables).map(p => `  ${p}`).join('\n')}`);
}

export function saveLastBrowser(browserId) {
  try {
    mkdirSync(dirname(LAST_BROWSER_FILE), { recursive: true });
    writeFileSync(LAST_BROWSER_FILE, JSON.stringify({ browser: browserId }), { mode: 0o600 });
  } catch {}
}

export function loadLastBrowser() {
  try {
    if (!existsSync(LAST_BROWSER_FILE)) return null;
    const data = JSON.parse(readFileSync(LAST_BROWSER_FILE, 'utf8'));
    return data.browser || null;
  } catch {
    return null;
  }
}

export async function getWsUrl(browserId) {
  // NB: daemon assumes last-browser.json has been written by list/open.
  // If daemon is ever called first, it falls back to default priority.
  if (process.env.CDP_PORT_FILE) {
    return getWsUrlFromPortFile();
  }

  // If browserId is explicitly provided, block auto-fallback.
  // If not provided, auto-select from last-browser.json or priority order.
  const port = parseInt(process.env.CDP_PORT, 10) || 9222;
  const versionUrl = `http://127.0.0.1:${port}/json/version`;

  try {
    const res = await fetch(versionUrl);
    const data = await res.json();
    if (browserId) {
      const runningBrowser = (data.Browser || '').toLowerCase();
      const expected = browserId === 'edge' ? 'edg' : browserId;
      if (!runningBrowser.includes(expected)) {
        const error = new Error(
          `Port ${port} is occupied by ${data.Browser || 'another browser'}, not the requested browser (${browserId}). ` +
          `Close it first or use 'cdp list' without --browser.`
        );
        error.name = 'BrowserMismatchError';
        throw error;
      }
    }
    return data.webSocketDebuggerUrl;
  } catch (e) {
    if (e.name === 'BrowserMismatchError') throw e;
    if (e.cause?.code !== 'ECONNREFUSED') throw e;
  }

  const browser = pickBrowser(browserId);
  const profileDir = resolve(RUNTIME_DIR, `${browser.id}-profile`);
  mkdirSync(profileDir, { recursive: true });

  launchChrome(port, profileDir, browser.executable);
  saveLastBrowser(browser.id);

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await sleep(500);
    try {
      const res = await fetch(versionUrl);
      const data = await res.json();
      return data.webSocketDebuggerUrl;
    } catch (e) {
      if (e.cause?.code !== 'ECONNREFUSED') throw e;
    }
  }
  throw new Error(`${browser.name} did not start within 15s on port ${port}`);
}

export class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TimeoutError);
    }
  }
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
          reject(new TimeoutError(`Timeout: ${method}`));
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
        reject(new TimeoutError(`Timeout waiting for event: ${method}`));
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
