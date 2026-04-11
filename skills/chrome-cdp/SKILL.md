---
name: chrome-cdp
description: Interact with local Chrome browser session (only on explicit user approval after being asked to inspect, debug, or interact with a page open in Chrome)
---

# Chrome CDP

Lightweight Chrome DevTools Protocol CLI. Connects directly via WebSocket — no Puppeteer, works with 100+ tabs, instant connection.

## Prerequisites

- Chrome (or Chromium, Brave, Edge, Vivaldi) with remote debugging enabled: open `chrome://inspect/#remote-debugging` and toggle the switch
- Node.js 22+ (uses built-in WebSocket)
- If your browser's `DevToolsActivePort` is in a non-standard location, set `CDP_PORT_FILE` to its full path

## Commands

`<skill_dir>` refers to the **chrome-cdp skill folder path** (i.e., the directory containing this `SKILL.md` file). All commands use `<skill_dir>/scripts/cdp.mjs`. The `<target>` is a **unique** targetId prefix from `list`; copy the full prefix shown in the `list` output (for example `6BE827FA`). The CLI rejects ambiguous prefixes.

### List open pages

```bash
<skill_dir>/scripts/cdp.mjs list
```

### Take a screenshot

```bash
<skill_dir>/scripts/cdp.mjs shot <target> [file]    # default: screenshot-<target>.png in runtime dir
```

Captures the **viewport only**. Scroll first with `eval` if you need content below the fold. Output includes the page's DPR and coordinate conversion hint (see **Coordinates** below).

### Accessibility tree snapshot

```bash
<skill_dir>/scripts/cdp.mjs snap <target>
```

### Evaluate JavaScript

```bash
<skill_dir>/scripts/cdp.mjs eval <target> <expr>
```

> **Watch out:** avoid index-based selection (`querySelectorAll(...)[i]`) across multiple `eval` calls when the DOM can change between them (e.g. after clicking Ignore, card indices shift). Collect all data in one `eval` or use stable selectors.

### Other commands

```bash
<skill_dir>/scripts/cdp.mjs html    <target> [selector]   # full page or element HTML
<skill_dir>/scripts/cdp.mjs nav     <target> <url>         # navigate and wait for load
<skill_dir>/scripts/cdp.mjs click   <target> <selector>    # click element by CSS selector
<skill_dir>/scripts/cdp.mjs clickxy <target> <x> <y>       # click at CSS pixel coords
<skill_dir>/scripts/cdp.mjs type    <target> <text>         # Input.insertText at current focus; works in cross-origin iframes unlike eval   
<skill_dir>/scripts/cdp.mjs keypress <target> <key>         # press a key via Input.dispatchKeyEvent; keys: ArrowUp/Down/Left/Right, Enter, Tab, Escape, Backspace, Delete, Home, End, PageUp/PageDown, Space, F1-F12, or single chars a-z 0-9
<skill_dir>/scripts/cdp.mjs loadall <target> <selector> [ms]  # click "load more" until gone (default 1500ms between clicks)
<skill_dir>/scripts/cdp.mjs evalraw <target> <method> [json]  # raw CDP command passthrough
<skill_dir>/scripts/cdp.mjs open    [url]                  # open new tab (each triggers Allow prompt)
<skill_dir>/scripts/cdp.mjs stop    [target]               # stop daemon(s)
```

### Network requests

```bash
<skill_dir>/scripts/cdp.mjs net <target>                    # list cached requests
<skill_dir>/scripts/cdp.mjs net <target> <id>               # view request details (JSON)
<skill_dir>/scripts/cdp.mjs net <target> <id> --body        # response body only
<skill_dir>/scripts/cdp.mjs net <target> <id> --request-body # request body only
<skill_dir>/scripts/cdp.mjs net <target> <id> --headers     # request + response headers
<skill_dir>/scripts/cdp.mjs net <target> <id> --raw         # show raw values (no redaction)
<skill_dir>/scripts/cdp.mjs net <target> xhr                # filter by type: XHR/Fetch
<skill_dir>/scripts/cdp.mjs net <target> error              # filter: status >= 400
<skill_dir>/scripts/cdp.mjs net <target> <keyword>          # filter by URL keyword
<skill_dir>/scripts/cdp.mjs net <target> clear              # clear cache
```

**Smart filtering**: Static resources (images, fonts, CSS, JS) are automatically excluded from cache. Only XHR, Fetch, Document, and WebSocket requests are captured.

**Security**: By default, sensitive headers (authorization, cookie, set-cookie, etc.) are redacted as `[REDACTED]`. Use `--raw` to see original values.

**Cache limit**: 500 requests (FIFO eviction).

## Coordinates

`shot` saves an image at native resolution: image pixels = CSS pixels × DPR. CDP Input events (`clickxy` etc.) take **CSS pixels**.

```
CSS px = screenshot image px / DPR
```

`shot` prints the DPR for the current page. Typical Retina (DPR=2): divide screenshot coords by 2.

## Tips

- Prefer `snap --compact` over `html` for page structure.
- Use `type` (not eval) to enter text in cross-origin iframes — `click`/`clickxy` to focus first, then `type`.
- Use `keypress` to send keyboard events (arrow keys, Enter, F-keys, etc.) — works for page navigation, shortcuts, and any key-based interactions.
- Chrome shows an "Allow debugging" modal once per tab on first access. A background daemon keeps the session alive so subsequent commands need no further approval. Daemons auto-exit after 120 minutes of inactivity.

## Plugin System

The chrome-cdp skill supports plugins for specific use cases. Plugins are located in `<skill_dir>/scripts/` subdirectories.

### Viewing Available Plugins

```bash
<skill_dir>/scripts/plugin.mjs --help          # List all available plugins
<skill_dir>/scripts/plugin.mjs <plugin-name>   # Show plugin details
```

### Plugin Creation Guidelines

To create a new plugin:

1. **Location**: Create a folder in `<skill_dir>/scripts/` directory (e.g., `<skill_dir>/scripts/my-plugin/`)

2. **Required Files**:
   - `<skill_dir>/scripts/my-plugin/info.json`: Plugin metadata
   - One or more script files (`.mjs`)

3. **Script Requirements**:
   - Every script must support `-h, --help` parameter to show detailed usage
   - Scripts should be executable Node.js modules

4. **info.json Format**:
   ```json
   {
     "description": "Brief plugin description",
     "features": [
       {
         "script": "script-name.mjs",
         "description": "What this script does",
         "usage": "node script-name.mjs <args> [options]"
       }
     ]
   }
   ```

   Required fields:
   - `description`: Plugin description
   - `features`: Array of script definitions
     - `script`: Script filename
     - `description`: Script functionality description
     - `usage`: Usage syntax

5. **Optional Fields** (for info.json):
   - `version`: Plugin version
   - `author`: Author name
   - `repository`: Repository URL
   - `license`: License type
   - `keywords`: Array of keywords
   - `dependencies`: Object with dependency names and URLs

6. **Important**: When adding new scripts to a plugin:
   - **Must update info.json**: Add the new script's metadata to the `features` array
   - The plugin manager will detect and warn about scripts not listed in info.json
   - This ensures users can discover all available plugin features

### Usage Workflow

1. **Check available plugins first**:
   ```bash
   <skill_dir>/scripts/plugin.mjs --help
   ```
   See if any existing plugin meets your needs.

2. **View plugin details**:
   ```bash
   <skill_dir>/scripts/plugin.mjs <plugin-name>
   ```
   Check available scripts and their usage.

3. **Use plugin scripts**:
   ```bash
   <skill_dir>/scripts/<plugin-name>/<script>.mjs --help
   <skill_dir>/scripts/<plugin-name>/<script>.mjs <args>
   ```

4. **Fall back to cdp.mjs**:
   If no plugin fits your needs, use the base `cdp.mjs` commands for direct CDP access.

### Example Plugin Structure

```
<skill_dir>/scripts/
├── cdp.mjs                 # Base CDP commands
├── plugin.mjs              # Plugin manager
├── weread/                 # WeRead plugin
│   ├── info.json          # Plugin metadata
│   └── extract-chapter.mjs # Chapter extraction script
└── my-plugin/             # Your custom plugin
    ├── info.json
    └── my-script.mjs
```
