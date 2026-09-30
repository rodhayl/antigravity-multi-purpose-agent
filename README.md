# Antigravity Multi-Purpose Agent: Workflow Scheduling and IDE Automation

[Open VSX listing](https://open-vsx.org/extension/Rodhayl/multi-purpose-agent) · [MIT license](LICENSE.md)

**Status:** Independent IDE automation extension. Source, focused tests and a [v1.0.2 VSIX artifact](multi-purpose-agent-1.0.2.vsix) are available. Compatibility depends on the Antigravity version and environment.

This extension brings prompt queues, scheduled messages, quota monitoring and configurable automatic acceptance into an Antigravity workflow. It coordinates extension commands and Chrome DevTools Protocol (CDP), with diagnostics and pattern-based filters. Automatic acceptance can apply edits or execute commands, so define the allowed scope and review the environment before enabling it.

## What this project demonstrates

- Queue, interval and daily scheduling, including optional intermediate review prompts.
- IDE command/CDP integration, quota-aware queue control and diagnostic tooling.
- Pattern-based filtering with dedicated tests, plus scheduler, analytics and strategy tests.
- Integration of community concepts into one extension; upstream credits are retained below.

## Operating boundaries

- Pattern filters can miss dangerous actions or reject legitimate ones. They are not an execution sandbox or a guarantee that a command is safe.
- Queue completion uses activity/silence and timeout signals. An additional “check your work” prompt does not establish correctness or human approval.
- CDP and the debug server expose powerful local control. Keep them local, use a controlled workspace and disable diagnostic tooling when it is not needed. The manifest currently defaults `auto-accept.debugMode.enabled` to `true`; review that setting before use.
- Quota information depends on the host integration. Estimated click/time savings are interaction metrics, not measured business ROI.

## Features

### Automatic interaction

When enabled, the extension can accept file changes, run selected terminal actions, confirm retry prompts and respond to inactivity. Review the configuration and target environment before allowing those actions.

### Prompt queue and scheduler

- **Queue mode:** send an ordered list of prompts with runtime queue controls.
- **Interval/daily modes:** send configured prompts on a schedule.
- **Check prompt:** optionally insert a review instruction between queued tasks.

### Quota monitor

Display model quota/credit information and pause/resume queues according to the configured quota behavior. Host changes can affect the integration.

### Filters and diagnostics

Configurable blocked-command patterns, diagnostic logs and interaction counters help inspect behavior. Test cases document specific filtering scenarios; they do not cover every command or IDE state.

## Quick start

1. Review the operating boundaries and settings below.
2. Install from the [Open VSX listing](https://open-vsx.org/extension/Rodhayl/multi-purpose-agent), or use **Install from VSIX** with the repository's [v1.0.2 package](multi-purpose-agent-1.0.2.vsix).
3. Review the requested Antigravity launch/CDP flags before relaunching.
4. Check the status bar and enable automation only for the workspace and tasks you intend to automate. Keep a way to pause or stop it.

## Configuration at a glance

| Feature | Setting key | Behavior |
| --- | --- | --- |
| Scheduling | `auto-accept.schedule.enabled` | Disabled by default |
| Schedule mode | `auto-accept.schedule.mode` | `interval`, `daily` or `queue` |
| Silence timeout | `auto-accept.schedule.silenceTimeout` | Wait before treating a task as inactive |
| Check prompt | `auto-accept.schedule.checkPrompt.enabled` | Disabled by default |
| Quota polling | `auto-accept.antigravityQuota.pollInterval` | Refresh interval for quota information |
| CDP port | `auto-accept.cdpPort` | Default `9004`; must match launch arguments |
| Diagnostics | `auto-accept.debugMode.enabled` | Currently enabled by default; review before use |

Debug server default: `http://127.0.0.1:54123`. Consult [package.json](package.json) for the full configuration surface and defaults.

## Development and validation

From the repository root:

```bash
npm install
npm run compile
npm test
npm run package
```

The default test script exercises scheduling, analytics, filters, command/CDP strategies, hybrid acceptance and debugging. Live IDE/CDP scenarios require an appropriately configured host and their own validation. Record the extension/IDE versions and test scope when reporting results.

## Documentation

- [Workflow and architecture](docs/WORKFLOW.md)
- [Antigravity chat delivery](docs/SEND_MESSAGE_ANTIGRAVITY_TO_AGENT_CHAT.md)
- [Live CDP debugging](docs/LIVE_CDP_DEBUGGING.md)
- [Testing guide](docs/DEBUG_TESTING.md)

## Credits

Built by Rodhayl, integrating and adapting concepts from:

- [Auto Accept Agent](https://github.com/Munkhin/auto-accept-agent)
- [Antigravity Quota Watcher](https://github.com/Henrik-3/AntigravityQuota)

## License

MIT. See [LICENSE.md](LICENSE.md).
