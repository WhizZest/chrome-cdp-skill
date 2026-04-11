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
pi install git:github.com/pasky/chrome-cdp-skill@v1.0.1
```

### For other agents (Amp, Claude Code, Cursor, etc.)

Clone or copy the `skills/chrome-cdp/` directory wherever your agent loads skills or context from. The only runtime dependency is **Node.js 22+** — no npm install needed.

### Enable remote debugging in Chrome

Navigate to `chrome://inspect/#remote-debugging` and toggle the switch. That's it.

The CLI auto-detects Chrome, Chromium, Brave, Edge, and Vivaldi on macOS, Linux, and Windows. If your browser stores `DevToolsActivePort` in a non-standard location, set the `CDP_PORT_FILE` environment variable to the full path.

## Usage

```bash
scripts/cdp.mjs list                              # list open tabs
scripts/cdp.mjs shot   <target>                   # screenshot → runtime dir
scripts/cdp.mjs snap   <target>                   # accessibility tree (compact, semantic)
scripts/cdp.mjs html   <target> [".selector"]     # full HTML or scoped to CSS selector
scripts/cdp.mjs eval   <target> "expression"      # evaluate JS in page context
scripts/cdp.mjs nav    <target> https://...       # navigate and wait for load
scripts/cdp.mjs net    <target>                   # list cached HTTP requests (see --help for options)
scripts/cdp.mjs click  <target> "selector"        # click element by CSS selector
scripts/cdp.mjs clickxy <target> <x> <y>          # click at CSS pixel coordinates
scripts/cdp.mjs type   <target> "text"            # type at focused element (works in cross-origin iframes)
scripts/cdp.mjs keypress <target> <key>           # press a key (ArrowUp/Down/Left/Right, Enter, Tab, Escape, Backspace, Delete, Home, End, PageUp/PageDown, Space, F1-F12, a-z, 0-9)
scripts/cdp.mjs loadall <target> "selector"       # click "load more" until gone
scripts/cdp.mjs evalraw <target> <method> [json]  # raw CDP command passthrough
scripts/cdp.mjs open   [url]                      # open new tab (triggers Allow prompt)
scripts/cdp.mjs stop   [target]                   # stop daemon(s)
```

`<target>` is a unique prefix of the targetId shown by `list`.

## Plugin System

Plugins extend chrome-cdp for specific use cases. Each plugin lives in its own subdirectory under `scripts/` and is managed as an independent repository.

### View available plugins

```bash
scripts/plugin.mjs --help          # list all plugins
scripts/plugin.mjs <plugin-name>   # show plugin details
```

### Usage workflow

1. Check available plugins with `plugin.mjs --help`
2. If a plugin fits your needs, use its scripts directly
3. If no plugin covers your scenario, fall back to `cdp.mjs` for direct CDP access

### Available plugins

| Plugin | Repository | Description |
|--------|-----------|-------------|
| weread | [reader-cdp-plugin](https://github.com/WhizZest/reader-cdp-plugin) | 微信读书专用插件 |

### Create a plugin

1. Create a folder under `scripts/` (e.g., `scripts/my-plugin/`)
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

Connects directly to Chrome's remote debugging WebSocket — no Puppeteer, no intermediary. On first access to a tab, a lightweight background daemon is spawned that holds the session open. Chrome's "Allow debugging" modal appears once per tab; subsequent commands reuse the daemon silently. Daemons auto-exit after 20 minutes of inactivity.

This approach is also why it handles 100+ open tabs reliably, where tools built on Puppeteer often time out during target enumeration.
