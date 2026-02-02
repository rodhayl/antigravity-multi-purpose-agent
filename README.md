<div align="center">
  <img src="media/icon.png" width="128" alt="Multi Purpose Agent Icon" />
  <h1>Antigravity Multi-Purpose Agent</h1>
  <p>
    <strong>Automate your Antigravity workflow. Zero babysitting required.</strong>
  </p>

  [![Version](https://img.shields.io/open-vsx/v/Rodhayl/multi-purpose-agent)](https://open-vsx.org/extension/Rodhayl/multi-purpose-agent)
  [![Downloads](https://img.shields.io/open-vsx/dt/Rodhayl/multi-purpose-agent)](https://open-vsx.org/extension/Rodhayl/multi-purpose-agent)
  [![License](https://img.shields.io/github/license/rodhayl/antigravity-multi-purpose-agent)](LICENSE)
</div>

---

## ⚡ Unchain Your AI

You didn't install an AI agent to sit there and click "Approve" 50 times an hour. **Antigravity Multi-Purpose Agent** handles the boring stuff so you can focus on the architecture.

> **The Problem**: Antigravity is powerful, but constant permission prompts break your flow.
>
> **The Solution**: This agent acts as your executive allow-list, auto-approving files and commands while you stay in the driver's seat.

### 🚀 What It Does
*   ✅ **Auto-Edit**: File changes are applied instantly.
*   ✅ **Auto-Run**: Safe terminal commands execute immediately.
*   ✅ **Auto-Retry**: "Please try again" prompts are automatically confirmed.
*   ✅ **Auto-Recover**: Detects when the agent gets stuck and nudges it back to life.

---

## 🛠️ Power Features

### 📅 The Prompt Queue
Don't wait for one task to finish before typing the next. Queue them up!
*   **Queue Mode**: Stack tasks like a playlist. The agent runs them one by one.
*   **Interval Mode**: Keep your agent awake with periodic prompts (perfect for long background sessions).
*   **Verification**: Automatically enforce a "Check your work" step between tasks.

### 💳 Quota Monitor
Stop guessing when you'll hit the limit.
*   **Real-time Tracking**: View model quotas and credits directly in the status bar.
*   **Smart Pause**: Automatically pauses the queue when you're out of credits.
*   **Auto Resume**: Kicks back into gear the moment your quota resets.

### 🛡️ Safety Guardrails
Automation shouldn't mean danger.
*   **Regex Blocklist**: Prevent destructive commands (like `rm -rf`) from ever running.
*   **Impact Dashboard**: Track exactly how many clicks and how much time you've saved.

---

## 🏁 Quick Start

1.  **Install** the extension.
2.  **Relaunch** Antigravity when prompted (we handle the flags).
3.  **Done**. You'll see `Multi Purpose: ON` in your status bar.

---

## 📚 Documentation & Debugging

For those who want to see how the magic happens:

*   **[Architecture Deep Dive](docs/WORKFLOW.md)**: Understanding the workflow.
*   **[Messaging Protocol](docs/SEND_MESSAGE_ANTIGRAVITY_TO_AGENT_CHAT.md)**: How we speak to the webview via CDP.
*   **[Live Debugging](docs/LIVE_CDP_DEBUGGING.md)**: Inject JavaScript directly into the agent.
*   **[Test Suite](docs/DEBUG_TESTING.md)**: Run the 52+ automated tests.

---

## ⚙️ Configuration At A Glance

| Feature | Setting Key | Description |
| :--- | :--- | :--- |
| **Schedule Mode** | `auto-accept.schedule.mode` | `interval`, `daily`, or `queue` |
| **Silence Timeout** | `auto-accept.schedule.silenceTimeout` | Seconds to wait before assuming a task is done |
| **Quota Poll** | `auto-accept.antigravityQuota.pollInterval` | How often to refresh credit status |
| **CDP Port** | `auto-accept.cdpPort` | Defaults to `9004`. Must match launch args. |

---

## Tech Stack & Credits

This project was built by **Rodhayl**, integrating and refining the best concepts from the community:

*   Based on **[Auto Accept Agent](https://github.com/Munkhin/auto-accept-agent)**
*   Incorporating **[Antigravity Quota Watcher](https://github.com/Henrik-3/AntigravityQuota)**

*A unified, streamlined experience for power users.*

---

## 📄 License

MIT
