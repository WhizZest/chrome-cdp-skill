# chrome-cdp

Let your AI agent see and interact with your **live Chrome session** — the tabs you already have open, your logged-in accounts, your current page state. No browser automation framework, no separate browser instance, no re-login.

Works out of the box with any Chrome installation. One toggle to enable, nothing else to install.

## Why this matters

Most browser automation tools launch a fresh, isolated browser. This one connects to the Chrome you're already running, so your agent can:

- Read pages you're logged into (Gmail, GitHub, internal tools, ...)
- Interact with tabs you're actively working in
- See the actual state of a page mid-workflow, not a clean reload

## Installation

### As a pi skill

```bash
npx skills add  WhizZest/chrome-cdp-skill
```

### For other agents (Amp, Claude Code, Cursor, etc.)

Clone or copy the `skills/chrome-cdp/` directory wherever your agent loads skills or context from. The only runtime dependency is **Node.js 22+** — no npm install needed.

### Enable remote debugging in Chrome

Navigate to `chrome://inspect/#remote-debugging` and toggle the switch. That's it.

The CLI auto-detects Chrome, Chromium, Brave, Edge, and Vivaldi on macOS, Linux, and Windows. If your browser stores `DevToolsActivePort` in a non-standard location, set the `CDP_PORT_FILE` environment variable to the full path.

## Usage

`<skill_dir>` refers to the **chrome-cdp skill folder path** (i.e., the `skills/chrome-cdp/` directory).

```bash
<skill_dir>/scripts/cdp.mjs list                              # list open tabs
<skill_dir>/scripts/cdp.mjs shot   <target>                   # screenshot → runtime dir
<skill_dir>/scripts/cdp.mjs shot   <target> --full            # full-page screenshot (entire scrollable content)
<skill_dir>/scripts/cdp.mjs snap   <target>                   # accessibility tree (compact, semantic)
<skill_dir>/scripts/cdp.mjs html   <target> [".selector"]     # full HTML or scoped to CSS selector
<skill_dir>/scripts/cdp.mjs eval   <target> "expression"      # evaluate JS [--save file] [--binary]
<skill_dir>/scripts/cdp.mjs nav    <target> https://...       # navigate and wait for load
<skill_dir>/scripts/cdp.mjs net    <target>                   # list cached HTTP requests (see --help for options)
<skill_dir>/scripts/cdp.mjs console <target>                  # list console messages
<skill_dir>/scripts/cdp.mjs ws     <target>                   # list WebSocket connections
<skill_dir>/scripts/cdp.mjs intercept <target> on             # enable network interception
<skill_dir>/scripts/cdp.mjs frames  <target>                  # list all frames (main + iframes)
<skill_dir>/scripts/cdp.mjs frames  <target> select <index>   # select frame for eval context
<skill_dir>/scripts/cdp.mjs frames  <target> reset            # reset to main frame
<skill_dir>/scripts/cdp.mjs click  <target> "selector"        # click element by CSS selector
<skill_dir>/scripts/cdp.mjs clickxy <target> <x> <y>          # click at CSS pixel coordinates
<skill_dir>/scripts/cdp.mjs type   <target> "text"            # type at focused element (works in cross-origin iframes)
<skill_dir>/scripts/cdp.mjs keypress <target> <key>           # press a key (ArrowUp/Down/Left/Right, Enter, Tab, Escape, Backspace, Delete, Home, End, PageUp/PageDown, Space, F1-F12, a-z, 0-9)
<skill_dir>/scripts/cdp.mjs loadall <target> "selector"       # click "load more" until gone
<skill_dir>/scripts/cdp.mjs evalraw <target> <method> [json]  # raw CDP command passthrough
<skill_dir>/scripts/cdp.mjs info   <target>                   # page info (URL, title, DPR, frames)
<skill_dir>/scripts/cdp.mjs open   [url]                      # open new tab (triggers Allow prompt)
<skill_dir>/scripts/cdp.mjs stop   [target]                   # stop daemon(s)
```

`<target>` is a unique prefix of the targetId shown by `list`.

### Debugger (JavaScript debugging)

The `debug` command provides full JavaScript debugging via Chrome's Debugger domain. The debugger is **lazy-enabled** — it activates only on first use, avoiding unnecessary overhead and anti-debugging detection.

```bash
# Script management
<skill_dir>/scripts/cdp.mjs debug <target> scripts [filter]   # list loaded JS scripts
<skill_dir>/scripts/cdp.mjs debug <target> source <id|url>    # view script source
<skill_dir>/scripts/cdp.mjs debug <target> search <query>     # search in scripts

# Breakpoints
<skill_dir>/scripts/cdp.mjs debug <target> break <url> <line> [col]  # set breakpoint (--cond for conditional)
<skill_dir>/scripts/cdp.mjs debug <target> breaktext <text>          # breakpoint on code text
<skill_dir>/scripts/cdp.mjs debug <target> breakxhr <pattern>        # XHR/Fetch breakpoint
<skill_dir>/scripts/cdp.mjs debug <target> breaks                    # list all breakpoints
<skill_dir>/scripts/cdp.mjs debug <target> unbreak <id|all>          # remove breakpoint(s)
<skill_dir>/scripts/cdp.mjs debug <target> unbreakxhr <pattern>      # remove XHR breakpoint

# Execution control
<skill_dir>/scripts/cdp.mjs debug <target> pause              # pause JS execution
<skill_dir>/scripts/cdp.mjs debug <target> resume             # resume execution
<skill_dir>/scripts/cdp.mjs debug <target> stepover           # step over
<skill_dir>/scripts/cdp.mjs debug <target> stepinto           # step into
<skill_dir>/scripts/cdp.mjs debug <target> stepout            # step out

# State inspection
<skill_dir>/scripts/cdp.mjs debug <target> status             # show paused state (call stack, scope)
<skill_dir>/scripts/cdp.mjs debug <target> vars [frame-idx]   # show scope variables
<skill_dir>/scripts/cdp.mjs debug <target> eval <expr> [idx]  # evaluate in paused frame

# Advanced
<skill_dir>/scripts/cdp.mjs debug <target> reset              # reset debugger state (no restart needed)
<skill_dir>/scripts/cdp.mjs debug <target> neutralize         # strip debugger; from new pages
<skill_dir>/scripts/cdp.mjs debug <target> neutralize-remove  # remove neutralization
<skill_dir>/scripts/cdp.mjs debug <target> trace <func>       # trace function calls (--log-this, --trace-id <id>)
<skill_dir>/scripts/cdp.mjs debug <target> logpoint <url> <line> [col] --expr <expr>  # logpoint (no pause)
<skill_dir>/scripts/cdp.mjs debug <target> inject <code>      # inject script before page load
<skill_dir>/scripts/cdp.mjs debug <target> inject-remove <id> # remove injected script
<skill_dir>/scripts/cdp.mjs debug <target> inject-list        # list injected scripts
```

**Anti-debugging**: Some websites use `debugger;` statements to block DevTools. The debugger handles this in multiple ways:
1. **Auto-skip**: `debugger;` pauses are automatically resumed by default
2. **Neutralize**: `debug <target> neutralize` strips `debugger;` from dynamically created functions — more effective for heavy anti-debugging (e.g., WeChat Reading)
3. **Reset**: `debug <target> reset` recovers from inconsistent state (after `Debugger.disable`, lost breakpoints, etc.) — **no daemon restart or Chrome "Allow" click needed**

**Navigation**: URL breakpoints survive across navigations (CDP feature). Code and XHR breakpoints are restored after navigation. Navigation waits for `DOMContentLoaded` rather than full `load`, which is more tolerant of `debugger;` anti-debugging.

### Console messages

```bash
<skill_dir>/scripts/cdp.mjs console <target>                # list console messages
<skill_dir>/scripts/cdp.mjs console <target> <id>           # view message details
<skill_dir>/scripts/cdp.mjs console <target> error          # filter by type
<skill_dir>/scripts/cdp.mjs console <target> --preserve     # include messages from previous navigations
<skill_dir>/scripts/cdp.mjs console <target> clear          # clear cache
```

Captures `console.log/warn/error` and uncaught exceptions with source URL and line number. Use `--preserve` to include messages from up to 3 previous navigations after page transitions.

### WebSocket analysis

```bash
<skill_dir>/scripts/cdp.mjs ws <target>                     # list connections
<skill_dir>/scripts/cdp.mjs ws <target> <wsid>              # view messages
<skill_dir>/scripts/cdp.mjs ws <target> <wsid> --analyze    # pattern analysis
<skill_dir>/scripts/cdp.mjs ws <target> <wsid> --group A    # view pattern group
<skill_dir>/scripts/cdp.mjs ws <target> <wsid> --sent       # sent frames only
<skill_dir>/scripts/cdp.mjs ws <target> <wsid> --received   # received frames only
```

Pattern analysis groups frames by direction + payload prefix + size class (A, B, C...), useful for reverse engineering WebSocket protocols.

### Network interception

```bash
<skill_dir>/scripts/cdp.mjs intercept <target> on           # enable (Request stage by default)
<skill_dir>/scripts/cdp.mjs intercept <target> off          # disable
<skill_dir>/scripts/cdp.mjs intercept <target> modify-header <pattern> <header> <value>
<skill_dir>/scripts/cdp.mjs intercept <target> mock <pattern> [status] [body]
<skill_dir>/scripts/cdp.mjs intercept <target> block <pattern>
<skill_dir>/scripts/cdp.mjs intercept <target> list         # list rules + hit counts
<skill_dir>/scripts/cdp.mjs intercept <target> stats        # statistics
```

Uses Chrome's Fetch Domain to intercept and modify requests. URL patterns support exact, substring, and glob (`*`) matching.

### Frame management (iframes)

```bash
<skill_dir>/scripts/cdp.mjs frames <target>                 # list all frames (main + iframes)
<skill_dir>/scripts/cdp.mjs frames <target> select <index>   # select frame by index for eval
<skill_dir>/scripts/cdp.mjs frames <target> reset            # reset to main frame
```

Lists all frames including nested iframes with frame ID, URL, and nesting depth. After `select`, `eval` commands execute in that frame's JavaScript context. Uses CDP's `ExecutionContext` to target the selected frame.

### Daemon info

```bash
<skill_dir>/scripts/cdp.mjs info <target>                    # page info (URL, title, DPR, frame count)
```

### evalraw safety

`evalraw` passes CDP commands directly to Chrome, with built-in safety guards:

- **Blocked**: `Target.detachFromTarget` on the daemon's own session (would kill the daemon)
- **Warned**: `Debugger.disable`, `Network.disable`, `Page.disable`, `Target.closeTarget`, etc. (may desynchronize daemon state — use `debug reset` to recover)
- **Allowed**: All other CDP methods work normally

## Testing

```bash
# Run all unit tests (no Chrome needed)
node tests/run-unit.mjs

# Run a single test file
node tests/unit/debugger-context.test.mjs

# Integration tests (requires Chrome + target)
CDP_TEST_TARGET=<id> node tests/integration/daemon-lifecycle.mjs
```

## Plugin System

Plugins extend chrome-cdp for specific use cases. Each plugin lives in its own subdirectory under `scripts/plugins/` and is managed as an independent repository.

### View available plugins

```bash
<skill_dir>/scripts/plugins/plugin.mjs --help          # list all plugins
<skill_dir>/scripts/plugins/plugin.mjs <plugin-name>   # show plugin details
```

### Usage workflow

1. Check available plugins with `plugins/plugin.mjs --help`
2. If a plugin fits your needs, use its scripts directly
3. If no plugin covers your scenario, fall back to `cdp.mjs` for direct CDP access

### Available plugins

| Plugin | Repository | Description |
|--------|-----------|-------------|
| weread | [reader-cdp-plugin](https://github.com/WhizZest/reader-cdp-plugin) | 微信读书专用插件 |

### Create a plugin

1. Create a folder under `<skill_dir>/scripts/plugins/` (e.g., `<skill_dir>/scripts/plugins/my-plugin/`)
2. Add an `info.json` with required fields:
   ```json
   {
     "description": "Plugin description",
     "features": [
       {
         "script": "script-name.mjs",
         "description": "What this script does",
         "usage": "node script-name.mjs <args> [options]"
       }
     ]
   }
   ```
3. Each script must support `-h, --help`
4. When adding new scripts, update `info.json` accordingly

## Why not chrome-devtools-mcp?

[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) reconnects on every command, so Chrome's "Allow debugging" modal can re-appear repeatedly and target enumeration times out with many tabs open. `chrome-cdp` holds one persistent daemon per tab — the modal fires once, and it handles 100+ tabs reliably.

## How it works

Connects directly to Chrome's remote debugging WebSocket — no Puppeteer, no intermediary. On first access to a tab, a lightweight background daemon is spawned that holds the session open. Chrome's "Allow debugging" modal appears once per tab; subsequent commands reuse the daemon silently. Daemons auto-exit after 120 minutes of inactivity.

This approach is also why it handles 100+ open tabs reliably, where tools built on Puppeteer often time out during target enumeration.

**Restarting the daemon is the last resort.** Every restart requires manually clicking "Allow" in Chrome — disruptive and cannot be automated. Before restarting, try `debug <target> reset` (recovers debugger state) or simply re-run the command (transient errors often resolve on retry).
