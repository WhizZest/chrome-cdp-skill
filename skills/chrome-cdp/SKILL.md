---
name: chrome-cdp
description: Browse web pages, extract content, automate interactions, debug JavaScript, capture screenshots, and monitor network traffic via Chrome DevTools Protocol. Supports plugins for platform-specific tasks.
---

# Chrome CDP

Lightweight Chrome DevTools Protocol CLI. Connects directly via WebSocket — no Puppeteer, works with 100+ tabs, instant connection.

## Prerequisites

- **Google Chrome** and/or **Microsoft Edge** installed. chrome-cdp automatically picks the best available browser (last used > Chrome > Edge) or use `--browser chrome|edge` to specify explicitly.
  - Each browser gets its own isolated profile (`$RUNTIME_DIR/chrome-profile/`, `$RUNTIME_DIR/edge-profile/`), so logins and settings are per-browser.
  - The last used browser is saved, so subsequent commands default to the same browser.
  - Set `CDP_PORT` to use a custom debugging port (default: 9222).
  - Set `CDP_PORT_FILE` to connect to an existing browser instance (legacy mode).
- Node.js 22+ (uses built-in WebSocket)

`<skill_dir>` refers to the **chrome-cdp skill folder path** (i.e., the directory containing this `SKILL.md` file). All commands use `<skill_dir>/scripts/cdp.mjs`. The `<target>` is a **unique** targetId prefix from `list`; copy the full prefix shown in the `list` output (for example `6BE827FA`). The CLI rejects ambiguous prefixes.

## Thinking Framework: Choose the Right Approach First

**Tools are useless without the right strategy.** Before reaching for any command, decide which layer of approach is appropriate for your task.

### The Four Layers

```
Layer 0: Plugin (秒级) ⭐ ALWAYS CHECK FIRST
  "Someone already solved this. Just use it."
  方法: cdp plugin 列出插件；cdp plugin <name> 查看插件详情
  适用: 有现成插件的常见任务

Layer 1: Intercept (通常分钟级)
  "The system already does the work. I just need to capture the result."
  方法: Hook, Proxy, CDP eval, atob/btoa interception
  适用: 页面内部已经完成计算/解码/渲染，只需拦截输出

Layer 2: Observe (通常小时级)
  "The system won't tell me directly, but I can watch its behavior."
  方法: Network monitoring, console capture, performance tracing
  适用: 需要理解数据流但不需要修改系统行为

Layer 3: Reverse-Engineer (通常天~周级)
  "The system gives me nothing. I have to take it apart."
  方法: Debugger breakpoints, script analysis, byte-level decryption
  适用: 离线文件、服务端黑盒、需要复现算法本身
```

**Each layer is a fallback for the one above, not an upgrade.** Always start at Layer 0 (check plugins). Only move down when you've confirmed the layer above cannot work. (Example: A task that takes 4 days via Layer 3 reverse-engineering might take only 2 hours via a Layer 1 hook, or seconds via a Layer 0 plugin.)

### Decision Flow

Before choosing tools, ask these questions in order:

0. **"Is there a plugin for this?"** ⭐ ALWAYS ASK FIRST
   - Check available plugins → `cdp plugin`
   - If yes, use the plugin directly
   - If no, proceed to question 1

1. **"What does the page itself already do?"**
   - Does it decode data? → Hook `atob`/`btoa`
   - Does it render text? → Hook Canvas `fillText` or DOM APIs
   - Does it make API calls? → Intercept `fetch`/`XMLHttpRequest`
   - Does it execute dynamic code? → Hook `eval`/`Function`
   - All of the above → use `eval` command to inject hooks

2. **"Can I observe without interfering?"**
   - Network requests → `net` command
   - Console output → `console` command
   - WebSocket messages → `ws` command
   - Performance profile → `debug perf`

3. **"Do I really need to take it apart?"**
   - Only if: no runtime environment, system is remote black box, or you need the algorithm itself (not just this result)
   - Tools: `debug break`, `debug source`, `debug trace`, `evalraw`

### Key Questions Before Any Task

- **假设检查**: What assumption is the existing code/logic making that nobody has questioned?
- **趋势检查**: Is my workload increasing with each step? If yes, this approach may be unsustainable.
- **目标检查**: Am I solving the original problem, or a "more convenient" substitute?

### Common Anti-Patterns

| Anti-Pattern | Example | Fix |
|---|---|---|
| 逆向惯性 | Jumping to `debug break` before trying `eval` hook | Ask "what does the page already do?" first |
| 前提盲区 | Assuming CDP response body equals what the page uses | Verify: compare CDP data with page-internal data |
| 过早妥协 | "Garbled characters can't be fixed" → switch to plain text | Verify encoding assumptions; try different decode paths before accepting data loss |
| 工具归因 | "The tool isn't powerful enough" when `evalraw` was there all along | Exhaust existing capabilities before building new ones |
| 为假设造工具 | Building debug/reverse features before confirming they're needed | Confirm the approach works, then invest in tooling |

## Workflow

### Step 1: Check if a plugin exists for your task

**Before composing low-level commands, you MUST check if a plugin already solves your task.** Plugins provide higher-level, task-specific functionality that is simpler and more reliable.

```bash
<skill_dir>/scripts/cdp.mjs plugin
```

This lists all currently installed plugins with their descriptions. Plugins are independent repos — the list changes as plugins are added or removed.

### Step 2: Discover or open a target tab

Plugins and most commands need a `<target>` (a browser tab). Use low-level commands to find or create one:

```bash
<skill_dir>/scripts/cdp.mjs list                     # list all open tabs
<skill_dir>/scripts/cdp.mjs list --browser edge      # use Edge instead of Chrome
<skill_dir>/scripts/cdp.mjs open [url]               # open a new tab
<skill_dir>/scripts/cdp.mjs open [url] --browser chrome  # explicitly use Chrome
```

### Step 3: Use plugin or fall back to low-level commands

**If a matching plugin exists:**

```bash
<skill_dir>/scripts/cdp.mjs plugin <plugin-name>              # view plugin details and scripts
<skill_dir>/scripts/plugins/<plugin-name>/<script>.mjs --help # view script usage
<skill_dir>/scripts/plugins/<plugin-name>/<script>.mjs ...    # run the script
```

**If no plugin fits**, use the low-level commands documented below. Consider whether the task warrants creating a new plugin for future reuse.

## Low-Level Commands

### List open pages

```bash
<skill_dir>/scripts/cdp.mjs list
```

### Take a screenshot

```bash
<skill_dir>/scripts/cdp.mjs shot <target> [file]    # default: screenshot-<target>.png in runtime dir
<skill_dir>/scripts/cdp.mjs shot <target> --full     # full-page screenshot (captures entire scrollable content)
```

Captures the **viewport only** by default. Use `--full` to capture the entire page including content below the fold. Full-page screenshots temporarily resize the viewport, capture, then restore it. Very tall pages are capped at 16384px height. Scroll first with `eval` if you need content below the fold. Output includes the page's DPR and coordinate conversion hint (see **Coordinates** below).

### Accessibility tree snapshot

```bash
<skill_dir>/scripts/cdp.mjs snap <target>
```

### Evaluate JavaScript

```bash
<skill_dir>/scripts/cdp.mjs eval <target> <expr> [--save <file>] [--binary] [--frame <N>]
```

- `--save <file>`: Write result to a local file instead of returning it
- `--binary`: Treat result as binary data (ArrayBuffer/TypedArray). Auto-converts to base64, decodes on `--save`
- `--frame <N>`: Evaluate in call frame N when paused (default: 0). Ignored when not paused.
- **Paused behavior**: When execution is paused (e.g. at a breakpoint), `eval` automatically uses `Debugger.evaluateOnCallFrame` to access local variables in the paused scope. `--binary` is not supported while paused.

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
<skill_dir>/scripts/cdp.mjs info    <target>               # show page info (URL, title, DPR, frames)
<skill_dir>/scripts/cdp.mjs open    [url]                  # open new tab (each triggers Allow prompt)
<skill_dir>/scripts/cdp.mjs stop    [target]               # stop daemon(s)
```

### Network requests

```bash
<skill_dir>/scripts/cdp.mjs net <target>                    # list cached requests (with initiator hints)
<skill_dir>/scripts/cdp.mjs net <target> <id>               # view request: status + response body (default)
<skill_dir>/scripts/cdp.mjs net <target> <id> --verbose     # full details (headers, request body, initiator)
<skill_dir>/scripts/cdp.mjs net <target> <id> --body        # response body only
<skill_dir>/scripts/cdp.mjs net <target> <id> --request-body # request body only
<skill_dir>/scripts/cdp.mjs net <target> <id> --headers     # request + response headers
<skill_dir>/scripts/cdp.mjs net <target> <id> --raw         # show raw values (no redaction)
<skill_dir>/scripts/cdp.mjs net <target> <id> --initiator   # show request initiator (call stack)
<skill_dir>/scripts/cdp.mjs net <target> xhr                # filter by type: XHR/Fetch
<skill_dir>/scripts/cdp.mjs net <target> error              # filter: status >= 400
<skill_dir>/scripts/cdp.mjs net <target> <keyword>          # filter by URL keyword
<skill_dir>/scripts/cdp.mjs net <target> clear              # clear cache
```

**Smart filtering**: Static resources (images, fonts, CSS, JS) are automatically excluded from cache. Only XHR, Fetch, Document, and WebSocket requests are captured.

**Security**: By default, sensitive headers (authorization, cookie, set-cookie, etc.) are redacted as `[REDACTED]`. Use `--raw` to see original values.

**Cache limit**: 500 requests (FIFO eviction).

> **Note**: `--initiator` 的异步调用链（`parent` 栈帧）需要 Debugger 域启用时才能获取。daemon 默认不启用 Debugger，因此异步父链可能为空。如需完整异步调用栈，先执行 `debug <target> break` 启用 Debugger 后再查看。

### Console messages

```bash
<skill_dir>/scripts/cdp.mjs console <target>                # list console messages
<skill_dir>/scripts/cdp.mjs console <target> <id>           # view message details
<skill_dir>/scripts/cdp.mjs console <target> error          # filter by type: error
<skill_dir>/scripts/cdp.mjs console <target> warn           # filter by type: warning
<skill_dir>/scripts/cdp.mjs console <target> --page <n>     # pagination (default page 1)
<skill_dir>/scripts/cdp.mjs console <target> --size <n>     # page size (default 20)
<skill_dir>/scripts/cdp.mjs console <target> --preserve     # include messages from previous navigations
<skill_dir>/scripts/cdp.mjs console <target> clear          # clear console cache
```

Captures `Runtime.consoleAPICalled` and `Runtime.exceptionThrown` events. Messages include type, text, source URL, and line number. FIFO cache with 1000 message limit.

**Cross-navigation preservation**: By default, console messages are cleared on each navigation. Use `--preserve` to include messages from up to 3 previous navigations, grouped by URL with separators.

### WebSocket messages

```bash
<skill_dir>/scripts/cdp.mjs ws <target>                     # list WebSocket connections
<skill_dir>/scripts/cdp.mjs ws <target> <wsid>              # view connection messages
<skill_dir>/scripts/cdp.mjs ws <target> <wsid> --analyze    # pattern analysis (group by prefix/size)
<skill_dir>/scripts/cdp.mjs ws <target> <wsid> --group A    # view all frames in pattern group
<skill_dir>/scripts/cdp.mjs ws <target> <wsid> --frame <n>  # frame detail with full payload
<skill_dir>/scripts/cdp.mjs ws <target> <wsid> --sent       # only sent frames
<skill_dir>/scripts/cdp.mjs ws <target> <wsid> --received   # only received frames
<skill_dir>/scripts/cdp.mjs ws <target> <wsid> --content    # show full payload (truncated by default)
<skill_dir>/scripts/cdp.mjs ws <target> clear               # clear WebSocket cache
```

Tracks WebSocket connections via `Network.webSocket*` events. Pattern analysis groups frames by direction + payload prefix + size class (labeled A, B, C...), useful for reverse engineering WebSocket protocols. Up to 100 connections, 500 frames per connection.

### Network interception

```bash
<skill_dir>/scripts/cdp.mjs intercept <target> on [--request] [--response]  # enable interception
<skill_dir>/scripts/cdp.mjs intercept <target> off                           # disable interception
<skill_dir>/scripts/cdp.mjs intercept <target> modify-header <pattern> <header> <value>  # inject header
<skill_dir>/scripts/cdp.mjs intercept <target> mock <pattern> [status] [body]  # mock response
<skill_dir>/scripts/cdp.mjs intercept <target> block <pattern>               # block requests
<skill_dir>/scripts/cdp.mjs intercept <target> list                          # list rules
<skill_dir>/scripts/cdp.mjs intercept <target> remove <id>                   # remove rule
<skill_dir>/scripts/cdp.mjs intercept <target> stats                         # show statistics
```

Uses Chrome's **Fetch Domain** to intercept and modify network requests. Three actions:
- **modify-header**: Inject a custom header into matching requests
- **mock**: Serve a mock response (default 200 with CORS headers)
- **block**: Block requests with `BlockedByClient` error

URL patterns support exact match, substring match, and glob (`*` wildcard). Unmatched requests pass through automatically.

### Frame management (iframes)

```bash
<skill_dir>/scripts/cdp.mjs frames <target>                 # list all frames (main + iframes)
<skill_dir>/scripts/cdp.mjs frames <target> select <index>   # select frame by index (from list output)
<skill_dir>/scripts/cdp.mjs frames <target> reset            # reset to main frame
```

Lists all frames in the page including nested iframes, showing frame ID, URL, and nesting depth. After selecting a frame with `select`, subsequent `eval` commands execute in that frame's JavaScript context. Use `reset` to return to the main frame.

**How it works**: Uses CDP's `ExecutionContext` to target the selected frame. This allows reading/modifying variables inside iframes, including cross-origin ones (if the debugger is already attached).

### Debugger (JavaScript debugging)

The `debug` command provides JavaScript debugging capabilities via Chrome's Debugger domain. The debugger is **lazy-enabled** — it activates only when you first use a `debug` command, avoiding unnecessary overhead and anti-debugging detection.

**Anti-debugging handling**: Some websites use `debugger;` statements (often in recursive timers) to prevent DevTools inspection. The debugger handles this in multiple ways:
1. **Auto-skip**: By default, `debugger;` pauses (reason=`other`, no breakpoint hit) are automatically resumed, so they don't block normal operation.
2. **Neutralize**: Use `debug <target> neutralize` to strip `debugger;` statements and counter `Function.prototype.toString()` detection. It works in three ways: (a) injects a page-load hook that overrides `Function.prototype.constructor`, `window.eval`, `window.setTimeout`, and `window.setInterval` to strip `debugger;` from dynamically created code on new pages, (b) overrides `Function.prototype.toString` to filter out Chrome Debugger instrumentation markers (`++` prefixes) that some sites detect to identify active debuggers, and (c) scans already-loaded scripts and replaces `debugger;` with `void 0;` via `Debugger.setScriptSource` (falls back to conditional breakpoints if the script is on the stack). This is more effective than auto-skip for sites with heavy anti-debugging (e.g., WeChat Reading).
3. **Navigation with debugger active**: The debugger stays enabled during navigation — URL breakpoints (`Debugger.setBreakpointByUrl`) automatically survive across navigations (this is a CDP feature). Code breakpoints and XHR breakpoints are restored after navigation since Chrome resets them.
4. **State recovery**: If the debugger state becomes inconsistent (e.g., after external `Debugger.disable`), use `debug <target> reset` to re-enable the debugger and restore all breakpoints — no daemon restart needed.

**Navigation behavior**: Navigation waits for `DOMContentLoaded` (not full `load`), which is more tolerant of `debugger;` anti-debugging. If a breakpoint is hit during page load, navigation returns a message indicating the pause — use `debug status` to inspect and `debug resume` to continue loading.

```bash
# Script management
<skill_dir>/scripts/cdp.mjs debug <target> scripts [filter]   # list loaded JS scripts (optional URL filter)
<skill_dir>/scripts/cdp.mjs debug <target> source <id|url>    # view script source (--startLine, --endLine, --offset, --length, --pretty)
<skill_dir>/scripts/cdp.mjs debug <target> save <id|url> <f>  # save script source to file
<skill_dir>/scripts/cdp.mjs debug <target> search <query>     # search in scripts (--regex, --case, --filter url)

**Viewing minified/obfuscated scripts**: When inspecting compressed JavaScript (e.g., for anti-debugging analysis), always use `--pretty` to format the output into readable multi-line statements. Without `--pretty`, minified code appears as a single extremely long line that will be truncated by terminals and file readers. The CLI automatically detects long lines and suggests `--pretty` if you forget it.

> **Note**: `--pretty` uses best-effort `;`-based line breaking with string/comment awareness. It does not detect regex literals (`/regex/`), so semicolons inside regex may be incorrectly broken. Output is intended for readability, not round-trip preservation.

```bash
# Example: analyze anti-debugging code in a minified script
<skill_dir>/scripts/cdp.mjs debug <target> scripts weread                          # find the script
<skill_dir>/scripts/cdp.mjs debug <target> source <scriptId> --offset 0 --length 5000 --pretty > temp/head.txt
```

# Breakpoints
<skill_dir>/scripts/cdp.mjs debug <target> break <url> <line> [col]  # set breakpoint (--cond expr for conditional)
<skill_dir>/scripts/cdp.mjs debug <target> breaktext <text>          # set breakpoint on code text (--filter url, --nth N)
<skill_dir>/scripts/cdp.mjs debug <target> breakxhr <pattern>        # set XHR/Fetch breakpoint
<skill_dir>/scripts/cdp.mjs debug <target> breaks                    # list all breakpoints
<skill_dir>/scripts/cdp.mjs debug <target> unbreak <id|all>          # remove breakpoint(s)
<skill_dir>/scripts/cdp.mjs debug <target> unbreakxhr <pattern>      # remove XHR breakpoint

# Execution control
<skill_dir>/scripts/cdp.mjs debug <target> pause              # pause JS execution
<skill_dir>/scripts/cdp.mjs debug <target> resume             # resume execution
<skill_dir>/scripts/cdp.mjs debug <target> reset              # reset debugger state (re-enable, restore breakpoints)
<skill_dir>/scripts/cdp.mjs debug <target> stepover           # step over
<skill_dir>/scripts/cdp.mjs debug <target> stepinto           # step into
<skill_dir>/scripts/cdp.mjs debug <target> stepout            # step out

# State inspection
<skill_dir>/scripts/cdp.mjs debug <target> status             # show paused state (call stack, scope vars)
<skill_dir>/scripts/cdp.mjs debug <target> vars [frame-idx]   # show scope variables
<skill_dir>/scripts/cdp.mjs debug <target> eval <expr> [idx] [--save <file>]  # evaluate expression in paused frame

# Advanced
<skill_dir>/scripts/cdp.mjs debug <target> trace <func>       # trace function calls (--filter url, --pause, --log-this, --trace-id <id>)
<skill_dir>/scripts/cdp.mjs debug <target> logpoint <url> <line> [col] --expr <expression>  # set logpoint (no pause, logs to console)
<skill_dir>/scripts/cdp.mjs debug <target> neutralize         # strip debugger; statements from new pages
<skill_dir>/scripts/cdp.mjs debug <target> neutralize-remove  # remove debugger; neutralization
<skill_dir>/scripts/cdp.mjs debug <target> inject <code>      # inject script before every page load
<skill_dir>/scripts/cdp.mjs debug <target> inject-remove <id> # remove injected script
<skill_dir>/scripts/cdp.mjs debug <target> inject-list        # list all injected scripts
<skill_dir>/scripts/cdp.mjs debug <target> perf start          # start performance trace recording
<skill_dir>/scripts/cdp.mjs debug <target> perf stop [--top N] # stop recording and show analysis report
<skill_dir>/scripts/cdp.mjs debug <target> perf status         # show current recording status
```

**Search tips**: `search` automatically skips matches in minified files (lines > 10000 chars). Use `--no-exclude-minified` to include them. Use `--filter url` to narrow results to specific scripts.

**Breakpoint tips**: `breaktext` searches for code text and sets a breakpoint at the matching location — useful when you don't know the exact line number. Use `--nth N` for the Nth occurrence.

**Reset tips**: `reset` is useful when the debugger state becomes inconsistent (e.g., after `evalraw Debugger.disable`). It disables and re-enables the debugger, then restores all breakpoints. No daemon restart or Chrome "Allow" click needed.

**Neutralize tips**: Use `neutralize` to strip `debugger;` statements and counter `Function.prototype.toString()` detection. It injects a page-load hook (covering `Function`, `eval`, `setTimeout`, `setInterval`, and `Function.prototype.toString`) for future pages and scans current scripts to replace `debugger;` with `void 0;`. The `toString` override filters out Chrome Debugger instrumentation markers (`++` prefixes) that some sites (e.g., WeChat Reading) use to detect active debuggers. For sites with heavy anti-debugging, `neutralize` is more effective than auto-skip alone. Use `neutralize-remove` to undo (note: only affects future navigations; current page requires refresh to fully clear).

**Trace tips**: `trace` sets a conditional breakpoint that logs function calls without pausing (use `--pause` to pause on call). Enhanced options:
- `--log-this`: Also log the `this` context when the function is called (serialized, functions shown as `[Function]`)
- `--trace-id <id>`: Custom identifier in the log output (default: function name). Useful when tracing multiple functions to distinguish calls

**Perf tips**: `perf` uses CDP Tracing to record JS execution and network activity, then generates a human-readable report. Useful when you don't know function names (e.g., obfuscated bundles) — it shows which functions consume the most CPU time. Workflow:
1. `debug <target> perf start` — start recording
2. Perform actions on the page (click buttons, trigger requests)
3. `debug <target> perf stop [--top N]` — stop and view report
Use `perf status` to check recording progress between steps. If the page has anti-debugging, run `neutralize` first.

## Coordinates

`shot` saves an image at native resolution: image pixels = CSS pixels × DPR. CDP Input events (`clickxy` etc.) take **CSS pixels**.

```
CSS px = screenshot image px / DPR
```

`shot` prints the DPR for the current page. Typical Retina (DPR=2): divide screenshot coords by 2.

## Tips

- **Always check plugins before composing task-specific commands** — run `<skill_dir>/scripts/cdp.mjs plugin`. A plugin may already solve your task.
- Prefer `snap --compact` over `html` for page structure.
- Use `type` (not eval) to enter text in cross-origin iframes — `click`/`clickxy` to focus first, then `type`.
- Use `keypress` to send keyboard events (arrow keys, Enter, F-keys, etc.) — works for page navigation, shortcuts, and any key-based interactions.
- Chrome shows an "Allow debugging" modal once per tab on first access. A background daemon keeps the session alive so subsequent commands need no further approval. Daemons auto-exit after 120 minutes of inactivity.

**⚠ Restarting the daemon is the last resort.** Every daemon restart requires the user to manually click "Allow" in Chrome's debugging prompt — this is disruptive, requires the user to be watching the browser, and cannot be automated. Before restarting, always try:
1. `debug <target> reset` — recovers from inconsistent debugger state (after `Debugger.disable`, lost breakpoints, etc.)
2. Re-run the command — transient CDP errors (timeouts, connection glitches) often resolve on retry
3. `evalraw` with care — some CDP methods produce warnings but still work; only `Target.detachFromTarget` on the daemon's own session is blocked

The daemon is designed to survive normal usage without restarts. If you find a scenario that forces a restart, that's a bug — report it.

## Plugin Development

Plugins are independent repos located in `<skill_dir>/scripts/plugins/` subdirectories. They can be freely added or removed.

### Plugin Creation Guidelines

To create a new plugin:

1. **Location**: Create a folder in `<skill_dir>/scripts/plugins/` directory (e.g., `<skill_dir>/scripts/plugins/my-plugin/`)

2. **Required Files**:
   - `<skill_dir>/scripts/plugins/my-plugin/info.json`: Plugin metadata
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

### Plugin Directory Structure

```
<skill_dir>/scripts/plugins/
└── <plugin-name>/              # Each plugin is an independent repo
    ├── info.json               # Plugin metadata (required)
    └── <script>.mjs            # Plugin scripts
```

Use `cdp plugin` to list installed plugins and `cdp plugin <name>` to view details.
