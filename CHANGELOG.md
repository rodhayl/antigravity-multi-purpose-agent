# Change Log

All notable changes to the "Multi Purpose Agent" extension will be documented in this file.

## [1.0.1] - 2026-02-02
### Fixed
- **Startup Flow**: Restart prompt now reliably triggers on first install or reinstall.
- **Error Handling**: Fixed duplicate error messages where both a toast and popup would appear during CDP setup.
- **Windows Launch**: Revised `relaunch()` logic on Windows to explicitly include the `--remote-debugging-port` flag during restart.

### Added
- **Reinstall Detection**: Detects version changes to reset internal state and ensure proper setup prompts appear.
- **Cleanup**: Automatically clears extension configuration state and log files upon deactivation/uninstall.
- **Smart Warnings**: CDP connection error popup now only correctly appears if the port is still inaccessible *after* the restart flow.
