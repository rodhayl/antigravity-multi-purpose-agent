const vscode = require('vscode');
const http = require('http');
const path = require('path');
const fs = require('fs');

const GLOBAL_STATE_KEY = 'auto-accept-enabled-global';
const FREQ_STATE_KEY = 'auto-accept-frequency';
const BANNED_COMMANDS_KEY = 'auto-accept-banned-commands';
const ROI_STATS_KEY = 'auto-accept-roi-stats';

class DebugHandler {
    constructor(context, helpers) {
        this.context = context;
        this.helpers = helpers; // { log, getScheduler, getAntigravityClient, getRelauncher, getLockedOut }
        this.server = null;
        this.serverPort = 54321;
    }

    log(message) {
        try {
            const logPath = path.join(__dirname, '..', 'trace.log');
            fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
        } catch (e) {
            // Ignore file write errors
        }

        if (this.helpers.log) {
            this.helpers.log(message);
        } else {
            console.log(message);
        }
    }

    async handleCommand(action, params = {}) {
        const scheduler = this.helpers.getScheduler ? this.helpers.getScheduler() : null;
        const isEnabled = this.context.globalState.get(GLOBAL_STATE_KEY, false);

        try {
            switch (action) {
                // === Core Controls ===
                case 'toggle':
                    await vscode.commands.executeCommand('auto-accept.toggle');
                    return { success: true, enabled: this.context.globalState.get(GLOBAL_STATE_KEY, false) };
                case 'getEnabled':
                    return { success: true, enabled: isEnabled };

                // === Queue Control ===
                case 'startQueue':
                    // DEFENSIVE CHECK: Don't start if prompts are empty
                    if (scheduler) {
                        const configPrompts = vscode.workspace.getConfiguration('auto-accept.schedule').get('prompts', []);
                        if (!configPrompts || configPrompts.length === 0) {
                            return { success: false, error: 'Queue is empty' };
                        }
                    }
                    await vscode.commands.executeCommand('auto-accept.startQueue', { source: 'manual' });
                    return { success: true };
                case 'pauseQueue':
                    if (scheduler) { scheduler.pauseQueue(); return { success: true }; }
                    return { success: false, error: 'Scheduler not initialized' };
                case 'resumeQueue':
                    if (scheduler) { scheduler.resumeQueue(); return { success: true }; }
                    return { success: false, error: 'Scheduler not initialized' };
                case 'skipPrompt':
                    if (scheduler) { await scheduler.skipPrompt(); return { success: true }; }
                    return { success: false, error: 'Scheduler not initialized' };
                case 'stopQueue':
                    if (scheduler) { scheduler.stopQueue(); return { success: true }; }
                    return { success: false, error: 'Scheduler not initialized' };
                case 'resetQueue':
                    if (scheduler) { await scheduler.resetQueue(); return { success: true }; }
                    return { success: false, error: 'Scheduler not initialized' };
                case 'sendPrompt':
                    // Send prompt via scheduler (ensures history is updated)
                    if (scheduler && scheduler.cdpHandler && params.prompt) {
                        // Use scheduler's sendPrompt and await the full promise chain
                        const promptPromise = scheduler.sendPrompt(params.prompt);
                        await promptPromise; // This awaits the promptQueue chain
                        return { success: true, method: 'CDP' };
                    }
                    if (!params.prompt) return { success: false, error: 'No prompt provided' };
                    return { success: false, error: 'Scheduler or CDPHandler not initialized' };
                case 'getQueueStatus':
                    // Re-implementing logic here or calling command? Command is safer if it exists, but getStatus is direct.
                    // Extension.js has no public command for getQueueStatus that returns data (showQueueMenu is UI).
                    if (scheduler) {
                        return { success: true, status: scheduler.getStatus() };
                    }
                    return { success: true, status: { enabled: false, isRunningQueue: false, queueLength: 0, queueIndex: 0 } };

                // === Schedule Configuration ===
                case 'updateSchedule':
                    // Reuse existing update logic by checking params
                    const schedConfig = vscode.workspace.getConfiguration('auto-accept.schedule');
                    if (params.enabled !== undefined) await schedConfig.update('enabled', params.enabled, vscode.ConfigurationTarget.Global);
                    if (params.mode !== undefined) await schedConfig.update('mode', params.mode, vscode.ConfigurationTarget.Global);
                    if (params.value !== undefined) await schedConfig.update('value', params.value, vscode.ConfigurationTarget.Global);
                    if (params.prompt !== undefined) await schedConfig.update('prompt', params.prompt, vscode.ConfigurationTarget.Global);
                    if (params.prompts !== undefined) await schedConfig.update('prompts', params.prompts, vscode.ConfigurationTarget.Global);
                    if (params.queueMode !== undefined) await schedConfig.update('queueMode', params.queueMode, vscode.ConfigurationTarget.Global);
                    if (params.silenceTimeout !== undefined) await schedConfig.update('silenceTimeout', params.silenceTimeout, vscode.ConfigurationTarget.Global);
                    if (params.checkPromptEnabled !== undefined) await schedConfig.update('checkPrompt.enabled', params.checkPromptEnabled, vscode.ConfigurationTarget.Global);
                    if (params.checkPromptText !== undefined) await schedConfig.update('checkPrompt.text', params.checkPromptText, vscode.ConfigurationTarget.Global);
                    return { success: true };

                case 'getSchedule':
                    const sched = vscode.workspace.getConfiguration('auto-accept.schedule');
                    return {
                        success: true,
                        schedule: {
                            enabled: sched.get('enabled'),
                            mode: sched.get('mode'),
                            value: sched.get('value'),
                            prompt: sched.get('prompt'),
                            prompts: sched.get('prompts', []),
                            queueMode: sched.get('queueMode', 'consume'),
                            silenceTimeout: sched.get('silenceTimeout', 30),
                            checkPromptEnabled: sched.get('checkPrompt.enabled', false),
                            checkPromptText: sched.get('checkPrompt.text', '')
                        }
                    };

                // === Conversations ===
                case 'getConversations':
                    if (scheduler) {
                        const convs = await scheduler.getConversations();
                        return { success: true, conversations: convs };
                    }
                    return { success: true, conversations: [] };
                case 'setTargetConversation':
                    await vscode.commands.executeCommand('auto-accept.setTargetConversation', params.conversationId);
                    return { success: true };
                case 'getPromptHistory':
                    if (scheduler) {
                        return { success: true, history: scheduler.getHistory() };
                    }
                    return { success: true, history: [] };

                // === Banned Commands (Safety) ===
                case 'updateBannedCommands':
                    // Reuse command which handles state + session sync
                    await vscode.commands.executeCommand('auto-accept.updateBannedCommands', params.commands);
                    return { success: true };
                case 'getBannedCommands':
                    return { success: true, commands: this.context.globalState.get(BANNED_COMMANDS_KEY, []) };

                // === Antigravity Quota ===
                case 'setAntigravityQuota':
                    const quotaCfg = vscode.workspace.getConfiguration('auto-accept.antigravityQuota');
                    await quotaCfg.update('enabled', params.value, vscode.ConfigurationTarget.Global);
                    // updateStatusBar logic is handled by config listener in extension.js usually, or checks global state
                    return { success: true };
                case 'getAntigravityQuota':
                    return { success: true, enabled: vscode.workspace.getConfiguration('auto-accept.antigravityQuota').get('enabled', true) };
                case 'refreshAntigravityQuota':
                    const snapshot = await vscode.commands.executeCommand('auto-accept.getAntigravityQuota');
                    return { success: true, snapshot };
                case 'setResumeEnabled':
                    const resumeConf = vscode.workspace.getConfiguration('auto-accept.antigravityQuota.resume');
                    await resumeConf.update('enabled', params.value, vscode.ConfigurationTarget.Global);
                    return { success: true };
                case 'setAutoContinue':
                    const autoContConf = vscode.workspace.getConfiguration('auto-accept.autoContinue');
                    await autoContConf.update('enabled', params.value, vscode.ConfigurationTarget.Global);
                    return { success: true };
                case 'getAutoContinue':
                    return { success: true, enabled: vscode.workspace.getConfiguration('auto-accept.autoContinue').get('enabled', false) };

                // === Stats ===
                case 'getStats':
                    return { success: true, stats: this.context.globalState.get('auto-accept-stats', {}) };
                case 'getROIStats':
                    const roiStats = await vscode.commands.executeCommand('auto-accept.getROIStats');
                    return { success: true, roiStats };

                // === Logs ===
                case 'getLogs':
                    return this.getLogs(params.tailLines);
                case 'clearLogs':
                    return this.clearLogs();
                case 'openLogFile':
                    return this.openLogFile();

                // === Utility ===
                case 'setFrequency':
                    await vscode.commands.executeCommand('auto-accept.updateFrequency', params.value);
                    return { success: true };
                case 'resetAllSettings':
                    await vscode.commands.executeCommand('auto-accept.resetSettings');
                    return { success: true };

                // === Advanced / System ===
                case 'getSystemInfo':
                    return {
                        success: true,
                        info: {
                            platform: process.platform,
                            nodeVersion: process.versions.node,
                            appName: vscode.env.appName,
                            machineId: vscode.env.machineId,
                            time: new Date().toISOString()
                        }
                    };
                case 'getAntigravityStatus':
                    const client = this.helpers.getAntigravityClient ? this.helpers.getAntigravityClient() : null;
                    const status = client ? (client.isConnected ? 'connected' : 'disconnected') : 'not_initialized';
                    return {
                        success: true,
                        status
                    };
                case 'forceRelaunch':
                    await vscode.commands.executeCommand('auto-accept.relaunch');
                    return { success: true };
                case 'getLockedOut':
                    const locked = this.helpers.getLockedOut ? this.helpers.getLockedOut() : false;
                    return { success: true, isLockedOut: locked };

                // === Full State Snapshot ===
                case 'getFullState':
                    return this.getFullState();

                case 'getServerStatus':
                    return {
                        success: true,
                        server: {
                            running: !!this.server,
                            port: this.serverPort
                        }
                    };

                case 'getCDPStatus':
                    // Get detailed CDP connection status
                    const cdpHandler = scheduler ? scheduler.cdpHandler : null;
                    if (cdpHandler) {
                        return {
                            success: true,
                            cdp: {
                                connectionCount: cdpHandler.getConnectionCount(),
                                isEnabled: cdpHandler.isEnabled || false,
                                connections: Array.from(cdpHandler.connections.keys())
                            }
                        };
                    }
                    return { success: false, error: 'CDPHandler not available' };

                case 'listChatCommands':
                    // List all available commands that might be chat-related
                    try {
                        const allCommands = await vscode.commands.getCommands(true);
                        const chatCommands = allCommands.filter(cmd =>
                            cmd.includes('chat') ||
                            cmd.includes('Chat') ||
                            cmd.includes('antigravity') ||
                            cmd.includes('Antigravity') ||
                            cmd.includes('agent') ||
                            cmd.includes('Agent') ||
                            cmd.includes('ai') ||
                            cmd.includes('AI') ||
                            cmd.includes('copilot') ||
                            cmd.includes('Copilot')
                        ).sort();
                        return { success: true, commands: chatCommands, count: chatCommands.length };
                    } catch (e) {
                        return { success: false, error: e.message };
                    }

                case 'executeVSCodeCommand':
                    // Execute arbitrary VS Code command (for testing)
                    if (params.command) {
                        try {
                            const args = params.args || [];
                            const result = await vscode.commands.executeCommand(params.command, ...args);
                            return { success: true, command: params.command, result: result };
                        } catch (e) {
                            return { success: false, command: params.command, error: e.message };
                        }
                    }
                    return { success: false, error: 'No command provided' };

                case 'evaluateInBrowser':
                    // Evaluate arbitrary JavaScript in the browser context for debugging
                    // This allows testing selectors and input methods without rebuilding
                    if (params.code && scheduler && scheduler.cdpHandler) {
                        try {
                            const result = await scheduler.cdpHandler.evaluate(params.code);
                            return { success: true, result: result };
                        } catch (e) {
                            return { success: false, error: e.message };
                        }
                    }
                    if (!params.code) return { success: false, error: 'No code provided' };
                    return { success: false, error: 'CDP handler not available' };

                case 'getCDPConnections':
                    // List all CDP connections and their page info
                    if (scheduler && scheduler.cdpHandler) {
                        const connections = [];
                        for (const [id, conn] of scheduler.cdpHandler.connections) {
                            connections.push({ id, injected: conn.injected });
                        }
                        return { success: true, connections, count: connections.length };
                    }
                    return { success: false, error: 'CDP handler not available' };

                // === WebView UI Testing ===
                case 'uiAction':
                    // Forward UI action to Settings Panel WebView
                    const SettingsPanel = require('./settings-panel').SettingsPanel;
                    if (SettingsPanel.currentPanel) {
                        SettingsPanel.currentPanel.handleDebugUIAction(params);
                        // Wait briefly for async result
                        await new Promise(resolve => setTimeout(resolve, 100));
                        const uiResult = SettingsPanel.currentPanel.getLastUIResult();
                        return { success: true, result: uiResult };
                    }
                    return { success: false, error: 'Settings panel not open. Open it first via auto-accept.openSettings command.' };

                case 'getUISnapshot':
                    // Get full Settings Panel UI state
                    const SP = require('./settings-panel').SettingsPanel;
                    if (SP.currentPanel) {
                        SP.currentPanel.handleDebugUIAction({ type: 'getSnapshot' });
                        await new Promise(resolve => setTimeout(resolve, 100));
                        const snapshot = SP.currentPanel.getLastUIResult();
                        return { success: true, snapshot };
                    }
                    return { success: false, error: 'Settings panel not open' };

                case 'listUIElements':
                    // List all interactive elements in Settings Panel
                    const Panel = require('./settings-panel').SettingsPanel;
                    if (Panel.currentPanel) {
                        Panel.currentPanel.handleDebugUIAction({ type: 'listElements' });
                        await new Promise(resolve => setTimeout(resolve, 100));
                        const elements = Panel.currentPanel.getLastUIResult();
                        return { success: true, ...elements };
                    }
                    return { success: false, error: 'Settings panel not open' };

                case 'openSettingsPanel':
                    // Open or focus the settings panel
                    await vscode.commands.executeCommand('auto-accept.openSettings');
                    return { success: true };

                default:
                    return { success: false, error: `Unknown debug action: ${action}` };
            }
        } catch (err) {
            this.log(`[DebugHandler] Error executing ${action}: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    getLatestCdpLogPath() {
        const dir = this.context.extensionPath;
        try {
            const entries = fs.readdirSync(dir);
            const candidates = entries
                .filter(name => name.startsWith('multi-purpose-cdp-') && name.endsWith('.log'))
                .map(name => path.join(dir, name))
                .filter(p => fs.existsSync(p));

            if (candidates.length === 0) return null;

            let best = candidates[0];
            let bestMtime = 0;
            for (const p of candidates) {
                try {
                    const stat = fs.statSync(p);
                    const mtime = stat.mtimeMs || 0;
                    if (mtime >= bestMtime) {
                        bestMtime = mtime;
                        best = p;
                    }
                } catch (e) { }
            }
            return best;
        } catch (e) {
            return null;
        }
    }

    getLogs(tailLinesParam) {
        const logPath = this.getLatestCdpLogPath();
        try {
            if (logPath && fs.existsSync(logPath)) {
                const stat = fs.statSync(logPath);
                const maxBytes = 250000;
                const tailLines = tailLinesParam || 300;
                const start = Math.max(0, stat.size - maxBytes);
                const fd = fs.openSync(logPath, 'r');
                const buf = Buffer.alloc(stat.size - start);
                fs.readSync(fd, buf, 0, buf.length, start);
                fs.closeSync(fd);
                const lines = buf.toString('utf8').split(/\r?\n/).filter(l => l.length > 0);
                const tail = lines.slice(-tailLines).join('\n');
                return { success: true, logs: tail, linesCount: Math.min(tailLines, lines.length), totalSize: stat.size };
            }
            return { success: true, logs: '', linesCount: 0, totalSize: 0 };
        } catch (e) {
            return { success: false, error: `Failed to read logs: ${e.message}` };
        }
    }

    clearLogs() {
        const logPath = this.getLatestCdpLogPath();
        try {
            if (!logPath) return { success: true };
            fs.writeFileSync(logPath, '', 'utf8');
            return { success: true };
        } catch (e) {
            return { success: false, error: `Failed to clear logs: ${e.message}` };
        }
    }

    async openLogFile() {
        const logPath = this.getLatestCdpLogPath();
        if (logPath && fs.existsSync(logPath)) {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(logPath));
            await vscode.window.showTextDocument(doc, { preview: false });
            return { success: true };
        }
        return { success: false, error: 'Log file not found' };
    }

    getFullState() {
        const scheduler = this.helpers.getScheduler ? this.helpers.getScheduler() : null;
        const scheduleConfig = vscode.workspace.getConfiguration('auto-accept.schedule');
        const quotaConfig = vscode.workspace.getConfiguration('auto-accept.antigravityQuota');

        return {
            success: true,
            state: {
                enabled: this.context.globalState.get(GLOBAL_STATE_KEY, false),
                frequency: this.context.globalState.get(FREQ_STATE_KEY, 1000),
                schedule: {
                    enabled: scheduleConfig.get('enabled'),
                    mode: scheduleConfig.get('mode'),
                    value: scheduleConfig.get('value'),
                    prompt: scheduleConfig.get('prompt'),
                    prompts: scheduleConfig.get('prompts', []),
                    queueMode: scheduleConfig.get('queueMode', 'consume'),
                    silenceTimeout: scheduleConfig.get('silenceTimeout', 30)
                },
                quota: {
                    enabled: quotaConfig.get('enabled', true),
                    pollInterval: quotaConfig.get('pollInterval', 60),
                    resumeEnabled: vscode.workspace.getConfiguration('auto-accept.antigravityQuota.resume').get('enabled', true),
                    autoContinueEnabled: vscode.workspace.getConfiguration('auto-accept.autoContinue').get('enabled', false)
                },
                queueStatus: scheduler ? scheduler.getStatus() : null,
                bannedCommands: this.context.globalState.get(BANNED_COMMANDS_KEY, []),
                stats: this.context.globalState.get('auto-accept-stats', {}),
                isLockedOut: this.helpers.getLockedOut ? this.helpers.getLockedOut() : false,
                debugMode: true,
                antigravityStatus: (this.helpers.getAntigravityClient && this.helpers.getAntigravityClient()?.isConnected) ? 'connected' : 'disconnected'
            }
        };
    }

    startServer() {
        if (this.server) return;

        // Check if debug mode is enabled
        const debugEnabled = vscode.workspace.getConfiguration('auto-accept.debugMode').get('enabled', false);
        if (!debugEnabled) return;

        try {
            this.server = http.createServer(async (req, res) => {
                // CORS headers
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

                if (req.method === 'OPTIONS') {
                    res.writeHead(200);
                    res.end();
                    return;
                }

                if (req.method !== 'POST') {
                    res.writeHead(405);
                    res.end('Method not allowed, use POST');
                    return;
                }

                let body = '';
                // Safety: limit body size to ~1MB
                let bodySize = 0;
                const MAX_BODY_SIZE = 1024 * 1024;

                req.on('data', chunk => {
                    bodySize += chunk.length;
                    if (bodySize > MAX_BODY_SIZE) {
                        res.writeHead(413, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'Payload too large' }));
                        req.destroy();
                        return;
                    }
                    body += chunk.toString();
                });

                req.on('end', async () => {
                    try {
                        let data = {};
                        if (body) {
                            try {
                                data = JSON.parse(body);
                            } catch (e) {
                                res.writeHead(400, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
                                return;
                            }
                        }

                        const { action, params } = data;
                        if (!action) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, error: 'Missing action' }));
                            return;
                        }

                        const source = `${req.socket?.remoteAddress}:${req.socket?.remotePort}`;
                        this.log(`[DebugServer] Received action: ${action} from ${source}`);
                        if (action === 'uiAction' && data.params && data.params.type === 'click') {
                            this.log(`[ALERT] UI CLICK DETECTED FROM ${source} ON TARGET ${data.params.target}`);
                        }

                        // Delegate to handleCommand
                        const result = await this.handleCommand(action, params);

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(result));
                    } catch (e) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: e.message }));
                    }
                });
            });

            this.server.listen(this.serverPort, '127.0.0.1', () => {
                this.log(`Debug Server running on http://127.0.0.1:${this.serverPort}`);
            });

            this.server.on('error', (e) => {
                this.log(`Debug Server Error: ${e.message}`);
                if (e.code === 'EADDRINUSE') {
                    this.log('Port 54321 is busy. Debug server could not start.');
                }
                this.stopServer(); // Cleanup
            });

        } catch (e) {
            this.log(`Failed to start Debug Server: ${e.message}`);
        }
    }

    stopServer() {
        if (this.server) {
            this.server.close();
            this.server = null;
            this.log('Debug Server stopped');
        }
    }
}

module.exports = { DebugHandler };
