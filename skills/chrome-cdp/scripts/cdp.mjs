#!/usr/bin/env node
// cdp - lightweight Chrome DevTools Protocol CLI
// Uses raw CDP over WebSocket, no Puppeteer dependency.
// Requires Node 22+ (built-in WebSocket).
//
// Per-tab persistent daemon: page commands go through a daemon that holds
// the CDP session open. Chrome's "Allow debugging" modal fires once per
// daemon (= once per tab). Daemons auto-exit after 120min idle.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import {
  PAGES_CACHE,
  NEEDS_TARGET,
  RUNTIME_DIR,
  IS_WINDOWS,
  NAVIGATION_TIMEOUT,
} from './lib/constants.mjs';
import { resolvePrefix } from './lib/utils.mjs';
import { CDP, getWsUrl, getPages, formatPageList } from './lib/cdp-client.mjs';
import { runDaemon, getOrStartTabDaemon, sendCommand, stopDaemons } from './lib/daemon.mjs';
import { getCommandHandler } from './lib/command-registry.mjs';
import { formatPluginList, showPluginDetail } from './lib/plugin-manager.mjs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

if (!IS_WINDOWS) process.umask(0o077);
try { mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 }); } catch {}

import './commands/eval.mjs';
import './commands/page.mjs';
import './commands/interact.mjs';
import './commands/network.mjs';
import './commands/list.mjs';
import './commands/debug.mjs';
import './commands/console.mjs';
import './commands/ws.mjs';
import './commands/intercept.mjs';
import './commands/frames.mjs';
import './commands/info.mjs';
import './commands/open.mjs';

const USAGE = `cdp - lightweight Chrome DevTools Protocol CLI (no Puppeteer)

Usage: cdp <command> [args]
  --browser <chrome|edge>          Specify browser (default: last used, or chrome > edge)

  list                              List open pages (shows unique target prefixes)
  snap  <target>                    Accessibility tree snapshot
  eval  <target> <expr>             Evaluate JS expression [--save <file>] [--binary]
  shot  <target> <file>              Screenshot; prints coordinate mapping
                                    --full for full-page screenshot
  html  <target> [selector]         Get HTML (full page or CSS selector)
  nav   <target> <url>              Navigate to URL and wait for load completion
  net   <target>                    List cached HTTP requests (captured via CDP Network domain)
  net   <target> <id>               View request details (JSON)
  net   <target> <id> --body        Response body only
  net   <target> <id> --request-body Request body only
  net   <target> <id> --headers     Request + response headers
  net   <target> <id> --raw         Show raw values (no redaction)
  net   <target> <id> --save <file> Save response body to file
  net   <target> xhr                Filter by type: XHR/Fetch
  net   <target> error              Filter: status >= 400 or failed
  net   <target> <keyword>          Filter by URL keyword
  net   <target> clear              Clear request cache
  net   <target> initiator <id>     View request initiator (call stack)
  console <target>                  List recent console messages
  console <target> error            Filter by type: log/error/warn/info/debug/table
  console <target> <id>             View message details
  console <target> clear            Clear console cache
  console <target> --preserve       Show messages across navigations
  ws     <target>                    List WebSocket connections
  ws     <target> <wsid>             View connection messages
  ws     <target> <wsid> --analyze   Pattern analysis
  ws     <target> <wsid> --group A   View pattern group
  ws     <target> <wsid> --frame <n> Frame detail
  ws     <target> <wsid> --sent      Only sent frames
  ws     <target> <wsid> --received  Only received frames
  ws     <target> <wsid> --content   Show full payload
  ws     <target> clear              Clear WebSocket cache
  intercept <target> on [--request] [--response]  Enable interception
  intercept <target> off              Disable interception
  intercept <target> modify-header <pattern> <header> <value>
  intercept <target> mock <pattern> [status] [body]
  intercept <target> block <pattern>
  intercept <target> list             List rules
  intercept <target> remove <id>      Remove rule
  intercept <target> stats            Show statistics
  click   <target> <selector>       Click an element by CSS selector
  clickxy <target> <x> <y>          Click at CSS pixel coordinates (see coordinate note below)
  type    <target> <text>           Type text at current focus via Input.insertText
                                    Works in cross-origin iframes unlike eval-based approaches
  keypress <target> <key>           Press a key via Input.dispatchKeyEvent
                                    Keys: ArrowUp/Down/Left/Right, Enter, Tab, Escape,
                                    Backspace, Delete, Home, End, PageUp/PageDown, Space, F1-F12
                                    Or single characters: a-z, 0-9
  loadall <target> <selector> [ms]  Repeatedly click a "load more" button until it disappears
                                    Optional interval in ms between clicks (default 1500)
  evalraw <target> <method> [json]  Send a raw CDP command; returns JSON result
                                    e.g. evalraw <t> "DOM.getDocument" '{}'
  debug <target> scripts [filter]   List loaded JS scripts (Debugger domain, lazy-enabled)
  debug <target> source <id|url>    View script source (--startLine, --endLine, --offset, --length, --pretty)
  debug <target> save <id|url> <f>  Save script source to file
  debug <target> search <query>     Search in scripts (--regex, --case, --filter url)
  debug <target> break <url> <line> Set breakpoint (--cond expr)
  debug <target> breaktext <text>   Set breakpoint on code text (--filter url, --nth N)
  debug <target> breakxhr <pattern> Set XHR/Fetch breakpoint
  debug <target> breaks             List all breakpoints
  debug <target> unbreak <id|all>   Remove breakpoint(s)
  debug <target> unbreakxhr <pat>   Remove XHR breakpoint
  debug <target> pause              Pause JS execution
  debug <target> resume             Resume JS execution
  debug <target> reset              Reset debugger state (re-enable, restore breakpoints)
  debug <target> neutralize         Strip debugger; statements from new pages
  debug <target> neutralize-remove  Remove debugger; neutralization
  debug <target> stepover           Step over
  debug <target> stepinto           Step into
  debug <target> stepout            Step out
  debug <target> status             Show paused state (call stack, scope vars)
  debug <target> vars [frame-idx]   Show scope variables
  debug <target> eval <expr> [idx]  Evaluate in paused frame
  debug <target> trace <func>       Trace function calls (--filter url, --pause, --log-this, --trace-id <id>)
  debug <target> inject <code>      Inject script before every page load
  debug <target> inject-remove <id> Remove injected script
  frames <target>                   List page frames (main + iframes)
  frames <target> select <idx>      Select frame for eval
  frames <target> reset             Reset to main frame
  open  [url]                       Open a new tab (default: about:blank)
                                    Note: each new tab triggers a fresh "Allow debugging?" prompt
  plugin                            List available plugins
  plugin <name>                     Show plugin details
  stop  [target]                    Stop daemon(s)

<target> is a unique targetId prefix from "cdp list". If a prefix is ambiguous,
use more characters.

COORDINATE SYSTEM
  shot captures the viewport at the device's native resolution.
  The screenshot image size = CSS pixels × DPR (device pixel ratio).
  For CDP Input events (clickxy, etc.) you need CSS pixels, not image pixels.

    CSS pixels = screenshot image pixels / DPR

  shot prints the DPR and an example conversion for the current page.
  Typical Retina (DPR=2): CSS px ≈ screenshot px × 0.5
  If your viewer rescales the image further, account for that scaling too.

EVAL SAFETY NOTE
  Avoid index-based DOM selection (querySelectorAll(...)[i]) across multiple
  eval calls when the list can change between calls (e.g. after clicking
  "Ignore" buttons on a feed — indices shift). Prefer stable selectors or
  collect all data in a single eval.

DAEMON IPC (for advanced use / scripting)
  Each tab runs a persistent daemon at Unix socket in the runtime dir (see below).
  Protocol: newline-delimited JSON (one JSON object per line, UTF-8).
    Request:  {"id":<number>, "cmd":"<command>", "args":["arg1","arg2",...]}
    Response: {"id":<number>, "ok":true,  "result":"<string>"}
           or {"id":<number>, "ok":false, "error":"<message>"}
  Commands mirror the CLI: snap, eval, shot, html, nav, net, click, clickxy,
  type, keypress, loadall, evalraw, stop. Use evalraw to send arbitrary CDP methods.
  The socket disappears after 120 min of inactivity or when the tab closes.
`;

async function main() {
  const browserFlagIndex = process.argv.indexOf('--browser');
  let explicitBrowserId = null;
  if (browserFlagIndex !== -1 && browserFlagIndex + 1 < process.argv.length) {
    explicitBrowserId = process.argv[browserFlagIndex + 1];
    process.argv.splice(browserFlagIndex, 2);
  }

  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === '_daemon') { await runDaemon(args[0]); return; }

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE); process.exit(0);
  }

  if (explicitBrowserId && cmd !== 'list' && cmd !== 'open') {
    console.error(`--browser is only valid with 'list' and 'open' commands`);
    process.exit(1);
  }

  if (cmd === 'list' || cmd === 'ls') {
    const cdp = new CDP();
    await cdp.connect(await getWsUrl(explicitBrowserId));
    const pages = await getPages(cdp);
    cdp.close();
    writeFileSync(PAGES_CACHE, JSON.stringify(pages), { mode: 0o600 });
    console.log(formatPageList(pages));
    setTimeout(() => process.exit(0), 100);
    return;
  }

  if (cmd === 'open') {
    const url = args[0] || 'about:blank';
    const cdp = new CDP();
    await cdp.connect(await getWsUrl(explicitBrowserId));
    const result = await getCommandHandler('open')({ cdp, args });
    const pages = await getPages(cdp);
    if (!pages.some(p => p.targetId === result.targetId)) {
      pages.push({ targetId: result.targetId, title: url, url });
    }
    cdp.close();
    writeFileSync(PAGES_CACHE, JSON.stringify(pages), { mode: 0o600 });
    console.log(`Opened new tab: ${result.targetId.slice(0, 8)}  ${url}`);
    setTimeout(() => process.exit(0), 100);
    return;
  }

  if (cmd === 'stop') {
    await stopDaemons(args[0]);
    return;
  }

  if (cmd === 'plugin') {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pluginsDir = resolve(__dirname, 'plugins');
    if (args.length === 0) {
      console.log(formatPluginList(pluginsDir));
    } else {
      const result = showPluginDetail(pluginsDir, args[0]);
      if (result.error) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
      console.log(result.output);
    }
    return;
  }

  if (!NEEDS_TARGET.has(cmd)) {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(USAGE);
    process.exit(1);
  }

  const targetPrefix = args[0];
  if (!targetPrefix) {
    console.error('Error: target ID required. Run "cdp list" first.');
    process.exit(1);
  }

  if (!existsSync(PAGES_CACHE)) {
    console.error('No page list cached. Run "cdp list" first.');
    process.exit(1);
  }
  const pages = JSON.parse(readFileSync(PAGES_CACHE, 'utf8'));
  const targetId = resolvePrefix(targetPrefix, pages.map(p => p.targetId), 'target', 'Run "cdp list".');

  const conn = await getOrStartTabDaemon(targetId);

  const cmdArgs = args.slice(1);

  if (cmd === 'eval') {
    const flagArgs = [];
    const exprParts = [];
    for (let i = 0; i < cmdArgs.length; i++) {
      if (cmdArgs[i] === '--binary') {
        flagArgs.push('--binary');
      } else if (cmdArgs[i] === '--save') {
        if (i + 1 >= cmdArgs.length || !cmdArgs[i + 1]) {
          console.error('Error: --save requires a filename'); process.exit(1);
        }
        flagArgs.push('--save', cmdArgs[++i]);
      } else if (cmdArgs[i] === '--frame') {
        if (i + 1 >= cmdArgs.length || !cmdArgs[i + 1]) {
          console.error('Error: --frame requires a frame index'); process.exit(1);
        }
        flagArgs.push('--frame', cmdArgs[++i]);
      } else {
        exprParts.push(cmdArgs[i]);
      }
    }
    const expr = exprParts.join(' ');
    if (!expr) { console.error('Error: expression required'); process.exit(1); }
    cmdArgs.length = 0;
    cmdArgs.push(expr, ...flagArgs);
  } else if (cmd === 'type') {
    const text = cmdArgs.join(' ');
    if (!text) { console.error('Error: text required'); process.exit(1); }
    cmdArgs[0] = text;
  } else if (cmd === 'evalraw') {
    if (!cmdArgs[0]) { console.error('Error: CDP method required'); process.exit(1); }
    if (cmdArgs.length > 2) cmdArgs[1] = cmdArgs.slice(1).join(' ');
  } else if (cmd === 'shot' || cmd === 'screenshot') {
    if (!cmdArgs[0] || cmdArgs[0].startsWith('--')) {
      console.error('Error: File path required. Usage: shot/screenshot <target> <file> [--full]');
      process.exit(1);
    }
    cmdArgs[0] = resolve(cmdArgs[0]);
  }

  if ((cmd === 'nav' || cmd === 'navigate') && !cmdArgs[0]) {
    console.error('Error: URL required');
    process.exit(1);
  }

  const cmdTimeout = (cmd === 'nav' || cmd === 'navigate')
    ? NAVIGATION_TIMEOUT + 5000
    : undefined;
  const response = await sendCommand(conn, { cmd, args: cmdArgs }, cmdTimeout);

  if (response.ok) {
    if (response.result) console.log(response.result);
  } else {
    if (response.error && response.error.includes('file download may have been triggered')) {
      console.log(response.error);
      process.exitCode = 0;
    } else {
      console.error('Error:', response.error);
      process.exitCode = 1;
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
