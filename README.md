# Multi Purpose Agent for Antigravity

## Keep your Antigravity workflow moving. Zero babysitting.

Stop watching approvals. Multi Purpose Agent keeps your Antigravity conversation moving — accepting file edits, terminal commands, and recovery prompts automatically.

---

## Why Multi Purpose Agent?

Antigravity's multi-agent workflow is powerful, but it stops every time the agent needs approval. 

**That's dozens of interruptions per hour.**

Multi Purpose Agent eliminates the wait:
- ✅ **File edits** — Auto-applied
- ✅ **Terminal commands** — Auto-executed
- ✅ **Retry prompts** — Auto-confirmed
- ✅ **Stuck agents** — Auto-recovered

---

## Features

### Prompt Queue
Automate sequences of tasks with the built-in prompt scheduler:
- **Queue Mode** — Run tasks sequentially, advancing on silence detection
- **Interval Mode** — Send prompts on a schedule
- **Check Prompts** — Verify each task is fully implemented before moving on

### Antigravity Quota Monitor
Real-time quota tracking in the status bar:
- View remaining credits and usage percentage
- Time until quota reset
- Automatic pause/resume when quota is exhausted

### Dangerous Command Blocking
Built-in protection against destructive commands like `rm -rf /`. Customize the blocklist with patterns or regex.

### Impact Dashboard
Track your productivity gains:
- Clicks saved this week
- Time saved
- Sessions run
- Commands blocked

---

## Quick Start

1. **Install** the extension
2. **Relaunch** when prompted (one-click)
3. **Done** — Multi Purpose Agent activates automatically

The extension runs silently. Check the status bar for `Multi Purpose: ON`.

---

## Features Overview

| Feature | Description |
|---------|-------------|
| Auto-accept in active tab | Click Accept/Run/Retry automatically |
| Prompt Queue | Schedule and automate task sequences |
| Quota Monitor | Track Antigravity credits in status bar |
| Custom banned commands | Block dangerous patterns with regex support |
| Adjustable polling speed | Balance responsiveness and CPU usage |
| Impact Dashboard | Track clicks saved and time recovered |

---

## Technical Documentation

📖 **[Workflows & architecture →](docs/WORKFLOW.md)**

### How Prompt Queue Sends Messages

The Prompt Queue uses **Chrome DevTools Protocol (CDP)** to inject messages directly into the Antigravity chat panel. This works because:

1. **Standard VS Code APIs don't work** — Commands like `workbench.action.chat.open` target Copilot, not Antigravity
2. **Antigravity renders its chat in a webview** — Accessible via CDP WebSocket connections
3. **We target the correct DOM element** — A `contenteditable` div, NOT the IME overlay

The implementation:
- Finds the chat input (`contenteditable` with `cursor-text` class)
- Sets text via `document.execCommand('insertText')`
- Submits via Enter key event

📖 **[Full implementation details →](docs/SEND_MESSAGE_ANTIGRAVITY_TO_AGENT_CHAT.md)**

### Live CDP Debugging

For developers working on browser-side features, the extension provides Live CDP Debugging - the ability to execute arbitrary JavaScript in the Antigravity webview without rebuilding the extension.

Key capabilities:
- **`evaluateInBrowser`** - Run JavaScript via CDP
- **`getCDPConnections`** - List active connections
- **DOM exploration** - Find and test element selectors
- **Rapid iteration** - No rebuild required

📖 **[Live CDP debugging guide →](docs/LIVE_CDP_DEBUGGING.md)**

### Debug Testing Infrastructure

For comprehensive automated testing, the extension provides a Debug Server (port 54321) that enables:

- **Full state inspection** — Query all settings, stats, and queue status
- **Programmatic control** — Toggle features, update settings, control queue
- **Browser automation** — Execute JavaScript in Antigravity via CDP
- **Settings Panel UI automation** — Click buttons, toggle switches, read values
- **Comprehensive test suite** — 52+ automated tests covering all functionality

Run the test suite:
```bash
node tests/comprehensive_test.js
```

📖 **[Debug testing documentation →](docs/DEBUG_TESTING.md)**

---

## Requirements

- Antigravity IDE
- Antigravity launched with `--remote-debugging-port=9004`
- One-time relaunch after install (adds the flag automatically)

**Important:** The extension connects to **port 9004 only** for CDP and will not scan other ports.

## Logs

- CDP/debug logs are written to `multi-purpose-cdp-<MMHH-DDMMYY>.log` in the extension folder.
- Debug actions like `getLogs`, `clearLogs`, and `openLogFile` operate on the latest `multi-purpose-cdp-*.log` by file modification time.

---

## Credits & Thanks

This extension was created by building on and expanding work from these projects:

- Auto Accept Agent (Auto Accept for Antigravity): https://github.com/Munkhin/auto-accept-agent (includes background agent + tab rotation, which we removed in this extension)
- Antigravity Quota Watcher: https://github.com/Henrik-3/AntigravityQuota

Huge thanks to the developers of both extensions. If you want a lighter-weight or alternative approach, check out the original projects above.

---

## License

MIT
