# Chrome CDP Skill - Manual Test Checklist

These tests require a running Chrome browser and manual interaction (clicking "Allow", visual verification, etc.).

## Prerequisites

1. Chrome with remote debugging enabled (`chrome://inspect/#remote-debugging`)
2. At least one tab open
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
