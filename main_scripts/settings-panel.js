const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
let globalWarningDampener = 0; // Global rate limiter for warnings

class SettingsPanel {
    static currentPanel = undefined;
    static viewType = 'autoAcceptSettings';

    static createOrShow(extensionUri, context, mode = 'settings') {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it.
        if (SettingsPanel.currentPanel) {
            SettingsPanel.currentPanel.panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            SettingsPanel.viewType,
            'Multi Purpose Agent Settings',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
                retainContextWhenHidden: true
            }
        );

        SettingsPanel.currentPanel = new SettingsPanel(panel, extensionUri, context);
    }

    constructor(panel, extensionUri, context) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.context = context;
        this.disposables = [];

        this.update();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'setFrequency':
                        await this.context.globalState.update('auto-accept-frequency', message.value);
                        vscode.commands.executeCommand('auto-accept.updateFrequency', message.value);
                        break;
                    case 'getStats':
                        this.sendStats();
                        break;
                    case 'getROIStats':
                        this.sendROIStats();
                        break;
                    case 'updateBannedCommands':
                        await this.context.globalState.update('auto-accept-banned-commands', message.commands);
                        vscode.commands.executeCommand('auto-accept.updateBannedCommands', message.commands);
                        break;
                    case 'getBannedCommands':
                        this.sendBannedCommands();
                        break;
                    case 'updateSchedule':
                        const config = vscode.workspace.getConfiguration('auto-accept.schedule');
                        await config.update('enabled', message.enabled, vscode.ConfigurationTarget.Global);
                        await config.update('mode', message.mode, vscode.ConfigurationTarget.Global);
                        await config.update('value', message.value, vscode.ConfigurationTarget.Global);
                        await config.update('prompt', message.prompt, vscode.ConfigurationTarget.Global);
                        if (message.prompts !== undefined) {
                            await config.update('prompts', message.prompts, vscode.ConfigurationTarget.Global);
                        }
                        if (message.queueMode !== undefined) {
                            await config.update('queueMode', message.queueMode, vscode.ConfigurationTarget.Global);
                        }
                        if (message.silenceTimeout !== undefined) {
                            await config.update('silenceTimeout', message.silenceTimeout, vscode.ConfigurationTarget.Global);
                        }
                        if (message.checkPromptEnabled !== undefined) {
                            await config.update('checkPrompt.enabled', message.checkPromptEnabled, vscode.ConfigurationTarget.Global);
                        }
                        if (message.checkPromptText !== undefined) {
                            await config.update('checkPrompt.text', message.checkPromptText, vscode.ConfigurationTarget.Global);
                        }
                        if (message.resumeEnabled !== undefined) {
                            await vscode.workspace.getConfiguration('auto-accept.antigravityQuota.resume').update('enabled', message.resumeEnabled, vscode.ConfigurationTarget.Global);
                        }
                        if (message.autoContinueEnabled !== undefined) {
                            await vscode.workspace.getConfiguration('auto-accept.autoContinue').update('enabled', message.autoContinueEnabled, vscode.ConfigurationTarget.Global);
                        }
                        break;

                    case 'saveAndStartQueue':
                        // 1. Update Schedule first (Synchronously await)
                        const configToSave = vscode.workspace.getConfiguration('auto-accept.schedule');
                        const scheduleData = message.schedule || {};

                        console.log('[Extension] Received saveAndStartQueue command', scheduleData); // DEBUG LOG ADDED

                        // DEFENSIVE CHECK: Don't start if prompts are empty
                        if (!scheduleData.prompts || scheduleData.prompts.length === 0) {
                            // Global Dampener: Prevent spamming warnings loop globally (> 2sec)
                            const now = Date.now();
                            if (now - globalWarningDampener < 2000) {
                                console.log('[Extension] Suppressed duplicate empty queue warning (global dampener active)');
                                return;
                            }
                            globalWarningDampener = now;

                            console.log('[Extension] Blocked startQueue: No prompts provided.');
                            vscode.window.showWarningMessage('Multi Purpose: Cannot start queue without prompts.');
                            return;
                        }

                        await configToSave.update('enabled', true, vscode.ConfigurationTarget.Global); // Ensure enabled
                        if (scheduleData.mode) await configToSave.update('mode', scheduleData.mode, vscode.ConfigurationTarget.Global);
                        if (scheduleData.value) await configToSave.update('value', scheduleData.value, vscode.ConfigurationTarget.Global);
                        if (scheduleData.prompts) await configToSave.update('prompts', scheduleData.prompts, vscode.ConfigurationTarget.Global);
                        if (scheduleData.queueMode) await configToSave.update('queueMode', scheduleData.queueMode, vscode.ConfigurationTarget.Global);
                        if (scheduleData.silenceTimeout) await configToSave.update('silenceTimeout', scheduleData.silenceTimeout, vscode.ConfigurationTarget.Global);
                        if (scheduleData.checkPromptEnabled !== undefined) await configToSave.update('checkPrompt.enabled', scheduleData.checkPromptEnabled, vscode.ConfigurationTarget.Global);
                        if (scheduleData.checkPromptText !== undefined) await configToSave.update('checkPrompt.text', scheduleData.checkPromptText, vscode.ConfigurationTarget.Global);
                        if (scheduleData.resumeEnabled !== undefined) await vscode.workspace.getConfiguration('auto-accept.antigravityQuota.resume').update('enabled', scheduleData.resumeEnabled, vscode.ConfigurationTarget.Global);
                        if (scheduleData.autoContinueEnabled !== undefined) await vscode.workspace.getConfiguration('auto-accept.autoContinue').update('enabled', scheduleData.autoContinueEnabled, vscode.ConfigurationTarget.Global);

                        // 2. Start Queue
                        console.log('[Extension] Executing auto-accept.startQueue command'); // DEBUG LOG ADDED
                        vscode.commands.executeCommand('auto-accept.startQueue', { source: 'manual' });
                        break;
                    case 'getSchedule':
                        this.sendSchedule();
                        break;
                    case 'startQueue':
                        // Check config first to avoid empty start
                        const currentPrompts = vscode.workspace.getConfiguration('auto-accept.schedule').get('prompts', []);
                        if (!currentPrompts || currentPrompts.length === 0) {
                            const now = Date.now();
                            if (now - globalWarningDampener < 2000) return;
                            globalWarningDampener = now;

                            vscode.window.showWarningMessage('Multi Purpose: Prompt queue is empty. Add prompts first.');
                            return;
                        }
                        vscode.commands.executeCommand('auto-accept.startQueue', { source: 'manual' });
                        break;
                    case 'setResumeEnabled': {
                        const resumeConfig = vscode.workspace.getConfiguration('auto-accept.antigravityQuota.resume');
                        await resumeConfig.update('enabled', message.value, vscode.ConfigurationTarget.Global);
                        break;
                    }
                    case 'setAutoContinue': {
                        const autoContinueConfig = vscode.workspace.getConfiguration('auto-accept.autoContinue');
                        await autoContinueConfig.update('enabled', message.value, vscode.ConfigurationTarget.Global);
                        break;
                    }
                    case 'getLogs':
                        this.sendLogs(message.tailLines);
                        break;
                    case 'openLogFile':
                        this.openLogFile();
                        break;
                    case 'clearLogs':
                        this.clearLogs();
                        break;
                    case 'resetAllSettings':
                        vscode.commands.executeCommand('auto-accept.resetSettings');
                        break;
                    case 'setAntigravityQuota':
                        vscode.commands.executeCommand('auto-accept.toggleAntigravityQuota', message.value);
                        break;
                    case 'getAntigravityQuota':
                        this.sendAntigravityQuotaEnabled();
                        break;
                    case 'refreshAntigravityQuota':
                        this.sendAntigravityQuotaStatus();
                        break;
                    case 'getQueueStatus':
                        this.sendQueueStatus();
                        break;
                    case 'getConversations':
                        this.sendConversations();
                        break;
                    case 'getPromptHistory':
                        this.sendPromptHistory();
                        break;
                    case 'pauseQueue':
                        vscode.commands.executeCommand('auto-accept.pauseQueue');
                        break;
                    case 'resumeQueue':
                        vscode.commands.executeCommand('auto-accept.resumeQueue');
                        break;
                    case 'skipPrompt':
                        vscode.commands.executeCommand('auto-accept.skipPrompt');
                        break;
                    case 'stopQueue':
                        vscode.commands.executeCommand('auto-accept.stopQueue');
                        break;
                    case 'setTargetConversation':
                        vscode.commands.executeCommand('auto-accept.setTargetConversation', message.value);
                        break;
                    case 'setDebugMode': {
                        const debugConfig = vscode.workspace.getConfiguration('auto-accept.debugMode');
                        await debugConfig.update('enabled', message.value, vscode.ConfigurationTarget.Global);
                        break;
                    }
                    case 'getDebugMode':
                        this.sendDebugMode();
                        break;
                    case 'setCdpPort': {
                        const cdpConfig = vscode.workspace.getConfiguration('auto-accept');
                        await cdpConfig.update('cdpPort', message.value, vscode.ConfigurationTarget.Global);
                        break;
                    }
                    case 'getCdpPort':
                        this.sendCdpPort();
                        break;
                    // === Debug UI Bridge for Testing ===
                    case 'debugUIAction':
                        this.handleDebugUIAction(message.action);
                        break;
                    case 'debugUIResult':
                        this.handleDebugUIResult(message.result);
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    sendStats() {
        const stats = this.context.globalState.get('auto-accept-stats', {
            clicks: 0,
            sessions: 0,
            lastSession: null
        });
        const frequency = this.context.globalState.get('auto-accept-frequency', 1000);

        this.panel.webview.postMessage({
            command: 'updateStats',
            stats,
            frequency
        });
    }

    async sendROIStats() {
        try {
            const roiStats = await vscode.commands.executeCommand('auto-accept.getROIStats');
            this.panel.webview.postMessage({
                command: 'updateROIStats',
                roiStats
            });
        } catch (e) {
            // ROI stats not available yet
        }
    }

    sendDebugMode() {
        const config = vscode.workspace.getConfiguration('auto-accept.debugMode');
        this.panel.webview.postMessage({
            command: 'updateDebugMode',
            enabled: config.get('enabled', true)
        });
    }

    sendCdpPort() {
        const config = vscode.workspace.getConfiguration('auto-accept');
        this.panel.webview.postMessage({
            command: 'updateCdpPort',
            port: config.get('cdpPort', 9004)
        });
    }

    sendBannedCommands() {
        const defaultBannedCommands = [
            'rm -rf /',
            'rm -rf ~',
            'rm -rf *',
            'format c:',
            'del /f /s /q',
            'rmdir /s /q',
            ':(){:|:&};:',
            'dd if=',
            'mkfs.',
            '> /dev/sda',
            'chmod -R 777 /'
        ];
        const bannedCommands = this.context.globalState.get('auto-accept-banned-commands', defaultBannedCommands);
        this.panel.webview.postMessage({
            command: 'updateBannedCommands',
            bannedCommands
        });
    }

    sendSchedule() {
        const config = vscode.workspace.getConfiguration('auto-accept.schedule');
        const resumeConfig = vscode.workspace.getConfiguration('auto-accept.antigravityQuota.resume');
        this.panel.webview.postMessage({
            command: 'updateSchedule',
            schedule: {
                enabled: config.get('enabled'),
                mode: config.get('mode'),
                value: config.get('value'),
                prompt: config.get('prompt'),
                prompts: config.get('prompts', []),
                queueMode: config.get('queueMode', 'consume'),
                silenceTimeout: config.get('silenceTimeout', 30),
                checkPromptEnabled: config.get('checkPrompt.enabled', false),
                checkPromptText: config.get('checkPrompt.text', ''),
                resumeEnabled: resumeConfig.get('enabled', true),
                autoContinueEnabled: vscode.workspace.getConfiguration('auto-accept.autoContinue').get('enabled', false)
            }
        });
    }

    async sendAntigravityQuotaEnabled() {
        try {
            const enabled = await vscode.commands.executeCommand('auto-accept.getAntigravityQuotaEnabled');
            this.panel.webview.postMessage({
                command: 'updateAntigravityQuotaEnabled',
                enabled: enabled !== false
            });
        } catch (e) {
            this.panel.webview.postMessage({
                command: 'updateAntigravityQuotaEnabled',
                enabled: true
            });
        }
    }

    async sendAntigravityQuotaStatus() {
        try {
            const snapshot = await vscode.commands.executeCommand('auto-accept.getAntigravityQuota');
            this.panel.webview.postMessage({
                command: 'updateAntigravityQuotaStatus',
                snapshot
            });
        } catch (e) {
            this.panel.webview.postMessage({
                command: 'updateAntigravityQuotaStatus',
                snapshot: null,
                error: e.message
            });
        }
    }

    async sendQueueStatus() {
        try {
            const status = await vscode.commands.executeCommand('auto-accept.getQueueStatus');
            this.panel.webview.postMessage({
                command: 'updateQueueStatus',
                status: status || { enabled: false, isRunningQueue: false, queueLength: 0, queueIndex: 0, isQuotaExhausted: false }
            });
        } catch (e) {
            this.panel.webview.postMessage({
                command: 'updateQueueStatus',
                status: { enabled: false, isRunningQueue: false, queueLength: 0, queueIndex: 0, isQuotaExhausted: false }
            });
        }
    }

    async sendConversations() {
        try {
            const conversations = await vscode.commands.executeCommand('auto-accept.getConversations');
            this.panel.webview.postMessage({
                command: 'updateConversations',
                conversations: conversations || []
            });
        } catch (e) {
            this.panel.webview.postMessage({
                command: 'updateConversations',
                conversations: []
            });
        }
    }

    async sendPromptHistory() {
        try {
            const history = await vscode.commands.executeCommand('auto-accept.getPromptHistory');
            this.panel.webview.postMessage({
                command: 'updatePromptHistory',
                history: history || []
            });
        } catch (e) {
            this.panel.webview.postMessage({
                command: 'updatePromptHistory',
                history: []
            });
        }
    }

    getLogFilePath() {
        try {
            const dir = this.context.extensionPath;
            const entries = fs.readdirSync(dir);
            const candidates = entries
                .filter(name => name.startsWith('multi-purpose-cdp-') && name.endsWith('.log'))
                .map(name => path.join(dir, name))
                .filter(p => fs.existsSync(p));

            if (candidates.length === 0) {
                const d = new Date();
                const pad2 = (n) => String(n).padStart(2, '0');
                const suffix = `${pad2(d.getMinutes())}${pad2(d.getHours())}-${pad2(d.getDate())}${pad2(d.getMonth() + 1)}${pad2(d.getFullYear() % 100)}`;
                return path.join(dir, `multi-purpose-cdp-${suffix}.log`);
            }

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
            const dir = this.context.extensionPath;
            const d = new Date();
            const pad2 = (n) => String(n).padStart(2, '0');
            const suffix = `${pad2(d.getMinutes())}${pad2(d.getHours())}-${pad2(d.getDate())}${pad2(d.getMonth() + 1)}${pad2(d.getFullYear() % 100)}`;
            return path.join(dir, `multi-purpose-cdp-${suffix}.log`);
        }
    }

    readTail(filePath, { tailLines = 300, maxBytes = 250000 } = {}) {
        try {
            if (!fs.existsSync(filePath)) {
                return { text: '', meta: { filePath, exists: false } };
            }

            const stat = fs.statSync(filePath);
            const size = stat.size || 0;
            const start = Math.max(0, size - maxBytes);
            const length = size - start;

            const fd = fs.openSync(filePath, 'r');
            try {
                const buf = Buffer.alloc(length);
                fs.readSync(fd, buf, 0, length, start);
                const content = buf.toString('utf8');
                const lines = content.split(/\r?\n/).filter(l => l.length > 0);
                const tail = lines.slice(-tailLines).join('\n');
                return {
                    text: tail,
                    meta: {
                        filePath,
                        exists: true,
                        size,
                        mtimeMs: stat.mtimeMs,
                        linesShown: Math.min(tailLines, lines.length)
                    }
                };
            } finally {
                try { fs.closeSync(fd); } catch (e) { }
            }
        } catch (e) {
            return { text: `Failed to read logs: ${e.message}`, meta: { filePath, exists: null } };
        }
    }

    sendLogs(tailLines) {
        const filePath = this.getLogFilePath();
        const result = this.readTail(filePath, { tailLines: parseInt(tailLines) || 300 });
        this.panel.webview.postMessage({
            command: 'updateLogs',
            logs: result.text,
            meta: result.meta
        });
    }

    async openLogFile() {
        const filePath = this.getLogFilePath();
        try {
            if (!fs.existsSync(filePath)) {
                vscode.window.showInformationMessage('Log file not found yet. Turn Multi Purpose Agent ON first.');
                return;
            }
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            await vscode.window.showTextDocument(doc, { preview: false });
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to open log file: ${e.message}`);
        }
    }

    clearLogs() {
        const filePath = this.getLogFilePath();
        try {
            fs.writeFileSync(filePath, '', 'utf8');
        } catch (e) { }
        this.sendLogs(300);
    }

    /**
     * Debug UI Bridge - Handles UI automation commands from the debug server.
     * Sends commands to the WebView for execution and returns results.
     * @param {object} action - The UI action to perform
     */
    handleDebugUIAction(action) {
        // SECURITY: Only allow if Debug Mode is enabled in settings
        const debugEnabled = vscode.workspace.getConfiguration('auto-accept.debugMode').get('enabled', false);
        if (!debugEnabled) {
            console.warn('[SettingsPanel] Blocked debugUIAction: Debug Mode is disabled.');
            return;
        }

        // Forward the action to the webview for execution
        // The webview will handle clicking, reading values, etc.
        this.panel.webview.postMessage({
            command: 'executeDebugUIAction',
            action: action
        });
    }

    /**
     * Handle results from WebView UI actions
     * @param {object} result - Result from the webview
     */
    handleDebugUIResult(result) {
        // Store result for retrieval by debug server
        this._lastUIResult = result;
    }

    /**
     * Get the last UI action result (called by debug server)
     */
    getLastUIResult() {
        const result = this._lastUIResult;
        this._lastUIResult = null;
        return result;
    }

    update() {
        this.panel.webview.html = this.getHtmlContent();
        setTimeout(() => {
            this.sendStats();
            this.sendROIStats();
            this.sendSchedule();
            this.sendLogs(300);
        }, 100);
    }

    getHtmlContent() {
        const css = `
            * { box-sizing: border-box; }
            :root {

                --bg: #070b14;
                --card-bg: #0d1324;
                --border: rgba(148, 163, 184, 0.16);
                --border-hover: rgba(56, 189, 248, 0.32);
                --accent: #38bdf8;
                --accent-soft: rgba(56, 189, 248, 0.12);
                --green: #34d399;
                --green-soft: rgba(52, 211, 153, 0.14);
                --danger: #fb7185;
                --danger-soft: rgba(251, 113, 133, 0.14);
                --fg: #e7eefc;
                --fg-dim: rgba(231, 238, 252, 0.68);
                --font: 'Segoe UI', system-ui, -apple-system, sans-serif;
                --shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
                --radius-sm: 8px;
                --radius-md: 12px;
                --radius-lg: 16px;
            }

            /* Prompt List Styles */
            .prompt-list-container {
                background: rgba(255,255,255,0.03);
                border: 1px solid var(--border);
                border-radius: var(--radius-md);
                padding: 14px;
                margin-bottom: 12px;
            }
            .prompt-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-bottom: 12px;
                max-height: 300px;
                overflow-y: auto;
            }
            .prompt-item {
                display: flex;
                align-items: center;
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.06);
                border-radius: var(--radius-sm);
                padding: 10px;
                transition: all 0.2s;
            }
            .prompt-item:hover {
                background: rgba(255,255,255,0.05);
                border-color: var(--border);
            }
            .prompt-item.dragging {
                opacity: 0.5;
                background: var(--accent-soft);
                border-color: var(--accent);
            }
            .prompt-handle {
                cursor: grab;
                opacity: 0.4;
                padding: 4px 8px;
                font-size: 16px;
                user-select: none;
            }
            .prompt-handle:hover {
                opacity: 0.8;
                color: var(--accent);
            }
            .prompt-content {
                flex: 1;
                font-size: 13px;
                margin: 0 8px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .prompt-delete {
                cursor: pointer;
                opacity: 0.4;
                padding: 4px 8px;
                color: #ef4444;
                font-size: 16px;
                border-radius: 4px;
            }
            .prompt-delete:hover {
                opacity: 1;
                background: rgba(239, 68, 68, 0.1);
            }
            .prompt-add-row {
                display: flex;
                gap: 8px;
            }
            .prompt-input {
                flex: 1;
                background: rgba(255,255,255,0.04);
                border: 1px solid var(--border);
                color: var(--fg);
                padding: 10px 12px;
                border-radius: var(--radius-sm);
                font-size: 13px;
            }
            .prompt-input:focus {
                outline: none;
                border-color: var(--accent);
            }
            .prompt-empty {
                text-align: center;
                padding: 20px;
                font-size: 12px;
                opacity: 0.5;
                border: 1px dashed var(--border);
                border-radius: 6px;
            }

            body {
                font-family: var(--font);
                background: radial-gradient(900px 500px at 50% -10%, rgba(56, 189, 248, 0.16), transparent 60%),
                            radial-gradient(900px 500px at 0% 30%, rgba(52, 211, 153, 0.08), transparent 55%),
                            var(--bg);
                color: var(--fg);
                margin: 0;
                padding: 32px 24px;
                display: flex;
                flex-direction: column;
                align-items: center;
                min-height: 100vh;
            }

            .container {
                max-width: 760px;
                width: 100%;
                display: flex;
                flex-direction: column;
                gap: 20px;
            }

            /* Header Section */
            .header {
                text-align: center;
                margin-bottom: 8px;
            }
            .header h1 {
                font-size: 30px;
                font-weight: 800;
                margin: 0;
                letter-spacing: -0.5px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
            }
            .badge {
                background: var(--accent);
                color: white;
                font-size: 11px;
                padding: 4px 10px;
                border-radius: 999px;
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: 1px;
                box-shadow: 0 0 0 1px rgba(255,255,255,0.12), 0 12px 26px rgba(0,0,0,0.4);
            }
            .subtitle {
                color: var(--fg-dim);
                font-size: 14px;
                margin-top: 8px;
            }

            /* Sections */
            .section {
                background: var(--card-bg);
                border: 1px solid var(--border);
                border-radius: var(--radius-lg);
                padding: 26px;
                transition: border-color 0.3s ease;
                box-shadow: var(--shadow);
            }
            .section:hover {
                border-color: var(--border-hover);
            }
            .section-label {
                color: var(--accent);
                font-size: 12px;
                font-weight: 800;
                letter-spacing: 1px;
                text-transform: uppercase;
                margin-bottom: 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            /* Impact Grid */
            .impact-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 14px;
            }
            .impact-card {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: var(--radius-md);
                padding: 18px 14px;
                text-align: center;
                transition: transform 0.2s ease;
            }
            .impact-card:hover {
                transform: translateY(-2px);
            }
            .stat-val {
                font-size: 32px;
                font-weight: 800;
                line-height: 1;
                margin-bottom: 8px;
                font-variant-numeric: tabular-nums;
            }
            .stat-label {
                font-size: 11px;
                color: var(--fg-dim);
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            /* Inputs and Buttons */
            input[type="range"] {
                width: 100%;
                accent-color: var(--accent);
                height: 6px;
                border-radius: 3px;
                background: rgba(255,255,255,0.1);
            }
            textarea {
                width: 100%;
                min-height: 140px;
                background: rgba(255,255,255,0.04);
                border: 1px solid var(--border);
                border-radius: var(--radius-md);
                color: var(--fg);
                font-family: 'JetBrains Mono', 'Fira Code', monospace;
                font-size: 13px;
                padding: 14px;
                resize: vertical;
                outline: none;
            }
            textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }

            .btn-primary {
                background: var(--accent);
                color: white;
                border: none;
                padding: 12px 16px;
                border-radius: var(--radius-md);
                font-weight: 700;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                text-decoration: none;
            }
            .btn-primary:hover {
                filter: brightness(1.2);
                transform: scale(1.01);
            }
            .btn-outline {
                background: transparent;
                border: 1px solid var(--border);
                color: var(--fg);
                padding: 10px 14px;
                border-radius: var(--radius-md);
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .btn-outline:hover {
                background: var(--accent-soft);
                border-color: var(--accent);
            }
            .btn-danger {
                background: transparent;
                border: 1px solid rgba(251, 113, 133, 0.35);
                color: var(--danger);
                padding: 10px 14px;
                border-radius: var(--radius-md);
                font-size: 13px;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .btn-danger:hover {
                background: var(--danger-soft);
                border-color: rgba(251, 113, 133, 0.55);
            }

            .link-secondary {
                color: var(--accent);
                cursor: pointer;
                text-decoration: none;
                font-size: 13px;
                display: block;
                text-align: center;
                margin-top: 16px;
            }
            .link-secondary:hover { text-decoration: underline; }

            .locked {
                opacity: 0.5;
                pointer-events: none;
                filter: grayscale(1);
            }

            /* Toggle Switch */
            .switch { position: relative; display: inline-block; width: 46px; height: 24px; }
            .switch input { opacity: 0; width: 0; height: 0; }
            .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(255,255,255,0.12); transition: .2s; border-radius: 999px; border: 1px solid rgba(255,255,255,0.08); }
            .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 2px; bottom: 2px; background-color: rgba(255,255,255,0.92); transition: .2s; border-radius: 50%; }
            input:checked + .slider { background-color: var(--accent); }
            input:checked + .slider:before { transform: translateX(22px); }
        `;

        // Settings Mode
        return `<!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><style>${css}</style></head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Multi Purpose <span class="badge">Agent</span></h1>
                    <div class="subtitle">Multi-agent automation for Antigravity</div>
                </div>

                <div class="section">
                    <div class="section-label">
                        <span>📊 IMPACT DASHBOARD</span>
                        <span style="opacity: 0.4;">Resets Sunday</span>
                    </div>
                    <div class="impact-grid">
                        <div class="impact-card" style="border-bottom: 2px solid var(--green);">
                            <div class="stat-val" id="roiClickCount" style="color: var(--green);">0</div>
                            <div class="stat-label">Clicks Saved</div>
                        </div>
                        <div class="impact-card">
                            <div class="stat-val" id="roiTimeSaved">0m</div>
                            <div class="stat-label">Time Saved</div>
                        </div>
                        <div class="impact-card">
                            <div class="stat-val" id="roiSessionCount">0</div>
                            <div class="stat-label">Sessions</div>
                        </div>
                        <div class="impact-card">
                            <div class="stat-val" id="roiBlockedCount" style="opacity: 0.4;">0</div>
                            <div class="stat-label">Blocked</div>
                        </div>
                    </div>
                </div>

                <div class="section" id="performanceSection">
                    <div class="section-label">
                        <span>⚡ Performance Mode</span>
                        <span class="val-display" id="freqVal" style="color: var(--accent);">...</span>
                    </div>
                    <div>
                        <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 12px; opacity: 0.5;">Instant</span>
                            <div style="flex: 1;"><input type="range" id="freqSlider" min="200" max="3000" step="100" value="1000"></div>
                            <span style="font-size: 12px; opacity: 0.5;">Battery Saving</span>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <div class="section-label">📋 Prompt Queue</div>
                    <div>
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                            <span style="font-size: 13px;">Enable Scheduler</span>
                            <label class="switch">
                                <input type="checkbox" id="scheduleEnabled">
                                <span class="slider round"></span>
                            </label>
                        </div>
                        
                        <div id="scheduleControls" style="opacity: 0.5; pointer-events: none; transition: opacity 0.3s;">
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                                <div>
                                    <label style="font-size: 11px; color: var(--fg-dim); display: block; margin-bottom: 4px;">Mode</label>
                                    <select id="scheduleMode" style="width: 100%; background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--fg); padding: 10px 12px; border-radius: 10px;">
                                        <option value="interval">Interval (Every X min)</option>
                                        <option value="daily">Daily (At HH:MM)</option>
                                        <option value="queue" selected>Queue (Sequential)</option>
                                    </select>
                                </div>
                                <div>
                                    <label style="font-size: 11px; color: var(--fg-dim); display: block; margin-bottom: 4px;">Value / Timeout</label>
                                    <input type="text" id="scheduleValue" placeholder="30" style="width: 100%; background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--fg); padding: 10px 12px; border-radius: 10px;">
                                </div>
                            </div>
                            
                            <!-- Single prompt for interval/daily modes -->
                            <div id="singlePromptSection" style="margin-bottom: 12px;">
                                <label style="font-size: 11px; color: var(--fg-dim); display: block; margin-bottom: 4px;">Prompt Message</label>
                                <textarea id="schedulePrompt" style="min-height: 60px;" placeholder="Status report please"></textarea>
                            </div>

                            <!-- Queue mode section -->
                            <div id="queueModeSection" style="display: none;">
                                <div style="margin-bottom: 12px;">
                                    <label style="font-size: 11px; color: var(--fg-dim); display: block; margin-bottom: 4px;">Prompt Queue</label>
                                    <div class="prompt-list-container">
                                        <div id="promptList" class="prompt-list">
                                            <!-- Prompts will be added here -->
                                            <div class="prompt-empty">Queue is empty</div>
                                        </div>
                                        <div class="prompt-add-row">
                                            <input type="text" id="newPromptInput" class="prompt-input" placeholder="Enter a new task..." />
                                            <button id="addPromptBtn" class="btn-primary" style="padding: 0 16px;">Add</button>
                                        </div>
                                    </div>
                                </div>
                                
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                                    <div>
                                        <label style="font-size: 11px; color: var(--fg-dim); display: block; margin-bottom: 4px;">Queue Behavior</label>
                                        <select id="queueMode" style="width: 100%; background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--fg); padding: 10px 12px; border-radius: 10px;">
                                            <option value="consume">Consume (Remove after use)</option>
                                            <option value="loop">Loop (Cycle forever)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style="font-size: 11px; color: var(--fg-dim); display: block; margin-bottom: 4px;">Silence Timeout (s)</label>
                                        <input type="number" id="silenceTimeout" value="30" min="10" max="300" style="width: 100%; background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--fg); padding: 10px 12px; border-radius: 10px;">
                                    </div>
                                </div>
                                
                                <!-- Target Conversation -->
                                <div style="margin-bottom: 12px;">
                                    <label style="font-size: 11px; color: var(--fg-dim); display: block; margin-bottom: 4px;">Target Conversation</label>
                                    <select id="targetConversation" style="width: 100%; background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--fg); padding: 10px 12px; border-radius: 10px;">
                                        <option value="">Current (Active Tab)</option>
                                        <!-- Options populated dynamically -->
                                    </select>
                                    <div style="font-size: 10px; color: var(--fg-dim); margin-top: 4px;">
                                        Select which conversation receives the queue prompts. Will wait if conversation is busy.
                                    </div>
                                </div>

                                <!-- Check Prompt Section -->
                                <div style="background: rgba(255,255,255,0.03); border-radius: 12px; padding: 14px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.06);">
                                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                        <span style="font-size: 12px;">Enable Check Prompt</span>
                                        <label class="switch">
                                            <input type="checkbox" id="checkPromptEnabled">
                                            <span class="slider round"></span>
                                        </label>
                                    </div>
                                    <div style="font-size: 10px; color: var(--fg-dim); margin-bottom: 8px;">
                                        Runs after each task to verify implementation quality.
                                    </div>
                                    <textarea id="checkPromptText" style="min-height: 80px; font-size: 11px;" placeholder="Make sure the previous task was implemented fully..."></textarea>
                                </div>

                                <!-- Resume on Quota Reset -->
                                <div style="background: rgba(255,255,255,0.03); border-radius: 12px; padding: 14px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.06);">
                                    <div style="display: flex; align-items: center; justify-content: space-between;">
                                        <span style="font-size: 12px;">Resume on Quota Reset</span>
                                        <label class="switch">
                                            <input type="checkbox" id="resumeEnabled" checked>
                                            <span class="slider round"></span>
                                        </label>
                                    </div>
                                    <div style="font-size: 10px; color: var(--fg-dim); margin-top: 8px;">
                                        Automatically resumes the queue when your quota becomes available again.
                                    </div>
                                </div>
                                


                                <!-- Queue Status Indicator -->
                                <div id="queueStatusIndicator" style="text-align: center; padding: 12px; margin-bottom: 12px; border-radius: 12px; font-size: 12px; background: rgba(255,255,255,0.04); border: 1px solid var(--border);">
                                    <span style="opacity: 0.6;">Queue Status:</span> <span id="queueStatusText" style="font-weight: 600;">Not Started</span>
                                    <div id="currentPromptInfo" style="font-size: 10px; margin-top: 6px; opacity: 0.7; display: none;">Current: <span id="currentPromptText">-</span></div>
                                </div>

                                <!-- Queue Control Buttons -->
                                <div id="queueControlBtns" style="display: none; gap: 8px; margin-bottom: 12px;">
                                    <button id="pauseQueueBtn" class="btn-outline" style="flex: 1; font-size: 12px; padding: 8px;">⏸ Pause</button>
                                    <button id="skipPromptBtn" class="btn-outline" style="flex: 1; font-size: 12px; padding: 8px;">⏭ Skip</button>
                                    <button id="stopQueueBtn" class="btn-danger" style="flex: 1; font-size: 12px; padding: 8px;">⏹ Stop</button>
                                </div>

                                <button id="startQueueBtn" class="btn-primary" style="width: 100%; background: var(--green);">
                                    ▶ Save & Run Queue
                                </button>
                                
                                <!-- Prompt History -->
                                <div style="margin-top: 16px; border-top: 1px solid var(--border); padding-top: 12px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <label style="font-size: 11px; color: var(--fg-dim);">Recent Prompts</label>
                                        <button id="refreshHistoryBtn" style="padding: 6px 10px; font-size: 11px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--fg); border-radius: 10px; cursor: pointer;">↻ Refresh</button>
                                    </div>
                                    <div id="promptHistoryList" style="max-height: 120px; overflow-y: auto; font-size: 12px; background: rgba(255,255,255,0.03); border-radius: 12px; padding: 10px; border: 1px solid rgba(255,255,255,0.06);">
                                        <div style="opacity: 0.5; text-align: center;">No prompts sent yet</div>
                                    </div>
                                </div>
                            </div>

                            <!-- Save Schedule button - hidden in queue mode -->
                            <div id="saveScheduleContainer">
                                <button id="saveScheduleBtn" class="btn-primary" style="width: 100%;">Save Schedule</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <div class="section-label">🛡️ Safety Rules</div>
                        Patterns that will NEVER be auto-accepted.

                    <textarea id="bannedCommandsInput" 
                        placeholder="rm -rf /&#10;format c:&#10;del /f /s /q"
                        ></textarea>
                    
                    <div style="display: flex; gap: 12px; margin-top: 20px;">
                        <button id="saveBannedBtn" class="btn-primary" style="flex: 2;">
                            Update Rules
                        </button>
                        <button id="resetBannedBtn" class="btn-outline" style="flex: 1;">
                            Reset
                        </button>
                    </div>
                    <div id="bannedStatus" style="font-size: 12px; margin-top: 12px; text-align: center; height: 18px;"></div>
                </div>

                <div class="section">
                    <div class="section-label">📊 Antigravity Quota</div>
                    <div style="font-size: 13px; opacity: 0.6; margin-bottom: 16px; line-height: 1.5;">
                        Monitor your AI model quotas and credits. Shows usage in the status bar.
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                        <span style="font-size: 13px;">Show Quota in Status Bar</span>
                        <label class="switch">
                            <input type="checkbox" id="antigravityQuotaEnabled" checked>
                            <span class="slider round"></span>
                        </label>
                    </div>
                    <div style="display: flex; align-items: start; gap: 8px; margin-bottom: 16px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 12px;">
                        <div style="padding-top: 2px;">
                            <label class="switch" style="transform: scale(0.8); margin: 0;">
                                <input type="checkbox" id="autoContinueEnabled">
                                <span class="slider round"></span>
                            </label>
                        </div>
                        <div>
                            <div style="font-size: 11px;">Auto-Continue Conversation</div>
                            <div style="font-size: 10px; color: var(--fg-dim); margin-top: 2px;">
                                Automatically sends "Continue" to the chat when quota refreshes. Independent of queue.
                            </div>
                        </div>
                    </div>
                    
                    <div id="quotaStatusContainer" style="background: rgba(255,255,255,0.03); border-radius: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid rgba(255,255,255,0.06);">
                        <div id="quotaStatusContent" style="text-align: center; font-size: 13px; opacity: 0.6;">
                            Click refresh to check quota status
                        </div>
                    </div>
                    <button id="refreshQuotaBtn" class="btn-outline" style="width: 100%;">
                        Refresh Quota Status
                    </button>
                </div>

                <div class="section">
                    <div class="section-label">🔌 CDP Port</div>
                    <div style="font-size: 13px; opacity: 0.6; margin-bottom: 16px; line-height: 1.5;">
                        Chrome DevTools Protocol port for browser automation. Must match the --remote-debugging-port flag used when launching Antigravity.
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <input type="number" id="cdpPortInput" min="1024" max="65535" value="9004" 
                               style="width: 100px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--fg); padding: 8px 12px; border-radius: var(--radius-sm); font-size: 14px;">
                        <button id="saveCdpPortBtn" class="btn-outline" style="padding: 8px 16px;">Save Port</button>
                        <span id="cdpPortStatus" style="font-size: 12px; opacity: 0.6;"></span>
                    </div>
                </div>

                <div class="section">
                    <div class="section-label">
                        <span>🔧 Debug Mode</span>
                        <span id="debugBadge" class="badge" style="background:#ef4444; font-size: 10px; padding: 2px 6px;">ACTIVE</span>
                    </div>
                    <div style="font-size: 13px; opacity: 0.6; margin-bottom: 16px; line-height: 1.5;">
                        Enable programmatic control of this extension via commands. This allows AI agents to interact with settings directly.
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 13px;">Enable Debug Mode</span>
                        <label class="switch">
                            <input type="checkbox" id="debugModeEnabled">
                            <span class="slider round"></span>
                        </label>
                    </div>
                </div>

                <div class="section">
                    <div class="section-label">⚙️ Danger Zone</div>
                    <div style="font-size: 13px; opacity: 0.6; margin-bottom: 16px;">
                        Reset all settings and data. Useful if you want to uninstall or start fresh.
                    </div>
                    <button id="resetAllBtn" class="btn-outline" style="width: 100%; color: #ef4444; border-color: rgba(239, 68, 68, 0.3);">
                        Reset All Settings & Data
                    </button>
                </div>

                <div class="section">
                    <div class="section-label">🧾 Logs</div>
                    <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                        <select id="logTailSelect" style="flex: 1; background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--fg); padding: 10px 12px; border-radius: 10px;">
                            <option value="200">Last 200 lines</option>
                            <option value="300" selected>Last 300 lines</option>
                            <option value="500">Last 500 lines</option>
                            <option value="1000">Last 1000 lines</option>
                        </select>
                        <button id="refreshLogsBtn" class="btn-outline" style="flex: 1;">Refresh</button>
                        <button id="copyLogsBtn" class="btn-outline" style="flex: 1;">Copy</button>
                    </div>
                    <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                        <button id="openLogsBtn" class="btn-primary" style="flex: 2;">Open File</button>
                        <button id="clearLogsBtn" class="btn-outline" style="flex: 1;">Clear</button>
                    </div>
                    <textarea id="logsOutput" readonly style="min-height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;"></textarea>
                    <div id="logsMeta" style="font-size: 11px; color: var(--fg-dim); margin-top: 10px;"></div>
                </div>

            </div>

            <script>
                const vscode = acquireVsCodeApi();
                
                // --- Polling Logic for Real-time Refresh ---
                function refreshStats() {
                    vscode.postMessage({ command: 'getStats' });
                    vscode.postMessage({ command: 'getROIStats' });
                    vscode.postMessage({ command: 'getQueueStatus' });
                    vscode.postMessage({ command: 'getConversations' });
                    vscode.postMessage({ command: 'getPromptHistory' });
                }
                
                // Refresh every 5 seconds while panel is open
                const refreshInterval = setInterval(refreshStats, 5000);
                
                // --- Event Listeners ---
                const slider = document.getElementById('freqSlider');
                const valDisplay = document.getElementById('freqVal');
                
                if (slider) {
                    slider.addEventListener('input', (e) => {
                         const s = (e.target.value/1000).toFixed(1) + 's';
                         valDisplay.innerText = s;
                         vscode.postMessage({ command: 'setFrequency', value: e.target.value });
                    });
                }

                // Debug Mode Toggle
                const debugModeCheckbox = document.getElementById('debugModeEnabled');
                const debugBadge = document.getElementById('debugBadge');
                if (debugModeCheckbox) {
                    debugModeCheckbox.addEventListener('change', (e) => {
                        vscode.postMessage({ command: 'setDebugMode', value: e.target.checked });
                        if (debugBadge) {
                            debugBadge.style.display = e.target.checked ? 'inline' : 'none';
                        }
                    });
                }
                // Request initial debug mode state
                vscode.postMessage({ command: 'getDebugMode' });

                // CDP Port Configuration
                const cdpPortInput = document.getElementById('cdpPortInput');
                const saveCdpPortBtn = document.getElementById('saveCdpPortBtn');
                const cdpPortStatus = document.getElementById('cdpPortStatus');
                
                if (saveCdpPortBtn && cdpPortInput) {
                    saveCdpPortBtn.addEventListener('click', () => {
                        const port = parseInt(cdpPortInput.value, 10);
                        if (port >= 1024 && port <= 65535) {
                            vscode.postMessage({ command: 'setCdpPort', value: port });
                            cdpPortStatus.textContent = 'Saved! Restart required.';
                            cdpPortStatus.style.color = '#34d399';
                            setTimeout(() => { cdpPortStatus.textContent = ''; }, 3000);
                        } else {
                            cdpPortStatus.textContent = 'Invalid port (1024-65535)';
                            cdpPortStatus.style.color = '#fb7185';
                        }
                    });
                }
                // Request initial CDP port value
                vscode.postMessage({ command: 'getCdpPort' });

                const bannedInput = document.getElementById('bannedCommandsInput');
                const saveBannedBtn = document.getElementById('saveBannedBtn');
                const resetBannedBtn = document.getElementById('resetBannedBtn');
                const bannedStatus = document.getElementById('bannedStatus');

                const defaultBannedCommands = ["rm -rf /", "rm -rf ~", "rm -rf *", "format c:", "del /f /s /q", "rmdir /s /q", ":(){:|:&};:", "dd if=", "mkfs.", "> /dev/sda", "chmod -R 777 /"];

                if (saveBannedBtn) {
                    saveBannedBtn.addEventListener('click', () => {
                        const lines = bannedInput.value.split('\\n').map(l => l.trim()).filter(l => l.length > 0);
                        vscode.postMessage({ command: 'updateBannedCommands', commands: lines });
                        bannedStatus.innerText = '✓ Safety Rules Updated';
                        bannedStatus.style.color = 'var(--green)';
                        setTimeout(() => { bannedStatus.innerText = ''; }, 3000);
                    });
                }

                if (resetBannedBtn) {
                    resetBannedBtn.addEventListener('click', () => {
                        bannedInput.value = defaultBannedCommands.join('\\n');
                        vscode.postMessage({ command: 'updateBannedCommands', commands: defaultBannedCommands });
                        bannedStatus.innerText = '✓ Defaults Restored';
                        bannedStatus.style.color = 'var(--accent)';
                        setTimeout(() => { bannedStatus.innerText = ''; }, 3000);
                    });
                }

                // --- Schedule Logic ---
                let currentPrompts = []; // State for prompts

                const scheduleEnabled = document.getElementById('scheduleEnabled');
                const scheduleControls = document.getElementById('scheduleControls');
                const scheduleMode = document.getElementById('scheduleMode');
                const scheduleValue = document.getElementById('scheduleValue');
                const schedulePrompt = document.getElementById('schedulePrompt');
                const singlePromptSection = document.getElementById('singlePromptSection');
                const queueModeSection = document.getElementById('queueModeSection');
                
                // New Prompt UI Elements
                const promptList = document.getElementById('promptList');
                const newPromptInput = document.getElementById('newPromptInput');
                const addPromptBtn = document.getElementById('addPromptBtn');

                const queueModeSelect = document.getElementById('queueMode');
                const silenceTimeoutInput = document.getElementById('silenceTimeout');
                const checkPromptEnabled = document.getElementById('checkPromptEnabled');
                const checkPromptText = document.getElementById('checkPromptText');
                const resumeEnabled = document.getElementById('resumeEnabled');
                const autoContinueEnabled = document.getElementById('autoContinueEnabled');
                const startQueueBtn = document.getElementById('startQueueBtn');
                const saveScheduleBtn = document.getElementById('saveScheduleBtn');

                // Render List
                function renderPrompts() {
                    if (!promptList) return;
                    promptList.innerHTML = '';
                    if (currentPrompts.length === 0) {
                        promptList.innerHTML = '<div class="prompt-empty">Queue is empty</div>';
                        return;
                    }

                    currentPrompts.forEach((text, index) => {
                        const item = document.createElement('div');
                        item.className = 'prompt-item';
                        item.draggable = true;
                        item.dataset.index = index;
                        item.innerHTML = \`
                            <div class="prompt-handle">☰</div>
                            <div class="prompt-content">\${text}</div>
                            <div class="prompt-delete" title="Remove">×</div>
                        \`;
                        
                        // Delete Handler
                        item.querySelector('.prompt-delete').onclick = (e) => {
                            e.stopPropagation();
                            currentPrompts.splice(index, 1);
                            renderPrompts();
                        };

                        // Drag Events
                        item.addEventListener('dragstart', handleDragStart);
                        item.addEventListener('dragover', handleDragOver);
                        item.addEventListener('drop', handleDrop);
                        item.addEventListener('dragend', handleDragEnd);

                        promptList.appendChild(item);
                    });
                }

                // Add Prompt Handler
                function addNewPrompt() {
                    if (!newPromptInput) return;
                    const text = newPromptInput.value.trim();
                    if (text) {
                        currentPrompts.push(text);
                        newPromptInput.value = '';
                        renderPrompts();
                    }
                }

                if (addPromptBtn) addPromptBtn.addEventListener('click', addNewPrompt);
                if (newPromptInput) {
                    newPromptInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') addNewPrompt();
                    });
                }

                // Drag & Drop Handlers
                let dragSrcEl = null;
                function handleDragStart(e) {
                    dragSrcEl = this;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', this.dataset.index);
                    this.classList.add('dragging');
                }
                function handleDragOver(e) {
                    if (e.preventDefault) e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    return false;
                }
                function handleDrop(e) {
                    if (e.stopPropagation) e.stopPropagation();
                    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                    const toIndex = parseInt(this.dataset.index);
                    if (dragSrcEl !== this && !isNaN(fromIndex) && !isNaN(toIndex)) {
                        const item = currentPrompts.splice(fromIndex, 1)[0];
                        currentPrompts.splice(toIndex, 0, item);
                        renderPrompts();
                    }
                    return false;
                }
                function handleDragEnd(e) {
                    this.classList.remove('dragging');
                }

                const saveScheduleContainer = document.getElementById('saveScheduleContainer');
                const queueStatusText = document.getElementById('queueStatusText');
                const targetConversationSelect = document.getElementById('targetConversation');
                const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
                const promptHistoryList = document.getElementById('promptHistoryList');

                // Target Conversation change handler
                if (targetConversationSelect) {
                    targetConversationSelect.addEventListener('change', (e) => {
                        vscode.postMessage({ command: 'setTargetConversation', value: e.target.value });
                    });
                }

                // Refresh History button
                if (refreshHistoryBtn) {
                    refreshHistoryBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'getPromptHistory' });
                        vscode.postMessage({ command: 'getConversations' });
                    });
                }

                function updateModeVisibility() {
                    const mode = scheduleMode ? scheduleMode.value : 'interval';
                    if (singlePromptSection) singlePromptSection.style.display = mode === 'queue' ? 'none' : 'block';
                    if (queueModeSection) queueModeSection.style.display = mode === 'queue' ? 'block' : 'none';
                    // Hide Save Schedule button in queue mode (Save & Run Queue handles it)
                    if (saveScheduleContainer) saveScheduleContainer.style.display = mode === 'queue' ? 'none' : 'block';
                }

                if (scheduleEnabled) {
                    scheduleEnabled.addEventListener('change', (e) => {
                        const enabled = e.target.checked;
                        if(scheduleControls) {
                            scheduleControls.style.opacity = enabled ? '1' : '0.5';
                            scheduleControls.style.pointerEvents = enabled ? 'auto' : 'none';
                        }
                    });
                }

                if (scheduleMode) scheduleMode.addEventListener('change', updateModeVisibility);

                // Debug helper
                function logDebug(msg) {
                    console.log('[SettingsClient] ' + msg);
                    // Optional: send to extension to print in debug console
                    // vscode.postMessage({ command: 'log', message: msg });
                }

                if (startQueueBtn) {
                     startQueueBtn.addEventListener('click', (e) => {
                         e.preventDefault();
                         e.stopPropagation();
                        
                        // Ignore programmatic clicks (e.g., debug UI automation) to prevent accidental/looped starts
                        if (e.isTrusted === false) {
                            console.warn('StartQueue: Ignored untrusted click event');
                            return;
                        }
                         
                        if (startQueueBtn.disabled) return;
                        const originalText = startQueueBtn.innerText;

                        // DEFENSIVE: Prevent "Cannot start queue without prompts" error loop
                        // If queue is empty, BLOCK immediately with visual feedback only.
                        if (currentPrompts.length === 0) {
                            console.log('StartQueue: Queue empty, silent block.');
                            
                            // Show error on button without sending message
                            startQueueBtn.innerText = '⚠️ Queue is Empty!';
                            startQueueBtn.style.color = '#ef4444';
                            startQueueBtn.style.borderColor = '#ef4444';
                            
                            setTimeout(() => {
                                startQueueBtn.innerText = originalText;
                                startQueueBtn.style.color = '';
                                startQueueBtn.style.borderColor = '';
                                startQueueBtn.disabled = false;
                            }, 2000);
                            
                            return; // STOP EXECUTION HERE
                        }
                         
                        // Visual feedback
                        startQueueBtn.innerText = '⏳ Saving & Starting...';
                        startQueueBtn.disabled = true;
                        startQueueBtn.style.opacity = '0.7';
                        startQueueBtn.style.cursor = 'wait';
                         
                        // Save settings first, then start queue
                        const schedule = {
                            enabled: scheduleEnabled ? scheduleEnabled.checked : true,
                            mode: scheduleMode ? scheduleMode.value : 'queue',
                            value: scheduleValue ? scheduleValue.value : '30',
                            prompt: schedulePrompt ? schedulePrompt.value : '',
                            prompts: currentPrompts,
                            queueMode: queueModeSelect ? queueModeSelect.value : 'consume',
                            silenceTimeout: silenceTimeoutInput ? parseInt(silenceTimeoutInput.value) : 30,
                            checkPromptEnabled: checkPromptEnabled ? checkPromptEnabled.checked : false,
                            checkPromptText: checkPromptText ? checkPromptText.value : '',
                            resumeEnabled: resumeEnabled ? resumeEnabled.checked : true,
                            autoContinueEnabled: autoContinueEnabled ? autoContinueEnabled.checked : false
                        };

                        vscode.postMessage({
                            command: 'saveAndStartQueue',
                            schedule: schedule
                        });
 
                        setTimeout(() => { 
                            startQueueBtn.innerText = originalText;
                            startQueueBtn.disabled = false;
                            startQueueBtn.style.opacity = '1';
                            startQueueBtn.style.cursor = 'pointer';
                        }, 2500);
                    });
                }
                
                if (resumeEnabled) {
                     resumeEnabled.addEventListener('change', (e) => {
                        vscode.postMessage({ command: 'setResumeEnabled', value: e.target.checked });
                    });
                }

                if (autoContinueEnabled) {
                     autoContinueEnabled.addEventListener('change', (e) => {
                        vscode.postMessage({ command: 'setAutoContinue', value: e.target.checked });
                    });
                }

                // Queue Control Button Handlers
                const pauseQueueBtn = document.getElementById('pauseQueueBtn');
                const skipPromptBtn = document.getElementById('skipPromptBtn');
                const stopQueueBtn = document.getElementById('stopQueueBtn');

                if (pauseQueueBtn) {
                    pauseQueueBtn.addEventListener('click', () => {
                        const isPaused = pauseQueueBtn.textContent.includes('Resume');
                        vscode.postMessage({ command: isPaused ? 'resumeQueue' : 'pauseQueue' });
                    });
                }

                if (skipPromptBtn) {
                    skipPromptBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'skipPrompt' });
                    });
                }

                if (stopQueueBtn) {
                    stopQueueBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'stopQueue' });
                    });
                }

                if (saveScheduleBtn) {
                    saveScheduleBtn.addEventListener('click', () => {
                        vscode.postMessage({
                            command: 'updateSchedule',
                            enabled: scheduleEnabled ? scheduleEnabled.checked : true,
                            mode: scheduleMode ? scheduleMode.value : 'interval',
                            value: scheduleValue ? scheduleValue.value : '30',
                            prompt: schedulePrompt ? schedulePrompt.value : '',
                            
                            // Queue specific (using currentPrompts array)
                            prompts: currentPrompts,
                            queueMode: queueModeSelect ? queueModeSelect.value : 'consume',
                            silenceTimeout: silenceTimeoutInput ? parseInt(silenceTimeoutInput.value) : 30,
                            checkPromptEnabled: checkPromptEnabled ? checkPromptEnabled.checked : false,
                            checkPromptText: checkPromptText ? checkPromptText.value : '',
                            resumeEnabled: resumeEnabled ? resumeEnabled.checked : true,
                            autoContinueEnabled: autoContinueEnabled ? autoContinueEnabled.checked : false
                        });
                        const originalText = saveScheduleBtn.innerText;
                        saveScheduleBtn.innerText = '✓ Saved';
                        saveScheduleBtn.style.background = 'var(--green)';
                        setTimeout(() => {
                            saveScheduleBtn.innerText = originalText;
                            saveScheduleBtn.style.background = 'var(--accent)';
                        }, 2000);
                    });
                }

                // Initial visibility update
                updateModeVisibility();

                const logsOutput = document.getElementById('logsOutput');
                const logsMeta = document.getElementById('logsMeta');
                const refreshLogsBtn = document.getElementById('refreshLogsBtn');
                const copyLogsBtn = document.getElementById('copyLogsBtn');
                const openLogsBtn = document.getElementById('openLogsBtn');
                const clearLogsBtn = document.getElementById('clearLogsBtn');
                const logTailSelect = document.getElementById('logTailSelect');

                function requestLogs() {
                    const tailLines = logTailSelect ? logTailSelect.value : 300;
                    vscode.postMessage({ command: 'getLogs', tailLines });
                }

                if (refreshLogsBtn) refreshLogsBtn.addEventListener('click', requestLogs);
                if (openLogsBtn) openLogsBtn.addEventListener('click', () => vscode.postMessage({ command: 'openLogFile' }));
                if (clearLogsBtn) clearLogsBtn.addEventListener('click', () => vscode.postMessage({ command: 'clearLogs' }));
                if (logTailSelect) logTailSelect.addEventListener('change', requestLogs);

                // --- Reset Logic ---
                const resetAllBtn = document.getElementById('resetAllBtn');
                if (resetAllBtn) {
                    resetAllBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'resetAllSettings' });
                    });
                }

                // --- Antigravity Quota Logic ---
                const antigravityQuotaCheckbox = document.getElementById('antigravityQuotaEnabled');
                const refreshQuotaBtn = document.getElementById('refreshQuotaBtn');
                const quotaStatusContent = document.getElementById('quotaStatusContent');

                if (antigravityQuotaCheckbox) {
                    antigravityQuotaCheckbox.addEventListener('change', (e) => {
                        vscode.postMessage({ command: 'setAntigravityQuota', value: e.target.checked });
                    });
                }

                if (refreshQuotaBtn) {
                    refreshQuotaBtn.addEventListener('click', () => {
                        quotaStatusContent.innerHTML = '<span style="opacity:0.5">Fetching...</span>';
                        vscode.postMessage({ command: 'refreshAntigravityQuota' });
                    });
                }

                // Request initial quota state
                vscode.postMessage({ command: 'getAntigravityQuota' });

                if (copyLogsBtn) {
                    copyLogsBtn.addEventListener('click', async () => {
                        try {
                            const text = logsOutput ? logsOutput.value : '';
                            await navigator.clipboard.writeText(text);
                            const originalText = copyLogsBtn.innerText;
                            copyLogsBtn.innerText = '✓ Copied';
                            copyLogsBtn.style.borderColor = 'var(--green)';
                            copyLogsBtn.style.color = 'var(--green)';
                            setTimeout(() => {
                                copyLogsBtn.innerText = originalText;
                                copyLogsBtn.style.borderColor = 'rgba(255,255,255,0.2)';
                                copyLogsBtn.style.color = 'rgba(255,255,255,0.8)';
                            }, 1500);
                        } catch (e) { }
                    });
                }

                // --- Fancy Count-up Animation ---
                function animateCountUp(element, target, duration = 1200, suffix = '') {
                    const currentVal = parseInt(element.innerText.replace(/[^0-9]/g, '')) || 0;
                    if (currentVal === target && !suffix) return;
                    
                    const startTime = performance.now();
                    function easeOutExpo(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }
                    
                    function update(currentTime) {
                        const elapsed = currentTime - startTime;
                        const progress = Math.min(elapsed / duration, 1);
                        const current = Math.round(currentVal + (target - currentVal) * easeOutExpo(progress));
                        element.innerText = current + suffix;
                        if (progress < 1) requestAnimationFrame(update);
                    }
                    requestAnimationFrame(update);
                }
                
                window.addEventListener('message', e => {
                    const msg = e.data;
                    if (msg.command === 'updateStats') {
                        if (slider) {
                            slider.value = msg.frequency;
                            valDisplay.innerText = (msg.frequency/1000).toFixed(1) + 's';
                        }
                    }
                    if (msg.command === 'updateROIStats') {
                        const roi = msg.roiStats;
                        if (roi) {
                            animateCountUp(document.getElementById('roiClickCount'), roi.clicksThisWeek || 0);
                            animateCountUp(document.getElementById('roiSessionCount'), roi.sessionsThisWeek || 0);
                            animateCountUp(document.getElementById('roiBlockedCount'), roi.blockedThisWeek || 0);
                            document.getElementById('roiTimeSaved').innerText = roi.timeSavedFormatted || '0m';
                        }
                    }
                    if (msg.command === 'updateDebugMode') {
                        if (debugModeCheckbox) {
                            debugModeCheckbox.checked = msg.enabled;
                        }
                        if (debugBadge) {
                            debugBadge.style.display = msg.enabled ? 'inline' : 'none';
                        }
                    }
                    if (msg.command === 'updateCdpPort') {
                        if (cdpPortInput) {
                            cdpPortInput.value = msg.port;
                        }
                    }
                    if (msg.command === 'updateBannedCommands') {
                        if (bannedInput && msg.bannedCommands) {
                            bannedInput.value = msg.bannedCommands.join('\\n');
                        }
                    }
                    if (msg.command === 'updateSchedule') {
                        if (msg.schedule) {
                            // Basic fields
                            if (scheduleEnabled) scheduleEnabled.checked = msg.schedule.enabled;
                            if (scheduleMode) scheduleMode.value = msg.schedule.mode || 'interval';
                            if (scheduleValue) scheduleValue.value = msg.schedule.value || '30';
                            if (schedulePrompt) schedulePrompt.value = msg.schedule.prompt || '';
                            
                            // Queue-specific fields
                            if (msg.schedule.prompts) {
                                currentPrompts = Array.isArray(msg.schedule.prompts) ? msg.schedule.prompts : [];
                                renderPrompts();
                            } else {
                                currentPrompts = [];
                                renderPrompts();
                            }
                            
                            if (queueModeSelect) queueModeSelect.value = msg.schedule.queueMode || 'consume';
                            if (silenceTimeoutInput) silenceTimeoutInput.value = msg.schedule.silenceTimeout || 30;
                            if (checkPromptEnabled) checkPromptEnabled.checked = msg.schedule.checkPromptEnabled || false;
                            if (checkPromptText) checkPromptText.value = msg.schedule.checkPromptText || '';
                            if (checkPromptText) checkPromptText.value = msg.schedule.checkPromptText || '';
                            if (resumeEnabled) resumeEnabled.checked = msg.schedule.resumeEnabled !== false;
                            if (autoContinueEnabled) autoContinueEnabled.checked = msg.schedule.autoContinueEnabled === true;
                            
                            // Trigger visual updates
                            if (scheduleControls) {
                                scheduleControls.style.opacity = msg.schedule.enabled ? '1' : '0.5';
                                scheduleControls.style.pointerEvents = msg.schedule.enabled ? 'auto' : 'none';
                            }
                            
                            // Update mode visibility
                            updateModeVisibility();
                        }
                    }
                    if (msg.command === 'updateLogs') {
                        if (logsOutput) logsOutput.value = msg.logs || '';
                        if (logsMeta) {
                            const meta = msg.meta || {};
                            if (meta.exists === false) {
                                logsMeta.innerText = 'Log file not found yet. Turn Multi Purpose Agent ON to generate logs.';
                            } else if (meta.exists === true) {
                                const kb = meta.size ? Math.round(meta.size / 1024) : 0;
                                logsMeta.innerText = (meta.linesShown || 0) + ' lines • ' + kb + ' KB • ' + (meta.filePath || '');
                            } else {
                                logsMeta.innerText = meta.filePath ? meta.filePath : '';
                            }
                        }
                    }
                    if (msg.command === 'updateAntigravityQuotaEnabled') {
                        if (antigravityQuotaCheckbox) {
                            antigravityQuotaCheckbox.checked = msg.enabled !== false;
                        }
                    }
                    if (msg.command === 'updateAntigravityQuotaStatus') {
                        if (quotaStatusContent) {
                            if (msg.error) {
                                quotaStatusContent.innerHTML = '<span style="color:#ef4444">Error: ' + msg.error + '</span>';
                            } else if (msg.snapshot) {
                                let html = '';
                                if (msg.snapshot.user) {
                                    html += '<div style="margin-bottom:8px"><strong>' + (msg.snapshot.user.name || msg.snapshot.user.email || 'User') + '</strong> (' + (msg.snapshot.user.plan || 'Unknown Plan') + ')</div>';
                                }
                                if (msg.snapshot.models && msg.snapshot.models.length > 0) {
                                    html += '<div style="text-align:left">';
                                    
                                    // Sort: Exhausted first, then by lowest remaining percentage
                                    const sortedModels = [...msg.snapshot.models].sort((a, b) => {
                                        if (a.isExhausted && !b.isExhausted) return -1;
                                        if (!a.isExhausted && b.isExhausted) return 1;
                                        return (a.remainingPercentage || 100) - (b.remainingPercentage || 100);
                                    });

                                    // Show up to 10 relevant models
                                    sortedModels.slice(0, 10).forEach(m => {
                                        const pct = m.remainingPercentage !== undefined ? m.remainingPercentage.toFixed(0) + '%' : '0%';
                                        const icon = m.isExhausted ? '🔴' : (m.remainingPercentage < 20 ? '🟡' : '🟢');
                                        const resetInfo = m.timeUntilResetFormatted ? ' <span style="opacity:0.5;font-size:11px"> - ' + m.timeUntilResetFormatted + '</span>' : '';
                                        html += '<div style="margin:4px 0">' + icon + ' ' + m.label + ': ' + pct + resetInfo + '</div>';
                                    });
                                    
                                    if (sortedModels.length > 10) {
                                        html += '<div style="opacity:0.5;font-size:11px;margin-top:4px">...and ' + (sortedModels.length - 10) + ' more</div>';
                                    }
                                    html += '</div>';
                                } else if (msg.snapshot.promptCredits) {
                                    const pc = msg.snapshot.promptCredits;
                                    html += '<div>Credits: ' + pc.available + ' / ' + pc.monthly + ' (' + pc.remainingPercentage.toFixed(0) + '%)</div>';
                                }
                                quotaStatusContent.innerHTML = html || 'Connected';
                            } else {
                                quotaStatusContent.innerHTML = '<span style="opacity:0.5">Not connected</span>';
                            }
                        }
                    }
                    if (msg.command === 'updateQueueStatus') {
                        if (queueStatusText && msg.status) {
                            const s = msg.status;
                            let statusText = 'Not Started';
                            let statusColor = 'inherit';
                            
                            if (s.isQuotaExhausted) {
                                statusText = 'Paused (Quota)';
                                statusColor = '#f59e0b'; // amber
                            } else if (s.isPaused) {
                                statusText = 'Paused (' + (s.queueIndex + 1) + '/' + s.queueLength + ')';
                                statusColor = '#f59e0b'; // amber
                            } else if (s.conversationStatus === 'waiting') {
                                statusText = 'Waiting (Busy)';
                                statusColor = '#f59e0b'; // amber - waiting for conversation
                            } else if (s.isRunningQueue) {
                                statusText = 'Running (' + (s.queueIndex + 1) + '/' + s.queueLength + ')';
                                statusColor = '#22c55e'; // green
                            } else if (s.queueLength > 0) {
                                statusText = 'Ready (' + s.queueLength + ' items)';
                                statusColor = '#3b82f6'; // blue
                            }
                            
                            queueStatusText.innerText = statusText;
                            queueStatusText.style.color = statusColor;

                            // Show/hide control buttons
                            const controlBtns = document.getElementById('queueControlBtns');
                            const startBtn = document.getElementById('startQueueBtn');
                            const pauseBtn = document.getElementById('pauseQueueBtn');
                            const currentPromptInfo = document.getElementById('currentPromptInfo');
                            const currentPromptText = document.getElementById('currentPromptText');
                            
                            if (controlBtns && startBtn) {
                                if (s.isRunningQueue) {
                                    controlBtns.style.display = 'flex';
                                    startBtn.style.display = 'none';
                                } else {
                                    controlBtns.style.display = 'none';
                                    startBtn.style.display = 'block';
                                }
                            }

                            // Update pause button text
                            if (pauseBtn) {
                                pauseBtn.textContent = s.isPaused ? '▶ Resume' : '⏸ Pause';
                            }

                            // Show current prompt info
                            if (currentPromptInfo && s.currentPrompt) {
                                currentPromptInfo.style.display = 'block';
                                if (currentPromptText) {
                                    currentPromptText.textContent = s.currentPrompt.text.substring(0, 40) + '...';
                                }
                            } else if (currentPromptInfo) {
                                currentPromptInfo.style.display = 'none';
                            }
                        }
                    }
                    if (msg.command === 'updateConversations') {
                        if (targetConversationSelect && msg.conversations) {
                            const currentValue = targetConversationSelect.value;
                            // Keep the first option (Current)
                            targetConversationSelect.innerHTML = '<option value="">Current (Active Tab)</option>';
                            msg.conversations.forEach(conv => {
                                const option = document.createElement('option');
                                option.value = conv;
                                option.textContent = conv;
                                if (conv === currentValue) option.selected = true;
                                targetConversationSelect.appendChild(option);
                            });
                        }
                    }
                    if (msg.command === 'updatePromptHistory') {
                        if (promptHistoryList && msg.history) {
                            if (msg.history.length === 0) {
                                promptHistoryList.innerHTML = '<div style="opacity: 0.5; text-align: center;">No prompts sent yet</div>';
                            } else {
                                let html = '';
                                msg.history.slice(-10).reverse().forEach(h => {
                                    const convLabel = h.conversation === 'current' || !h.conversation ? '' : ' [' + h.conversation.substring(0, 15) + ']';
                                    html += '<div style="padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">';
                                    html += '<span style="opacity: 0.5; font-size: 10px;">' + h.timeAgo + convLabel + '</span> ';
                                    html += '<span>' + h.text.substring(0, 60) + (h.text.length > 60 ? '...' : '') + '</span>';
                                    html += '</div>';
                                });
                                promptHistoryList.innerHTML = html;
                            }
                        }
                    }
                    // === Debug UI Bridge - Execute actions in the WebView ===
                    if (msg.command === 'executeDebugUIAction') {
                        const action = msg.action || {};
                        let result = { success: false, error: 'Unknown action' };
                        try {
                            switch (action.type) {
                                case 'click':
                                    const clickEl = document.getElementById(action.target);
                                    if (clickEl) {
                                        clickEl.click();
                                        result = { success: true, clicked: action.target };
                                    } else {
                                        result = { success: false, error: 'Element not found: ' + action.target };
                                    }
                                    break;
                                case 'setValue':
                                    const setEl = document.getElementById(action.target);
                                    if (setEl) {
                                        if (setEl.type === 'checkbox') {
                                            setEl.checked = action.value;
                                            setEl.dispatchEvent(new Event('change', { bubbles: true }));
                                        } else {
                                            setEl.value = action.value;
                                            setEl.dispatchEvent(new Event('input', { bubbles: true }));
                                            setEl.dispatchEvent(new Event('change', { bubbles: true }));
                                        }
                                        result = { success: true, set: action.target, value: action.value };
                                    } else {
                                        result = { success: false, error: 'Element not found: ' + action.target };
                                    }
                                    break;
                                case 'getValue':
                                    const getEl = document.getElementById(action.target);
                                    if (getEl) {
                                        const value = getEl.type === 'checkbox' ? getEl.checked : getEl.value;
                                        result = { success: true, target: action.target, value: value, exists: true };
                                    } else {
                                        result = { success: false, exists: false, error: 'Element not found: ' + action.target };
                                    }
                                    break;
                                case 'getText':
                                    const textEl = document.getElementById(action.target);
                                    if (textEl) {
                                        result = { success: true, target: action.target, text: textEl.innerText || textEl.textContent };
                                    } else {
                                        result = { success: false, error: 'Element not found: ' + action.target };
                                    }
                                    break;
                                case 'getSnapshot':
                                    // Return full page state for verification
                                    result = {
                                        success: true,
                                        snapshot: {
                                            scheduleEnabled: document.getElementById('scheduleEnabled')?.checked,
                                            scheduleMode: document.getElementById('scheduleMode')?.value,
                                            scheduleValue: document.getElementById('scheduleValue')?.value,
                                            queueMode: document.getElementById('queueMode')?.value,
                                            silenceTimeout: document.getElementById('silenceTimeout')?.value,
                                            freqSlider: document.getElementById('freqSlider')?.value,
                                            roiClickCount: document.getElementById('roiClickCount')?.innerText,
                                            roiTimeSaved: document.getElementById('roiTimeSaved')?.innerText,
                                            roiSessionCount: document.getElementById('roiSessionCount')?.innerText
                                        }
                                    };
                                    break;
                                case 'listElements':
                                    // List all interactive elements for discovery
                                    const els = document.querySelectorAll('button, input, select, textarea, [role=button]');
                                    const list = [];
                                    els.forEach(el => {
                                        list.push({
                                            id: el.id || null,
                                            tag: el.tagName,
                                            type: el.type || null,
                                            value: el.value?.substring(0, 50) || null,
                                            text: el.innerText?.substring(0, 50) || null
                                        });
                                    });
                                    result = { success: true, elements: list, count: list.length };
                                    break;
                                default:
                                    result = { success: false, error: 'Unknown action type: ' + action.type };
                            }
                        } catch (err) {
                            result = { success: false, error: err.message };
                        }
                        // Send result back to extension
                        vscode.postMessage({ command: 'debugUIResult', result: result });
                    }
                });

                // Initial load
                refreshStats();
                vscode.postMessage({ command: 'getBannedCommands' });
                vscode.postMessage({ command: 'getSchedule' });
                vscode.postMessage({ command: 'getConversations' });
                vscode.postMessage({ command: 'getPromptHistory' });
                requestLogs();
                updateModeVisibility(); // Apply default mode visibility
            </script>
        </body>
        </html>`;
    }

    dispose() {
        SettingsPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) d.dispose();
        }
    }
}

module.exports = { SettingsPanel };
