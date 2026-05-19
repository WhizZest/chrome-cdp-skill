import { homedir } from 'os';
import { resolve } from 'path';

export const TIMEOUT = 15000;
export const NAVIGATION_TIMEOUT = 30000;
export const IDLE_TIMEOUT = 120 * 60 * 1000;
export const DAEMON_CONNECT_RETRIES = 20;
export const DAEMON_CONNECT_DELAY = 300;
export const MIN_TARGET_PREFIX_LEN = 8;
export const IS_WINDOWS = process.platform === 'win32';

export const RUNTIME_DIR = IS_WINDOWS
  ? resolve(process.env.LOCALAPPDATA || resolve(homedir(), 'AppData', 'Local'), 'cdp')
  : process.env.XDG_RUNTIME_DIR
    ? resolve(process.env.XDG_RUNTIME_DIR, 'cdp')
    : resolve(homedir(), '.cache', 'cdp');

export const PAGES_CACHE = resolve(RUNTIME_DIR, 'pages.json');

export const SENSITIVE_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie',
  'x-api-key', 'x-auth-token', 'x-access-token', 'x-csrf-token',
  'www-authenticate', 'proxy-authenticate'
]);

export const TEXT_MIME_TYPES = ['text/', 'application/json', 'application/xml', 'application/javascript', 'application/x-www-form-urlencoded'];

export const KEY_MAP = {
  'Enter': { key: 'Enter', code: 'Enter', keyCode: 13, windowsVirtualKeyCode: 13 },
  'Tab': { key: 'Tab', code: 'Tab', keyCode: 9, windowsVirtualKeyCode: 9 },
  'Escape': { key: 'Escape', code: 'Escape', keyCode: 27, windowsVirtualKeyCode: 27 },
  'Backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8, windowsVirtualKeyCode: 8 },
  'Delete': { key: 'Delete', code: 'Delete', keyCode: 46, windowsVirtualKeyCode: 46 },
  'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, windowsVirtualKeyCode: 38 },
  'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, windowsVirtualKeyCode: 40 },
  'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, windowsVirtualKeyCode: 37 },
  'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, windowsVirtualKeyCode: 39 },
  'Home': { key: 'Home', code: 'Home', keyCode: 36, windowsVirtualKeyCode: 36 },
  'End': { key: 'End', code: 'End', keyCode: 35, windowsVirtualKeyCode: 35 },
  'PageUp': { key: 'PageUp', code: 'PageUp', keyCode: 33, windowsVirtualKeyCode: 33 },
  'PageDown': { key: 'PageDown', code: 'PageDown', keyCode: 34, windowsVirtualKeyCode: 34 },
  'Space': { key: ' ', code: 'Space', keyCode: 32, windowsVirtualKeyCode: 32 },
  'F1': { key: 'F1', code: 'F1', keyCode: 112, windowsVirtualKeyCode: 112 },
  'F2': { key: 'F2', code: 'F2', keyCode: 113, windowsVirtualKeyCode: 113 },
  'F3': { key: 'F3', code: 'F3', keyCode: 114, windowsVirtualKeyCode: 114 },
  'F4': { key: 'F4', code: 'F4', keyCode: 115, windowsVirtualKeyCode: 115 },
  'F5': { key: 'F5', code: 'F5', keyCode: 116, windowsVirtualKeyCode: 116 },
  'F6': { key: 'F6', code: 'F6', keyCode: 117, windowsVirtualKeyCode: 117 },
  'F7': { key: 'F7', code: 'F7', keyCode: 118, windowsVirtualKeyCode: 118 },
  'F8': { key: 'F8', code: 'F8', keyCode: 119, windowsVirtualKeyCode: 119 },
  'F9': { key: 'F9', code: 'F9', keyCode: 120, windowsVirtualKeyCode: 120 },
  'F10': { key: 'F10', code: 'F10', keyCode: 121, windowsVirtualKeyCode: 121 },
  'F11': { key: 'F11', code: 'F11', keyCode: 122, windowsVirtualKeyCode: 122 },
  'F12': { key: 'F12', code: 'F12', keyCode: 123, windowsVirtualKeyCode: 123 },
};

export const BROWSERS = IS_WINDOWS ? [
  {
    id: 'chrome',
    name: 'Google Chrome',
    executables: [
      resolve(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      resolve(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      resolve(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    executables: [
      resolve(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      resolve(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      resolve(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
  },
] : [
  {
    id: 'chrome',
    name: 'Google Chrome',
    executables: ['google-chrome-stable'],
  },
];

export const LAST_BROWSER_FILE = resolve(RUNTIME_DIR, 'last-browser.json');

export const NEEDS_TARGET = new Set([
  'snap','snapshot','eval','shot','screenshot','html','nav','navigate',
  'net','network','click','clickxy','type','keypress','loadall','evalraw','debug',
  'console',
  'ws','websocket',
  'intercept',
  'frames',
  'info',
]);
