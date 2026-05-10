# Chrome CDP Skill - Manual Test Checklist

These tests require a running Chrome browser and manual interaction (clicking "Allow", visual verification, etc.).

## Prerequisites

1. Run `cdp list` — Chrome launches automatically with remote debugging enabled
2. At least one tab open (use `cdp open <url>` if needed)
3. Run `cdp list` to get targetId

## Basic Commands

- [ ] `cdp list` — shows open tabs
- [ ] `cdp eval <target> "1+1"` — returns `2`
- [ ] `cdp shot <target>` — takes screenshot, saves to runtime dir
- [ ] `cdp snap <target>` — returns accessibility tree
- [ ] `cdp html <target>` — returns page HTML
- [ ] `cdp nav <target> <url>` — navigates and waits for load
- [ ] `cdp info <target>` — shows page info (URL, title, DPR, frame count)

## Interaction

- [ ] `cdp click <target> <selector>` — clicks element
- [ ] `cdp type <target> <text>` — types text at focus
- [ ] `cdp keypress <target> Enter` — presses Enter key
- [ ] `cdp clickxy <target> <x> <y>` — clicks at coordinates (verify CSS px vs image px)

## Network

- [ ] `cdp net <target>` — lists cached requests (with initiator hints)
- [ ] `cdp net <target> xhr` — filters XHR/Fetch requests
- [ ] `cdp net <target> <id>` — shows status + response body (default)
- [ ] `cdp net <target> <id> --verbose` — full details (headers, request body, initiator)
- [ ] `cdp net <target> <id> --body` — shows response body only
- [ ] `cdp net <target> <id> --headers` — shows redacted headers
- [ ] `cdp net <target> <id> --raw` — shows raw (unredacted) headers
- [ ] `cdp net <target> <id> --initiator` — shows request initiator call stack
- [ ] `cdp net <target> clear` — clears cache

## Test Sites

These sites are useful for manual testing. Anti-debugging sites are needed for neutralize/debugger tests.

| Site | URL | Anti-debugging | Use for |
|------|-----|:--:|------|
| Wikipedia | `https://en.wikipedia.org/wiki/JavaScript` | No | Baseline eval/shot/nav tests |
| WeRead bookshelf | `https://weread.qq.com/web/shelf` | Yes | Eval without debugger, neutralize basic |
| WeRead reader | `https://weread.qq.com/web/reader/...` (any book) | Heavy | Neutralize + debugger full flow, stability |

## Debugger

- [ ] `cdp debug <target> scripts` — lists loaded scripts
- [ ] `cdp debug <target> source <scriptId>` — views script source
- [ ] `cdp debug <target> search <query>` — searches in scripts
- [ ] `cdp debug <target> break <url> <line>` — sets breakpoint
- [ ] `cdp debug <target> breaks` — lists breakpoints
- [ ] `cdp debug <target> unbreak <id>` — removes breakpoint
- [ ] `cdp debug <target> breakxhr <pattern>` — sets XHR breakpoint
- [ ] `cdp debug <target> unbreakxhr <pattern>` — removes XHR breakpoint
- [ ] `cdp debug <target> pause` — pauses execution
- [ ] `cdp debug <target> status` — shows paused state
- [ ] `cdp debug <target> vars` — shows scope variables
- [ ] `cdp debug <target> resume` — resumes execution
- [ ] `cdp debug <target> stepover` — steps over
- [ ] `cdp debug <target> stepinto` — steps into
- [ ] `cdp debug <target> stepout` — steps out

## Eval Paused Frame

- [ ] **Eval while paused**: Set breakpoint → trigger → `eval <target> "localVar"` → should return local variable value
- [ ] **Eval --frame while paused**: `eval <target> "expr" --frame 1` → should evaluate in caller frame
- [ ] **Eval --frame out of range**: `eval <target> "expr" --frame 99` → should error with valid range
- [ ] **Eval --binary while paused**: `eval <target> "expr" --binary` while paused → should error "not supported while paused"
- [ ] **Eval --save while paused**: `eval <target> "localVar" --save out.txt` while paused → should save to file
- [ ] **debug eval --save**: `debug <target> eval "expr" --save out.txt` → should save to file
- [ ] **Eval not paused**: `eval <target> "1+1"` when not paused → should work normally (Runtime.evaluate)

## Daemon Stability (Critical)

- [ ] **No restart needed after `debug reset`**: Run `evalraw Debugger.disable` → `debug reset` → verify breakpoints restored
- [ ] **`evalraw` blocks self-detach**: `evalraw Target.detachFromTarget '{"sessionId":"<daemon-sid>"}'` → should error with "Blocked"
- [ ] **`evalraw` warns on dangerous commands**: `evalraw Debugger.disable` → should show warning
- [ ] **`evalraw` allows safe commands**: `evalraw Target.attachToTarget '{"targetId":"<other-tab>"}'` → should work
- [ ] **Daemon survives transient errors**: Run invalid commands → verify daemon still responds
- [ ] **`info` command works**: Verify it shows URL, title, DPR, and frame count

## Anti-Debugging

- [ ] **Auto-skip**: Navigate to page with `debugger;` → should not block (auto-resumed)
- [ ] **Neutralize (first enable)**: `debug <target> neutralize` on a page where debugger was just lazy-enabled → should show "No scripts available for scanning" + page-load hook active
- [ ] **Neutralize (after reload)**: Reload page → `debug <target> neutralize` → should show "Loaded scripts: N checked, M modified" (or 0 modified if debugger is in strings)
- [ ] **Neutralize remove**: `debug <target> neutralize-remove` → page-load hook removed, fallback breakpoints cleaned
- [ ] **Neutralize + navigate**: `debug <target> neutralize` → navigate to page with `debugger;` → should not pause at all (page-load hook intercepts)
- [ ] **Neutralize covers 4 paths**: Verify page-load hook strips `debugger;` from `Function`, `eval`, `setTimeout`, `setInterval`
- [ ] **Neutralize while(true) defense**: `debug <target> neutralize` → `eval <target> "new Function('while(true){debugger;}')"` → should not freeze (while(true) replaced with while(false))
- [ ] **Neutralize toString override**: `debug <target> neutralize` → `eval <target> "(function(){var x=1;}).toString()"` → output should NOT contain `++` markers
- [ ] **Neutralize toString on WeRead**: `debug <target> neutralize` → nav to WeRead bookshelf → page loads without timeout (toString detection bypassed)
- [ ] **Neutralize + debugger full flow**: neutralize → **reload page** → pause → eval → vars → resume → all work without freeze (test on page with heavy `debugger;` statements)
- [ ] **Neutralize + debugger stability**: neutralize → **reload page** → pause → resume → wait 10s → eval still works (no pause/resume loop)
- [ ] **Eval on anti-debugging page without debugger**: `eval <target> location.href` on page with `debugger;` statements → returns URL without freezing (Debugger not enabled)

## Performance Trace

- [ ] **Perf start**: `debug <target> perf start` → should show "Performance trace started"
- [ ] **Perf status**: `debug <target> perf status` → should show elapsed time and event count
- [ ] **Perf stop**: `debug <target> perf stop` → should show report with Top N functions
- [ ] **Perf stop --top 5**: `debug <target> perf stop --top 5` → should show exactly 5 functions
- [ ] **Perf stop without start**: `debug <target> perf stop` without prior start → should show error
- [ ] **Perf start twice**: `debug <target> perf start` twice → should show error "already active"
- [ ] **Perf with network**: Start perf → trigger a fetch/XHR → stop → report should show network timeline
- [ ] **Perf with neutralize**: `debug <target> neutralize` → `debug <target> perf start` → should work on anti-debugging sites

## Navigation with Debugger

- [ ] **Breakpoints survive navigation**: Set breakpoint → navigate → verify breakpoint still listed
- [ ] **debug reset after navigation**: If breakpoints lost, `debug reset` restores them

## Edge Cases

- [ ] **Tab close**: Close tab → daemon should exit gracefully
- [ ] **Chrome close**: Close Chrome → daemon should exit gracefully
- [ ] **Idle timeout**: Wait 120 min (or reduce IDLE_TIMEOUT for testing) → daemon should auto-exit
- [ ] **Multiple commands rapid fire**: Send 10+ commands quickly → all should succeed
- [ ] **Concurrent daemon access**: Two CLI instances sending commands to same daemon → should not crash

## Timeout Error Diagnostics

These tests verify that timeout errors include rich diagnostic information to help distinguish normal vs abnormal timeouts.

### Eval Timeouts

- [ ] **Eval timeout on slow page**: `eval <target> "while(true){}"` → timeout error should show expression, "Page appears unresponsive", possible causes (infinite loop, page crash, CDP broken), and suggested actions
- [ ] **Eval timeout on frozen page**: After `while(true){}` freezes the page, subsequent `eval <target> "1+1"` → timeout error should show "Page appears unresponsive — all diagnostic queries failed" with causes and actions
- [ ] **Timeout error format**: Verify error message structure: `Timeout: <method>` + `expression:` + diagnostic sections + `Possible causes:` + `Suggested actions:`
- [ ] **Timeout on unresponsive page**: If page is completely unresponsive (all diagnostic queries fail) → should show fallback message "Page appears unresponsive — all diagnostic queries failed" with suggestions (check tab, reload, restart daemon)

> **Note**: `Runtime.evaluate` works independently of the Debugger pause state — eval does NOT timeout when the debugger is paused. Eval also works fine on anti-debugging pages when Debugger is not enabled (no `debugger;` statements fire).

### Nav Timeouts

- [ ] **Nav timeout on unreachable host**: `nav <target> "http://10.255.255.1/"` → timeout error should show target URL, Debugger state (enabled/neutralize), possible causes, and suggested actions
- [ ] **Nav timeout on anti-debugging page**: `debug reset` → `nav <target> <weread-reader-url>` → timeout error should show target URL, Page state (URL + readyState), Debugger state (enabled, neutralize not deployed), causes, and actions suggesting neutralize
- [ ] **Nav timeout with neutralize deployed**: On a clean tab: `debug neutralize` → `nav <target> <weread-reader-url>` → timeout error should show "neutralize hook: deployed" in Debugger state, with neutralize-specific advice
- [ ] **Nav timeout error format**: Verify nav error structure: original error + `target URL:` + diagnostic sections (`Page state:` and/or `Debugger state:`) + `Possible causes:` + `Suggested actions:`

### Click Timeouts

- [ ] **Click timeout format**: (Hard to trigger naturally — click fails fast on missing selectors) Verify error format structure in code review: `selector:` + `Page state:` + `Debugger state:` + `Possible causes:` + `Suggested actions:`
- [ ] **Clickxy timeout**: (Hard to trigger naturally) Verify error format structure in code review
