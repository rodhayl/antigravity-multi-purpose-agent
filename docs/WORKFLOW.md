# Multi Purpose Agent - Workflows & Architecture

This document describes how the Multi Purpose Agent VS Code extension works end-to-end: CDP connectivity, browser-side automation, scheduling/queueing, quota awareness, safety features, and debugging.

---

## 1. High-Level Architecture

**Primary components**

- **Extension Host (Node.js)**: [extension-impl.js](file:///c:/Users/rulfe/GitHub/auto-accept-agent/main_scripts/extension-impl.js)
- **CDP bridge**: [cdp-handler.js](file:///c:/Users/rulfe/GitHub/auto-accept-agent/main_scripts/cdp-handler.js)
- **Browser payload**: [full_cdp_script.js](file:///c:/Users/rulfe/GitHub/auto-accept-agent/main_scripts/full_cdp_script.js)
- **Settings UI (WebView)**: [settings-panel.js](file:///c:/Users/rulfe/GitHub/auto-accept-agent/main_scripts/settings-panel.js)
- **Debug server (optional)**: [debug-handler.js](file:///c:/Users/rulfe/GitHub/auto-accept-agent/main_scripts/debug-handler.js)
- **Quota client (optional)**: [AntigravityClient](file:///c:/Users/rulfe/GitHub/auto-accept-agent/main_scripts/antigravity/client.js)

**Data flow (typical)**

1. Extension establishes CDP connections and injects the browser payload.
2. Browser payload exposes `window.__autoAccept*` APIs and runs the click loop.
3. Extension drives scheduling/queue actions by calling CDP APIs (send prompts, read stats).
4. Settings WebView reads/writes config and sends commands to the extension.

---

## 2. CDP Connectivity & Injection

**Connection policy**

- **Fixed CDP port**: `9004` only (no scanning).
- **Target discovery**: `http://127.0.0.1:9004/json/list`
- **Filter rules**: excludes targets without `webSocketDebuggerUrl` and excludes the Settings Panel webview.

**Injection sequence**

1. For each target, connect to its `webSocketDebuggerUrl`.
2. Inject [full_cdp_script.js](file:///c:/Users/rulfe/GitHub/auto-accept-agent/main_scripts/full_cdp_script.js) once per target.
3. Call `window.__autoAcceptStart(config)` on that target to start the browser-side loop.

---

## 3. Browser-Side Auto-Accept Loop

The browser payload maintains a global state object `window.__autoAcceptState` (analytics, per-session flags, and shared counters).

**Click loop**

- Entry point: `window.__autoAcceptStart(config)`
- Loop cadence: `config.pollInterval` (default 1000ms)
- Candidate scan: broad selectors like `button`, `[class*="button"]`, `[class*="anysphere"]`
- Button eligibility:
  - Matches action keywords like `accept`, `run`, `retry`, `apply`, `execute`, `confirm`, `allow`
  - Rejects keywords like `skip`, `reject`, `cancel`, `close`, `refine`
  - Must be visible, enabled, and have pointer-events enabled

**Verification & stats**

- The click is only counted when the button disappears within ~500ms.
- Verified clicks are tracked via the analytics module inside the browser payload.

---

## 4. Safety & Multi-Window Coordination

### Banned Command Interception

When a candidate button looks like a command execution action, the payload attempts to locate nearby `<pre>` / `<code>` blocks and compares extracted text against a configurable ban list. If banned, the click is skipped and a blocked action is tracked.

### Instance Locking (Multi-window)

Only one extension instance should actively drive CDP in a multi-window environment:

- A lock is stored in `globalState` under `<ide>-instance-lock` plus a heartbeat `<ide>-instance-lock-ping`.
- Polling updates the ping every 5 seconds.
- If another instance holds the lock with a fresh ping (<15s), the current instance enters standby (“locked out”) and stops controlling CDP until the lock is stale.

---

## 5. Scheduler & Prompt Queue

The Scheduler lives in the extension host and supports:

- **Interval mode**: send a prompt every N minutes
- **Daily mode**: send a prompt at a fixed HH:MM
- **Queue mode**: execute a list of prompts sequentially (optionally with “check prompts” interleaved)

**Queue execution**

- Runtime queue is built from `auto-accept.schedule.prompts` (and optionally `checkPrompt.*`).
- Queue progression uses a silence heuristic:
  - Every 5 seconds, the Scheduler reads click stats from CDP (`cdpHandler.getStats()`).
  - After the current queue item has been sent successfully and has been running for at least 10 seconds:
    - If no activity occurs for `silenceTimeout` seconds, the Scheduler advances to the next queue item.
- Queue behaviors:
  - `consume`: remove prompts from config as they complete
  - `loop`: loop back to the start after completion

**Conversation targeting**

- Sending prompts supports a “target conversation” value (empty = current active tab).
- Selecting a specific conversation is implemented by the browser payload clicking a matching `button.grow` tab, then sending the prompt.
- The “conversations list” exposed to the Settings UI is read from `window.__autoAcceptState.tabNames`. The payload contains utilities for tab-name normalization, but tab list population is currently not driven by the main click loop.

---

## 6. Quota Awareness & Auto-Continue

If Antigravity quota polling is enabled:

- The extension periodically calls `AntigravityClient.getUserStatus()` and updates a quota status bar item.
- The Scheduler is notified when any model is exhausted via `scheduler.setQuotaExhausted(true)`, which prevents queue advancement.
- When quota transitions from exhausted → available, the Scheduler:
  - Resends the current queue item (if queue is running and “resume queue” is enabled), or
  - Sends `Continue` (if “auto-continue” is enabled and queue resume does not apply).

---

## 7. Settings UI & Debugging

**Settings WebView**

- The Settings panel uses `postMessage` to call extension commands and update configuration.
- It also displays queue status, prompt history, quota info, logs, and safety settings.

**Debug Server (optional)**

- When debug mode is enabled, the extension can expose an HTTP debug server on `127.0.0.1:54321` for automated tests and live diagnostics (state snapshots, CDP evaluation, queue control, etc.).

For API details and test harness usage, see [DEBUG_TESTING.md](./DEBUG_TESTING.md).

---

## 8. Development Protocol

### Modifying browser logic

The browser payload runs inside a live page context. A syntax error in the payload can silently break automation for the target until the extension host is reloaded and the payload is re-injected.

Practical workflow:

1. Use the live debug tooling to execute and iterate on DOM selectors and helper logic against a real Antigravity tab.
2. Apply changes to [full_cdp_script.js](file:///c:/Users/rulfe/GitHub/auto-accept-agent/main_scripts/full_cdp_script.js).
3. Reload the VS Code extension host to re-inject the payload into targets.

### Adding or changing settings

Settings changes usually touch four layers:

1. [package.json](file:///c:/Users/rulfe/GitHub/auto-accept-agent/package.json) schema (`contributes.configuration`)
2. [settings-panel.js](file:///c:/Users/rulfe/GitHub/auto-accept-agent/main_scripts/settings-panel.js) UI + message handlers
3. [extension-impl.js](file:///c:/Users/rulfe/GitHub/auto-accept-agent/main_scripts/extension-impl.js) config reads/writes and behavior wiring
4. [cdp-handler.js](file:///c:/Users/rulfe/GitHub/auto-accept-agent/main_scripts/cdp-handler.js) when behavior affects browser payload config or evaluation

### Relauncher safety

The Relauncher modifies OS-level launch shortcuts to ensure Antigravity is started with `--remote-debugging-port=9004`. Treat changes to [relauncher.js](file:///c:/Users/rulfe/GitHub/auto-accept-agent/main_scripts/relauncher.js) as high-impact and validate on each platform you touch.

