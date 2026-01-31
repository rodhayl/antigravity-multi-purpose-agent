const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { DebugHandler } = require('./debug-handler');


// Lazy load SettingsPanel to avoid blocking activation
let SettingsPanel = null;
function getSettingsPanel() {
    if (!SettingsPanel) {
        try {
            SettingsPanel = require('./settings-panel').SettingsPanel;
        } catch (e) {
            console.error('Failed to load SettingsPanel:', e);
        }
    }
    return SettingsPanel;
}

// Lazy load AntigravityClient for direct backend connection
let AntigravityClient = null;
let antigravityClient = null;
function getAntigravityClient() {
    if (!AntigravityClient) {
        try {
            AntigravityClient = require('./antigravity/client').AntigravityClient;
        } catch (e) {
            console.error('Failed to load AntigravityClient:', e);
        }
    }
    return AntigravityClient;
}

// states

const GLOBAL_STATE_KEY = 'auto-accept-enabled-global';
const FREQ_STATE_KEY = 'auto-accept-frequency';
const BANNED_COMMANDS_KEY = 'auto-accept-banned-commands';
const ROI_STATS_KEY = 'auto-accept-roi-stats'; // For ROI notification
const SECONDS_PER_CLICK = 5; // Conservative estimate: 5 seconds saved per auto-accept

let isEnabled = false;
let isLockedOut = false; // Local tracking
let pollFrequency = 2000; // Default for Free
let bannedCommands = []; // List of command patterns to block

let pollTimer;
let statsCollectionTimer; // For periodic stats collection
let quotaPollingTimer; // For Antigravity quota polling
let statusBarItem;
let statusSettingsItem;
let statusQuotaItem; // Antigravity Quota display
let statusQueueItem; // Queue status display
let outputChannel;
let currentIDE = 'antigravity'; // 'antigravity' | 'Code'
let globalContext;

let cdpHandler;
let relauncher;
let debugHandler; // Debug Handler instance

const extensionRoot = path.basename(__dirname).toLowerCase() === 'dist'
    ? path.join(__dirname, '..')
    : __dirname;

function formatCdpLogSuffix(d = new Date()) {
    const pad2 = (n) => String(n).padStart(2, '0');
    const mm = pad2(d.getMinutes());
    const hh = pad2(d.getHours());
    const dd = pad2(d.getDate());
    const MM = pad2(d.getMonth() + 1);
    const yy = pad2(d.getFullYear() % 100);
    return `${mm}${hh}-${dd}${MM}${yy}`;
}

const cdpLogPath = path.join(extensionRoot, `multi-purpose-cdp-${formatCdpLogSuffix()}.log`);

function log(message) {
    try {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        const logLine = `[${timestamp}] ${message}`;
        console.log(logLine);

        // Write to log file for debug mode
        fs.appendFileSync(cdpLogPath, logLine + '\n');
    } catch (e) {
        console.error('\u{26A1} failed:', e);
    }
}

// --- Scheduler Class ---
class Scheduler {
    constructor(context, cdpHandler, logFn, options = {}) {
        this.context = context;
        this.cdpHandler = cdpHandler;
        this.log = logFn;
        this.timer = null;
        this.silenceTimer = null;
        this.lastRunTime = Date.now();
        this.lastClickTime = 0;
        this.lastClickCount = 0;
        this.lastActivityTime = 0;
        this.enabled = false;
        this.isQuotaExhausted = false;
        this.config = {};
        this.promptQueue = Promise.resolve();

        // Queue mode state
        this.runtimeQueue = [];
        this.queueIndex = 0;
        this.isRunningQueue = false;
        this.isStopped = false; // Flag to cancel pending prompts
        this.queueRunId = 0;
        this.taskStartTime = 0;
        this.hasSentCurrentItem = false;
        this.activationTime = Date.now(); // Track when scheduler was created for activation guard
        this.ensureCdpReady = typeof options.ensureCdpReady === 'function' ? options.ensureCdpReady : null;
        this.lastCdpSyncTime = 0;

        // Multi-queue ready architecture (single conversation for now)
        this.targetConversation = '';  // '' = current active tab
        this.promptHistory = [];       // HistoryEntry[]
        this.conversationStatus = 'idle'; // 'idle'|'running'|'waiting'
        this.isPaused = false;         // User-initiated pause
    }

    async ensureCdpReadyNow(reason, force = false) {
        if (!this.ensureCdpReady) return;
        const now = Date.now();
        if (!force && this.lastCdpSyncTime && (now - this.lastCdpSyncTime) < 2000) return;
        this.lastCdpSyncTime = now;
        try {
            this.log(`Scheduler: Syncing CDP (${reason})...`);
            await this.ensureCdpReady();
        } catch (e) {
            this.log(`Scheduler: CDP sync failed: ${e?.message || String(e)}`);
        }
    }

    start() {
        this.loadConfig();
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => this.check(), 60000);

        // Silence detection timer (runs more frequently)
        if (this.silenceTimer) clearInterval(this.silenceTimer);
        this.silenceTimer = setInterval(() => this.checkSilence(), 5000);

        // Reset activation time when scheduler starts (for accurate grace period)
        this.activationTime = Date.now();
        this.log('Scheduler started.');
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.silenceTimer) {
            clearInterval(this.silenceTimer);
            this.silenceTimer = null;
        }
        this.isRunningQueue = false;
    }

    loadConfig() {
        const cfg = vscode.workspace.getConfiguration('auto-accept.schedule');
        const newEnabled = cfg.get('enabled', false);

        // Reset timer on rising edge (Disabled -> Enabled)
        if (!this.enabled && newEnabled) {
            this.lastRunTime = Date.now();
            this.log('Scheduler: Enabled via config update - Timer reset');
        }
        this.enabled = newEnabled;
        this.config = {
            mode: cfg.get('mode', 'interval'),
            value: cfg.get('value', '30'),
            prompt: cfg.get('prompt', 'Status report please'),
            prompts: cfg.get('prompts', []),
            queueMode: cfg.get('queueMode', 'consume'),
            silenceTimeout: cfg.get('silenceTimeout', 30) * 1000, // Convert to ms
            checkPromptEnabled: cfg.get('checkPrompt.enabled', false),
            checkPromptText: cfg.get('checkPrompt.text', 'Make sure that the previous task was implemented fully as per requirements, implement all gaps, fix all bugs and test everything. Make sure that you reused existing code where possible instead of duplicating code. ultrathink internally avoiding verbosity.')
        };
        this.log(`Scheduler Config: mode=${this.config.mode}, enabled=${this.enabled}, prompts=${this.config.prompts.length}`);
    }

    buildRuntimeQueue() {
        const prompts = [...this.config.prompts];
        if (prompts.length === 0) return [];

        const queue = [];
        for (let i = 0; i < prompts.length; i++) {
            queue.push({ type: 'task', text: prompts[i], index: i });
            if (this.config.checkPromptEnabled) {
                queue.push({ type: 'check', text: this.config.checkPromptText, afterIndex: i });
            }
        }
        return queue;
    }

    async check() {
        this.loadConfig();
        if (!this.enabled || !this.cdpHandler) return;

        const now = new Date();
        const mode = this.config.mode;
        const val = this.config.value;

        if (mode === 'interval') {
            const minutes = parseInt(val) || 30;
            const ms = minutes * 60 * 1000;
            if (Date.now() - this.lastRunTime > ms) {
                this.log(`Scheduler: Interval triggered (${minutes}m)`);
                await this.trigger();
            }
        } else if (mode === 'daily') {
            const [targetH, targetM] = val.split(':').map(Number);
            if (now.getHours() === targetH && now.getMinutes() === targetM) {
                if (Date.now() - this.lastRunTime > 60000) {
                    this.log(`Scheduler: Daily triggered (${val})`);
                    await this.trigger();
                }
            }
        }
        // Queue mode is handled via startQueue() and silence detection
    }

    async checkSilence() {
        // Queue advancement only requires: running queue + CDP connection + queue mode
        // Note: this.enabled is for scheduled runs; manual "Run Queue" doesn't need it
        if (!this.cdpHandler || !this.isRunningQueue) return;
        if (this.config.mode !== 'queue') return;
        if (this.isPaused) return; // User paused - wait for resume
        if (this.isQuotaExhausted) return; // Don't advance if quota exhausted

        // Get current click count from CDP
        try {
            const stats = await this.cdpHandler.getStats();
            const currentClicks = stats?.clicks || 0;

            // If clicks happened, update last click time
            if (currentClicks > this.lastClickCount) {
                this.lastClickTime = Date.now();
                this.lastActivityTime = this.lastClickTime;
                this.lastClickCount = currentClicks;
                this.log(`Scheduler: Activity detected (${currentClicks} clicks)`);
            }

            // Check if silence timeout reached (only after we've successfully sent the current queue item)
            const silenceDuration = Date.now() - (this.lastActivityTime || this.lastClickTime || Date.now());
            const taskDuration = Date.now() - this.taskStartTime;

            // Only advance if:
            // 1. We've been running this task for at least 10 seconds
            // 2. We successfully sent the current queue item
            // 3. Silence duration exceeds timeout
            if (taskDuration > 10000 && this.hasSentCurrentItem && silenceDuration > this.config.silenceTimeout) {
                this.log(`Scheduler: Silence detected (${Math.round(silenceDuration / 1000)}s), advancing queue`);
                await this.advanceQueue();
            }
        } catch (e) {
            this.log(`Scheduler: Error checking silence: ${e.message}`);
        }
    }

    async startQueue(options) {
        // CRITICAL: Require explicit source for all startQueue calls
        const validSources = ['manual', 'debug-server', 'resume', 'test'];
        const source = options?.source;

        // DEBUG: Trace caller if no valid source
        if (!source || !validSources.includes(source)) {
            this.log(`Scheduler: BLOCKED startQueue - invalid source: "${source}". Valid: ${validSources.join(', ')}`);
            this.log('Scheduler: Stack trace: ' + new Error().stack);
            return; // Block phantom callers
        }

        this.log(`Scheduler: startQueue called with source: ${source}`);

        // Dampener: Prevent rapid restarts/loops (2 second cooldown)
        if (this.lastStartQueueTime && Date.now() - this.lastStartQueueTime < 2000) {
            this.log('Scheduler: Ignoring rapid startQueue call (< 2s)');
            return;
        }
        this.lastStartQueueTime = Date.now();

        // ACTIVATION GUARD: Block non-manual starts during activation grace period.
        // Prevents config/debug automation from triggering queue start on reload, while still allowing user clicks.
        if (this.activationTime && Date.now() - this.activationTime < 5000 && source !== 'manual' && source !== 'test') {
            this.log(`Scheduler: BLOCKED startQueue during activation grace period (${Math.round((Date.now() - this.activationTime) / 1000)}s < 5s)`);
            return;
        }

        // Load config first to get current state
        this.loadConfig();

        // Prevent auto-starting queue when scheduler is enabled but user hasn't explicitly started it
        if (this.config.mode === 'queue' && this.isRunningQueue) {
            this.log('Scheduler: Queue is already running, ignoring duplicate startQueue call');
            return;
        }

        this.log(`Scheduler: Queue start proceeding (source: ${source})`);

        if (this.config.mode !== 'queue') {
            this.log('Scheduler: Not in queue mode, ignoring startQueue');
            vscode.window.showWarningMessage('Multi Purpose: Set mode to "Queue" first.');
            return;
        }

        // Ensure we have fresh CDP connections and injected helpers (chat webviews may not exist at activation time).
        await this.ensureCdpReadyNow('startQueue', true);

        this.runtimeQueue = this.buildRuntimeQueue();
        this.queueIndex = 0;
        this.isRunningQueue = true;
        this.isStopped = false; // Clear stopped flag when starting
        this.lastClickCount = 0;
        this.lastClickTime = Date.now();
        this.lastActivityTime = Date.now();
        this.taskStartTime = Date.now();
        this.hasSentCurrentItem = false;

        this.log(`Scheduler: Starting queue with ${this.runtimeQueue.length} items`);

        if (this.runtimeQueue.length === 0) {
            this.log('Scheduler: Queue is empty, nothing to run');
            if (options && options.source === 'manual') {
                // Warning Dampener: Prevent spamming warnings loop
                const now = Date.now();
                if (this.queueWarningDampener && (now - this.queueWarningDampener < 5000)) {
                    this.log('Scheduler: Suppressed empty queue warning (dampener active)');
                } else {
                    vscode.window.showWarningMessage('Multi Purpose: Prompt queue is empty. Add prompts first.');
                    this.queueWarningDampener = now;
                }
            } else {
                this.log('Scheduler: Suppressing empty queue warning (auto-start or no source)');
            }
            this.isRunningQueue = false;
            this.hasSentCurrentItem = false;
            return;
        }

        await this.executeCurrentQueueItem();
    }

    async advanceQueue() {
        if (!this.isRunningQueue) return;

        // In consume mode, remove the completed prompt from config immediately
        if (this.config.queueMode === 'consume') {
            await this.consumeCurrentPrompt();
        }

        this.queueIndex++;
        this.lastClickCount = 0;
        this.lastClickTime = Date.now();
        this.lastActivityTime = Date.now();
        this.taskStartTime = Date.now();
        this.hasSentCurrentItem = false;

        if (this.queueIndex >= this.runtimeQueue.length) {
            if (this.config.queueMode === 'loop' && this.runtimeQueue.length > 0) {
                this.log('Scheduler: Queue completed, looping...');
                this.queueIndex = 0;
                // Rebuild queue to respect any config changes
                this.loadConfig();
                this.runtimeQueue = this.buildRuntimeQueue();
            } else {
                this.log('Scheduler: Queue completed, stopping');
                this.isRunningQueue = false;
                vscode.window.showInformationMessage('Multi Purpose: Prompt queue completed!');
                return;
            }
        }

        await this.executeCurrentQueueItem();
    }

    async executeCurrentQueueItem() {
        const runId = this.queueRunId;
        if (!this.isRunningQueue || this.isStopped) return;
        if (this.queueIndex >= this.runtimeQueue.length) return;

        const item = this.runtimeQueue[this.queueIndex];
        const itemType = item.type === 'check' ? 'Check Prompt' : `Task ${item.index + 1}`;

        this.log(`Scheduler: Executing ${itemType}: "${item.text.substring(0, 50)}..."`);
        this.conversationStatus = 'running';
        vscode.window.showInformationMessage(`Multi Purpose: Sending ${itemType}`);

        if (this.isStopped || runId !== this.queueRunId) return;
        await this.sendPrompt(item.text);
        // Note: addToHistory is called inside queuePrompt after successful send
    }

    async resume() {
        this.isQuotaExhausted = false;

        const resumeConfig = vscode.workspace.getConfiguration('auto-accept.antigravityQuota.resume');
        const queueResumeEnabled = resumeConfig.get('enabled', true);

        const autoContinueConfig = vscode.workspace.getConfiguration('auto-accept.autoContinue');
        const autoContinueEnabled = autoContinueConfig.get('enabled', false);

        // 1. Handle Queue Resume (Prioritized)
        if (this.isRunningQueue && this.config.mode === 'queue') {
            if (queueResumeEnabled) {
                this.log('Scheduler: Quota reset, resuming queue task');
                vscode.window.showInformationMessage('Multi Purpose: Quota reset! Resuming queue...');
                this.lastClickTime = Date.now();
                this.lastActivityTime = this.lastClickTime;
                this.taskStartTime = Date.now();
                this.lastClickCount = 0;
                this.hasSentCurrentItem = false;
                // Re-send current item to continue
                await this.executeCurrentQueueItem();
                return;
            } else {
                this.log('Scheduler: Quota reset, but queue resume disabled.');
            }
        }

        // 2. Handle Generic Auto-Continue (if not in queue or queue resume disabled)
        if (autoContinueEnabled) {
            this.log('Scheduler: Quota reset, sending "Continue" prompt');
            vscode.window.showInformationMessage('Multi Purpose: Quota reset! Sending "Continue"...');
            await this.sendPrompt('Continue');
        } else {
            this.log('Scheduler: Quota reset, but auto-continue disabled.');
        }

        // NOTE: Do NOT auto-start queue if not running - user must explicitly click Start Queue.
    }

    async consumeCurrentPrompt() {
        try {
            const config = vscode.workspace.getConfiguration('auto-accept.schedule');
            const prompts = config.get('prompts', []);
            if (prompts.length > 0) {
                // Remove the first prompt (the one that was just completed)
                const remaining = prompts.slice(1);
                await config.update('prompts', remaining, vscode.ConfigurationTarget.Global);
                this.log(`Scheduler: Consumed prompt, ${remaining.length} remaining`);
            }
        } catch (e) {
            this.log(`Scheduler: Error consuming prompt: ${e.message}`);
        }
    }

    async consumeCompletedPrompts() {
        try {
            const config = vscode.workspace.getConfiguration('auto-accept.schedule');
            // Clear the prompts array after successful completion
            await config.update('prompts', [], vscode.ConfigurationTarget.Global);
            this.log('Scheduler: Consumed prompts cleared from config');
        } catch (e) {
            this.log(`Scheduler: Error clearing consumed prompts: ${e.message}`);
        }
    }

    setQuotaExhausted(exhausted) {
        const wasExhausted = this.isQuotaExhausted;
        this.isQuotaExhausted = exhausted;

        if (wasExhausted && !exhausted) {
            this.log('Scheduler: Quota transitioned from exhausted to available');
            this.resume();
        } else if (exhausted && !wasExhausted) {
            this.log('Scheduler: Quota became exhausted, pausing queue');
        }
    }

    async queuePrompt(text) {
        const runId = this.queueRunId;
        this.promptQueue = this.promptQueue.then(async () => {
            // Check if queue was stopped before we could send
            if (this.isStopped || runId !== this.queueRunId) {
                this.log('Scheduler: Prompt cancelled (queue stopped)');
                return;
            }

            this.lastRunTime = Date.now();
            if (!text) return;

            this.log(`Scheduler: Sending prompt "${text.substring(0, 50)}..."`);

            // Use CDP only - the verified working method
            if (this.cdpHandler) {
                try {
                    // Ensure CDP has scanned/injected latest chat surfaces before attempting to send.
                    await this.ensureCdpReadyNow('queuePrompt');
                    if (this.isStopped || runId !== this.queueRunId) return;

                    const rawSentCount = await this.cdpHandler.sendPrompt(text, this.targetConversation);
                    let sentCount = typeof rawSentCount === 'number' ? rawSentCount : (rawSentCount ? 1 : 0);
                    if (this.isStopped || runId !== this.queueRunId) return;

                    // One retry after a forced resync (chat webview can spawn after we started the queue)
                    if (sentCount === 0 && this.ensureCdpReady) {
                        this.log('Scheduler: Prompt not delivered, forcing CDP resync and retrying once...');
                        await this.ensureCdpReadyNow('queuePrompt-retry', true);
                        if (this.isStopped || runId !== this.queueRunId) return;
                        const rawRetry = await this.cdpHandler.sendPrompt(text, this.targetConversation);
                        sentCount = typeof rawRetry === 'number' ? rawRetry : (rawRetry ? 1 : 0);
                        if (this.isStopped || runId !== this.queueRunId) return;
                    }

                    // CRITICAL FIX: If 0 prompts sent, we must abort, otherwise we wait for silence forever
                    if (sentCount === 0) {
                        throw new Error('Prompt not delivered (no active chat input / send function found).');
                    }

                    this.addToHistory(text, this.targetConversation);
                    if (this.isRunningQueue && this.config.mode === 'queue') {
                        this.hasSentCurrentItem = true;
                        this.lastActivityTime = Date.now();
                    }
                    this.log(`Scheduler: Prompt sent via CDP (${sentCount} tabs)`);
                } catch (err) {
                    this.log(`Scheduler: CDP failed: ${err.message}`);
                    vscode.window.showErrorMessage(`Queue Error: ${err.message}`);
                    // Force stop queue on critical error to prevent "Running" ghost state
                    this.stopQueue();
                    return;
                }
            } else {
                this.log('Scheduler: CDP handler not available');
                if (this.isRunningQueue && this.config.mode === 'queue') {
                    vscode.window.showErrorMessage('Queue Error: CDP handler not available.');
                    this.stopQueue();
                }
            }
        }).catch(err => {
            this.log(`Scheduler Error: ${err.message}`);
        });
        return this.promptQueue;
    }

    async sendPrompt(text) {
        return this.queuePrompt(text);
    }

    async trigger() {
        const text = this.config.prompt;
        return this.queuePrompt(text);
    }

    getStatus() {
        return {
            enabled: this.enabled,
            mode: this.config.mode,
            isRunningQueue: this.isRunningQueue,
            queueLength: this.runtimeQueue.length,
            queueIndex: this.queueIndex,
            isQuotaExhausted: this.isQuotaExhausted,
            targetConversation: this.targetConversation,
            conversationStatus: this.conversationStatus,
            isPaused: this.isPaused,
            currentPrompt: this.getCurrentPrompt()
        };
    }

    async getConversations() {
        if (!this.cdpHandler) return [];
        try {
            return await this.cdpHandler.getConversations();
        } catch (e) {
            this.log(`Scheduler: Error getting conversations: ${e.message}`);
            return [];
        }
    }

    addToHistory(text, conversationId) {
        const entry = {
            text: text.substring(0, 100),
            fullText: text,
            timestamp: Date.now(),
            status: 'sent',
            conversationId: conversationId || this.targetConversation || 'current'
        };
        this.promptHistory.push(entry);
        // Keep last 50 entries
        if (this.promptHistory.length > 50) {
            this.promptHistory.shift();
        }
        this.log(`Scheduler: Added to history: "${entry.text.substring(0, 50)}..."`);
    }

    getHistory() {
        return this.promptHistory.map(h => ({
            text: h.text,
            timestamp: h.timestamp,
            timeAgo: this.formatTimeAgo(h.timestamp),
            status: h.status,
            conversation: h.conversationId
        }));
    }

    formatTimeAgo(ts) {
        const diff = Date.now() - ts;
        if (diff < 60000) return 'just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        return Math.floor(diff / 86400000) + 'd ago';
    }

    setTargetConversation(conversationId) {
        this.targetConversation = conversationId || '';
        this.log(`Scheduler: Target conversation set to: "${this.targetConversation || 'current'}"`);
    }

    // Queue control methods
    pauseQueue() {
        if (!this.isRunningQueue || this.isPaused) return false;
        this.isPaused = true;
        this.log('Scheduler: Queue paused by user');
        vscode.window.showInformationMessage('Queue paused.');
        return true;
    }

    resumeQueue() {
        if (!this.isRunningQueue || !this.isPaused) return false;
        this.isPaused = false;
        this.log('Scheduler: Queue resumed by user');
        vscode.window.showInformationMessage('Queue resumed.');
        // Trigger next check immediately
        this.checkSilence();
        return true;
    }

    async skipPrompt() {
        if (!this.isRunningQueue) return false;
        this.log('Scheduler: Skipping current prompt');
        vscode.window.showInformationMessage('Skipping to next prompt...');

        // Advance without sending current
        this.queueIndex++;
        this.isPaused = false; // Clear pause if set
        this.lastClickCount = 0;
        this.lastClickTime = Date.now();
        this.lastActivityTime = Date.now();
        this.taskStartTime = Date.now();
        this.hasSentCurrentItem = false;

        if (this.queueIndex >= this.runtimeQueue.length) {
            this.log('Scheduler: No more prompts to skip to, queue complete');
            this.isRunningQueue = false;
            this.conversationStatus = 'idle';
            return true;
        }

        // Execute next item
        await this.executeCurrentQueueItem();
        return true;
    }

    stopQueue() {
        if (!this.isRunningQueue && this.runtimeQueue.length === 0) return false;
        this.isRunningQueue = false;
        this.isStopped = true; // Signal pending prompts to cancel
        this.queueRunId++;
        this.runtimeQueue = [];
        this.queueIndex = 0;
        this.conversationStatus = 'idle';
        this.isPaused = false;
        this.lastClickCount = 0;
        this.lastClickTime = 0;
        this.lastActivityTime = 0;
        this.taskStartTime = 0;
        this.hasSentCurrentItem = false;
        // Reset the prompt queue to cancel pending operations
        this.promptQueue = Promise.resolve();
        this.log('Scheduler: Queue stopped by user');
        vscode.window.showInformationMessage('Queue stopped.');
        return true;
    }

    async resetQueue() {
        // Stop the queue if running
        this.isRunningQueue = false;
        this.isStopped = false; // Reset the stopped flag
        this.queueRunId++;
        this.runtimeQueue = [];
        this.queueIndex = 0;
        this.conversationStatus = 'idle';
        this.isPaused = false;
        this.lastClickCount = 0;
        this.lastClickTime = 0;
        this.lastActivityTime = 0;
        this.taskStartTime = 0;
        this.hasSentCurrentItem = false;
        this.promptQueue = Promise.resolve(); // Clear pending prompts

        // Clear prompts from config
        try {
            const config = vscode.workspace.getConfiguration('auto-accept.schedule');
            await config.update('prompts', [], vscode.ConfigurationTarget.Global);
            this.log('Scheduler: Queue reset - all prompts cleared');
        } catch (e) {
            this.log(`Scheduler: Error resetting queue: ${e.message}`);
        }

        vscode.window.showInformationMessage('Queue reset.');
        return true;
    }

    getCurrentPrompt() {
        if (!this.isRunningQueue || this.queueIndex >= this.runtimeQueue.length) return null;
        return this.runtimeQueue[this.queueIndex];
    }
}

let scheduler;

function detectIDE() {
    const appName = vscode.env.appName || '';
    if (appName.toLowerCase().includes('antigravity')) return 'Antigravity';
    return 'Code'; // VS Code base
}

async function activate(context) {
    globalContext = context;
    console.log('Multi Purpose Extension: Activator called.');

    // CRITICAL: Create status bar items FIRST before anything else
    try {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.command = 'auto-accept.toggle';
        statusBarItem.text = '\u{23F3} Multi Purpose: Loading...';
        statusBarItem.tooltip = 'Multi Purpose Agent is initializing...';
        context.subscriptions.push(statusBarItem);
        statusBarItem.show();

        statusSettingsItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
        statusSettingsItem.command = 'auto-accept.openSettings';
        statusSettingsItem.text = '\u{2699}\u{FE0F}';
        statusSettingsItem.tooltip = 'Multi Purpose Settings';
        context.subscriptions.push(statusSettingsItem);
        statusSettingsItem.show();

        // Antigravity Quota status bar item
        statusQuotaItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 97);
        statusQuotaItem.command = 'auto-accept.openSettings';
        statusQuotaItem.text = '\u{1F4CA} Quota: --';
        statusQuotaItem.tooltip = 'Antigravity Quota - Click to open settings';
        context.subscriptions.push(statusQuotaItem);
        // Show based on config setting

        // Queue Status bar item
        statusQueueItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 96);
        statusQueueItem.command = 'auto-accept.showQueueMenu';
        statusQueueItem.text = '\u{1F4CB} Queue: Idle';
        statusQueueItem.tooltip = 'Prompt Queue - Click for controls';
        context.subscriptions.push(statusQueueItem);
        // Hidden by default, shown when queue is running

        console.log('Multi Purpose: Status bar items created and shown.');
    } catch (sbError) {
        console.error('CRITICAL: Failed to create status bar items:', sbError);
    }

    try {
        // 1. Initialize State
        isEnabled = context.globalState.get(GLOBAL_STATE_KEY, false);

        // Load frequency
        pollFrequency = context.globalState.get(FREQ_STATE_KEY, 1000);

        // Load banned commands list (default: common dangerous patterns)
        const defaultBannedCommands = [
            'rm -rf /',
            'rm -rf ~',
            'rm -rf *',
            'format c:',
            'del /f /s /q',
            'rmdir /s /q',
            ':(){:|:&};:',  // fork bomb
            'dd if=',
            'mkfs.',
            '> /dev/sda',
            'chmod -R 777 /'
        ];
        bannedCommands = context.globalState.get(BANNED_COMMANDS_KEY, defaultBannedCommands);

        currentIDE = detectIDE();

        // 2. Create Output Channel
        outputChannel = vscode.window.createOutputChannel('Multi Purpose Agent');
        context.subscriptions.push(outputChannel);

        log(`Multi Purpose: Activating...`);
        log(`Multi Purpose: Detected environment: ${currentIDE.toUpperCase()}`);

        // Setup Focus Listener - Push state to browser (authoritative source)
        vscode.window.onDidChangeWindowState(async (e) => {
            // Always push focus state to browser - this is the authoritative source
            if (cdpHandler && cdpHandler.setFocusState) {
                await cdpHandler.setFocusState(e.focused);
            }

            // When user returns and auto-accept is running, check for away actions
            if (e.focused && isEnabled) {
                log(`[Away] Window focus detected by VS Code API. Checking for away actions...`);
                // Wait a tiny bit for CDP to settle after focus state is pushed
                setTimeout(() => checkForAwayActions(context), 500);
            }
        });

        // 3. Initialize Handlers (Lazy Load) - \u{1F916}h IDEs use CDP now
        try {
            const { CDPHandler } = require('./cdp-handler');
            const { Relauncher } = require('./relauncher');

            cdpHandler = new CDPHandler(log);
            relauncher = new Relauncher(log);
            log(`CDP handlers initialized for ${currentIDE}.`);



            // CRITICAL: Start CDP connections immediately to establish browser communication
            // This connects to the fixed CDP port 9004 and injects the browser script
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const detectedWorkspace = workspaceFolders && workspaceFolders.length > 0
                ? workspaceFolders[0].name
                : null;

            const cdpConfig = {
                ide: currentIDE,
                bannedCommands: context.globalState.get(BANNED_COMMANDS_KEY, []),
                pollInterval: context.globalState.get(FREQ_STATE_KEY, 1000),
                workspaceName: detectedWorkspace
            };
            cdpHandler.start(cdpConfig).then(() => {
                log(`CDP connections established. Active connections: ${cdpHandler.getConnectionCount()}`);
            }).catch(e => {
                log(`CDP start warning: ${e.message}`);
            });

            // Initialize Scheduler
            scheduler = new Scheduler(context, cdpHandler, log, { ensureCdpReady: syncSessions });
            scheduler.start();

            debugHandler = new DebugHandler(context, {
                log,
                getScheduler: () => scheduler,
                getAntigravityClient: () => antigravityClient,
                getLockedOut: () => isLockedOut,
                getCDPHandler: () => cdpHandler,
                getRelauncher: () => relauncher,
                syncSessions: async () => syncSessions()
            });
            debugHandler.startServer();
        } catch (err) {
            log(`Failed to initialize CDP handlers: ${err.message}`);
            vscode.window.showErrorMessage(`Multi Purpose Error: ${err.message}`);
        }

        // 3.5 Initialize Antigravity Client and Quota Display
        const quotaConfig = vscode.workspace.getConfiguration('auto-accept.antigravityQuota');
        const quotaEnabled = quotaConfig.get('enabled', true);
        const quotaPollInterval = quotaConfig.get('pollInterval', 60) * 1000; // Convert to ms

        if (quotaEnabled) {
            // Show quota status bar
            if (statusQuotaItem) {
                statusQuotaItem.show();
            }

            // Initialize and start quota polling (works for all IDEs, not just Antigravity)
            initAntigravityClient().then(connected => {
                if (connected) {
                    log('[Antigravity] Connected to language server, starting quota polling');
                    startQuotaPolling(quotaPollInterval);
                } else {
                    log('[Antigravity] Could not connect to language server');
                    updateQuotaStatusBar('N/A', 'Antigravity not detected');
                }
            }).catch(e => {
                log(`[Antigravity] Init error (non-critical): ${e.message}`);
                updateQuotaStatusBar('N/A', 'Connection error');
            });
        } else {
            log('[Antigravity] Quota display disabled in settings');
            if (statusQuotaItem) {
                statusQuotaItem.hide();
            }
        }

        // 4. Update Status Bar (already created at start)
        updateStatusBar();
        log('Status bar updated with current state.');

        // 5. Register Commands
        context.subscriptions.push(
            vscode.commands.registerCommand('auto-accept.toggle', () => handleToggle(context)),
            vscode.commands.registerCommand('auto-accept.relaunch', () => handleRelaunch()),
            vscode.commands.registerCommand('auto-accept.updateFrequency', (freq) => handleFrequencyUpdate(context, freq)),
            vscode.commands.registerCommand('auto-accept.updateBannedCommands', (commands) => handleBannedCommandsUpdate(context, commands)),
            vscode.commands.registerCommand('auto-accept.getBannedCommands', () => bannedCommands),
            vscode.commands.registerCommand('auto-accept.getROIStats', async () => {
                const stats = await loadROIStats(context);
                const timeSavedSeconds = stats.clicksThisWeek * SECONDS_PER_CLICK;
                const timeSavedMinutes = Math.round(timeSavedSeconds / 60);
                return {
                    ...stats,
                    timeSavedMinutes,
                    timeSavedFormatted: timeSavedMinutes >= 60
                        ? `${(timeSavedMinutes / 60).toFixed(1)} hours`
                        : `${timeSavedMinutes} minutes`
                };
            }),
            vscode.commands.registerCommand('auto-accept.openSettings', () => {
                const panel = getSettingsPanel();
                if (panel) {
                    panel.createOrShow(context.extensionUri, context);
                } else {
                    vscode.window.showErrorMessage('Failed to load Settings Panel.');
                }
            }),
            vscode.commands.registerCommand('auto-accept.checkAntigravityStatus', () => handleCheckAntigravityStatus()),
            vscode.commands.registerCommand('auto-accept.getAntigravityQuota', () => handleGetAntigravityQuota()),
            vscode.commands.registerCommand('auto-accept.toggleAntigravityQuota', (value) => handleToggleAntigravityQuota(value)),
            vscode.commands.registerCommand('auto-accept.getAntigravityQuotaEnabled', () => {
                const config = vscode.workspace.getConfiguration('auto-accept.antigravityQuota');
                return config.get('enabled', true);
            }),
            vscode.commands.registerCommand('auto-accept.startQueue', async (options) => {
                log('[Scheduler] Queue start requested via command');
                if (scheduler) {
                    // Ensure CDP connects/injects the active chat surface before starting the queue.
                    await syncSessions();
                    await scheduler.startQueue(options);
                    log('[Scheduler] Queue start handled via command');
                } else {
                    log('[Scheduler] Cannot start queue - scheduler not initialized');
                    vscode.window.showWarningMessage('Multi Purpose: Scheduler not ready. Please try again.');
                }
            }),
            vscode.commands.registerCommand('auto-accept.getQueueStatus', () => {
                if (scheduler) {
                    return scheduler.getStatus();
                }
                return { enabled: false, isRunningQueue: false, queueLength: 0, queueIndex: 0, isQuotaExhausted: false };
            }),
            vscode.commands.registerCommand('auto-accept.getConversations', async () => {
                if (scheduler) {
                    return await scheduler.getConversations();
                }
                return [];
            }),
            vscode.commands.registerCommand('auto-accept.getPromptHistory', () => {
                if (scheduler) {
                    return scheduler.getHistory();
                }
                return [];
            }),
            vscode.commands.registerCommand('auto-accept.setTargetConversation', (conversationId) => {
                if (scheduler) {
                    scheduler.setTargetConversation(conversationId);
                }
            }),
            vscode.commands.registerCommand('auto-accept.pauseQueue', () => {
                if (scheduler) {
                    scheduler.pauseQueue();
                }
            }),
            vscode.commands.registerCommand('auto-accept.resumeQueue', () => {
                if (scheduler) {
                    scheduler.resumeQueue();
                }
            }),
            vscode.commands.registerCommand('auto-accept.skipPrompt', async () => {
                if (scheduler) {
                    await scheduler.skipPrompt();
                }
            }),
            vscode.commands.registerCommand('auto-accept.stopQueue', () => {
                if (scheduler) {
                    scheduler.stopQueue();
                }
            }),
            vscode.commands.registerCommand('auto-accept.showQueueMenu', async () => {
                if (!scheduler) return;

                const status = scheduler.getStatus();
                const items = [];

                if (status.isRunningQueue) {
                    if (status.isPaused) {
                        items.push({ label: '\u{25B6}\u{FE0F} Resume', action: 'resume' });
                    } else {
                        items.push({ label: '\u{23F8}\u{FE0F} Pause', action: 'pause' });
                    }
                    items.push({ label: '\u{23ED}\u{FE0F} Skip Current', action: 'skip' });
                    items.push({ label: '\u{23F9}\u{FE0F} Stop Queue', action: 'stop' });
                }
                items.push({ label: '\u{2699}\u{FE0F} Open Settings', action: 'settings' });

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `Queue: ${status.queueIndex + 1}/${status.queueLength}${status.isPaused ? ' (Paused)' : ''}`
                });

                if (selected) {
                    switch (selected.action) {
                        case 'pause': scheduler.pauseQueue(); break;
                        case 'resume': scheduler.resumeQueue(); break;
                        case 'skip': await scheduler.skipPrompt(); break;
                        case 'stop': scheduler.stopQueue(); break;
                        case 'settings': vscode.commands.executeCommand('auto-accept.openSettings'); break;
                    }
                }
            }),
            vscode.commands.registerCommand('auto-accept.resetSettings', async () => {
                // Reset all extension settings
                await context.globalState.update(GLOBAL_STATE_KEY, false);
                await context.globalState.update(FREQ_STATE_KEY, 1000);
                await context.globalState.update(BANNED_COMMANDS_KEY, undefined);
                await context.globalState.update(ROI_STATS_KEY, undefined);
                isEnabled = false;
                bannedCommands = [];
                vscode.window.showInformationMessage('Multi Purpose: All settings reset to defaults.');
                updateStatusBar();
            }),
            // Debug Mode Command - Allows AI agent programmatic control
            vscode.commands.registerCommand('auto-accept.debugCommand', async (action, params = {}) => {
                if (debugHandler) {
                    return await debugHandler.handleCommand(action, params);
                }
                return { success: false, error: 'DebugHandler not ready' };
            })
        );

        // Monitor configuration changes for Debug Mode
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('auto-accept.debugMode.enabled') && debugHandler) {
                const enabled = vscode.workspace.getConfiguration('auto-accept.debugMode').get('enabled', false);
                if (enabled) {
                    debugHandler.startServer();
                } else {
                    debugHandler.stopServer();
                }
            }
        }));


        // 7. Check environment and start if enabled
        try {
            await checkEnvironmentAndStart();
        } catch (err) {
            log(`Error in environment check: ${err.message}`);
        }

        log('Multi Purpose: Activation complete');
    } catch (error) {
        console.error('ACTIVATION CRITICAL FAILURE:', error);
        log(`ACTIVATION CRITICAL FAILURE: ${error.message}`);
        vscode.window.showErrorMessage(`Multi Purpose Extension failed to activate: ${error.message}`);
    }
}

async function ensureCDPOrPrompt(showPrompt = false) {
    if (!cdpHandler) return false;

    log('Checking for active CDP session...');
    const cdpAvailable = await cdpHandler.isCDPAvailable();
    log(`Environment check: CDP Available = ${cdpAvailable}`);

    if (cdpAvailable) {
        log('CDP is active and available.');
        return true;
    } else {
        log('CDP not found on port 9004.');
        if (showPrompt && relauncher) {
            log('Initiating CDP setup and relaunch flow...');
            await relauncher.ensureCDPAndRelaunch();
        }
        return false;
    }
}

async function checkEnvironmentAndStart() {
    if (isEnabled) {
        log('Initializing Multi Purpose environment...');
        const cdpReady = await ensureCDPOrPrompt(false);

        if (!cdpReady) {
            // CDP not available - reset to OFF state so user can trigger setup via toggle
            log('Multi Purpose was enabled but CDP is not available. Resetting to OFF state.');
            isEnabled = false;
            await globalContext.globalState.update(GLOBAL_STATE_KEY, false);
        } else {
            await startPolling();
            // Start stats collection if already enabled on startup
            startStatsCollection(globalContext);
        }
    }
    updateStatusBar();
}

async function handleToggle(context) {
    log('=== handleToggle CALLED ===');
    log(`  Previous isEnabled: ${isEnabled}`);

    try {
        // Check CDP availability first
        const cdpAvailable = cdpHandler ? await cdpHandler.isCDPAvailable() : false;

        // If trying to enable but CDP not available, prompt for relaunch (don't change state)
        if (!isEnabled && !cdpAvailable && relauncher) {
            log('Multi Purpose: CDP not available. Prompting for setup/relaunch.');
            await relauncher.ensureCDPAndRelaunch();
            return; // Don't change state - toggle stays OFF
        }

        isEnabled = !isEnabled;
        log(`  New isEnabled: ${isEnabled}`);

        // Update state and UI IMMEDIATELY (non-blocking)
        await context.globalState.update(GLOBAL_STATE_KEY, isEnabled);
        log(`  GlobalState updated`);

        log('  Calling updateStatusBar...');
        updateStatusBar();

        // Do CDP operations in background (don't block toggle)
        if (isEnabled) {
            log('Multi Purpose: Enabled');
            // These operations happen in background
            ensureCDPOrPrompt(true).then(() => startPolling());
            startStatsCollection(context);
            incrementSessionCount(context);
        } else {
            log('Multi Purpose: Disabled');

            // Fire-and-forget: Show session summary notification (non-blocking)
            if (cdpHandler) {
                cdpHandler.getSessionSummary()
                    .then(summary => showSessionSummaryNotification(context, summary))
                    .catch(() => { });
            }

            // Fire-and-forget: collect stats and stop in background
            collectAndSaveStats(context).catch(() => { });
            stopPolling().catch(() => { });
        }

        log('=== handleToggle COMPLETE ===');
    } catch (e) {
        log(`Error toggling: ${e.message}`);
        log(`Error stack: ${e.stack}`);
    }
}

async function handleRelaunch() {
    if (!relauncher) {
        vscode.window.showErrorMessage('Relauncher not initialized.');
        return;
    }

    log('Initiating Relaunch sequence...');
    await relauncher.ensureCDPAndRelaunch();
}

async function handleFrequencyUpdate(context, freq) {
    pollFrequency = freq;
    await context.globalState.update(FREQ_STATE_KEY, freq);
    log(`Poll frequency updated to: ${freq}ms`);
    if (isEnabled) {
        await syncSessions();
    }
}

async function handleBannedCommandsUpdate(context, commands) {
    bannedCommands = Array.isArray(commands) ? commands : [];
    await context.globalState.update(BANNED_COMMANDS_KEY, bannedCommands);
    log(`Banned commands updated: ${bannedCommands.length} patterns`);
    if (bannedCommands.length > 0) {
        log(`Banned patterns: ${bannedCommands.slice(0, 5).join(', ')}${bannedCommands.length > 5 ? '...' : ''}`);
    }
    if (isEnabled) {
        await syncSessions();
    }
}

async function syncSessions() {
    if (cdpHandler && !isLockedOut) {
        log(`CDP: Syncing sessions...`);
        try {
            await cdpHandler.start({
                pollInterval: pollFrequency,
                ide: currentIDE,
                bannedCommands: bannedCommands
            });
        } catch (err) {
            log(`CDP: Sync error: ${err.message}`);
        }
    }
}

// Update Queue Status Bar
function updateQueueStatusBar() {
    if (!statusQueueItem || !scheduler) return;

    const status = scheduler.getStatus();

    if (status.isRunningQueue) {
        statusQueueItem.show();
        const pauseIndicator = status.isPaused ? ' \u{23F3}' : '';
        statusQueueItem.text = `\u{1F4CB} Queue ${status.queueIndex + 1}/${status.queueLength}${pauseIndicator}`;
        statusQueueItem.tooltip = status.isPaused
            ? 'Queue is paused - Click to resume'
            : `Running prompt ${status.queueIndex + 1} of ${status.queueLength} - Click for controls`;
    } else {
        statusQueueItem.hide();
    }
}

async function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    log('Multi Purpose: Monitoring session...');

    // Initial trigger
    await syncSessions();

    // Polling now primarily handles the Instance Lock and ensures CDP is active
    pollTimer = setInterval(async () => {
        if (!isEnabled) return;

        // Check for instance locking - only the first extension instance should control CDP
        const lockKey = `${currentIDE.toLowerCase()}-instance-lock`;
        const activeInstance = globalContext.globalState.get(lockKey);
        const myId = globalContext.extension.id;

        if (activeInstance && activeInstance !== myId) {
            const lastPing = globalContext.globalState.get(`${lockKey}-ping`);
            if (lastPing && (Date.now() - lastPing) < 15000) {
                if (!isLockedOut) {
                    log(`CDP Control: Locked by another instance (${activeInstance}). Standby mode.`);
                    isLockedOut = true;
                    updateStatusBar();
                }
                return;
            }
        }

        // We are the leader or lock is dead
        globalContext.globalState.update(lockKey, myId);
        globalContext.globalState.update(`${lockKey}-ping`, Date.now());

        if (isLockedOut) {
            log('CDP Control: Lock acquired. Resuming control.');
            isLockedOut = false;
            updateStatusBar();
        }

        await syncSessions();
    }, 5000);
}

async function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    if (statsCollectionTimer) {
        clearInterval(statsCollectionTimer);
        statsCollectionTimer = null;
    }
    if (scheduler) scheduler.stop();
    if (cdpHandler) await cdpHandler.stop();
    log('Multi Purpose: Polling stopped');
}

// --- ROI Stats Collection ---

function getWeekStart() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday
    const diff = now.getDate() - dayOfWeek;
    const weekStart = new Date(now.setDate(diff));
    weekStart.setHours(0, 0, 0, 0);
    return weekStart.getTime();
}

async function loadROIStats(context) {
    const defaultStats = {
        weekStart: getWeekStart(),
        clicksThisWeek: 0,
        blockedThisWeek: 0,
        sessionsThisWeek: 0
    };

    let stats = context.globalState.get(ROI_STATS_KEY, defaultStats);

    // Check if we need to reset for a new week
    const currentWeekStart = getWeekStart();
    if (stats.weekStart !== currentWeekStart) {
        log(`ROI Stats: New week detected. Showing summary and resetting.`);

        // Show weekly summary notification if there were meaningful stats
        if (stats.clicksThisWeek > 0) {
            await showWeeklySummaryNotification(context, stats);
        }

        // Reset for new week
        stats = { ...defaultStats, weekStart: currentWeekStart };
        await context.globalState.update(ROI_STATS_KEY, stats);
    }

    // Calculate formatted time for UI
    const timeSavedSeconds = (stats.clicksThisWeek || 0) * SECONDS_PER_CLICK;
    const timeSavedMinutes = Math.round(timeSavedSeconds / 60);
    let timeStr;
    if (timeSavedMinutes >= 60) {
        timeStr = `${(timeSavedMinutes / 60).toFixed(1)}h`;
    } else {
        timeStr = `${timeSavedMinutes}m`;
    }
    stats.timeSavedFormatted = timeStr;

    return stats;
}

async function showWeeklySummaryNotification(context, lastWeekStats) {
    const timeSavedSeconds = lastWeekStats.clicksThisWeek * SECONDS_PER_CLICK;
    const timeSavedMinutes = Math.round(timeSavedSeconds / 60);

    let timeStr;
    if (timeSavedMinutes >= 60) {
        timeStr = `${(timeSavedMinutes / 60).toFixed(1)} hours`;
    } else {
        timeStr = `${timeSavedMinutes} minutes`;
    }

    const message = `\u{1F4CA} Last week, Multi Purpose saved you ${timeStr} by auto-clicking ${lastWeekStats.clicksThisWeek} buttons!`;

    let detail = '';
    if (lastWeekStats.sessionsThisWeek > 0) {
        detail += `Recovered ${lastWeekStats.sessionsThisWeek} stuck sessions. `;
    }
    if (lastWeekStats.blockedThisWeek > 0) {
        detail += `Blocked ${lastWeekStats.blockedThisWeek} dangerous commands.`;
    }

    const choice = await vscode.window.showInformationMessage(
        message,
        { detail: detail.trim() || undefined },
        'View Details'
    );

    if (choice === 'View Details') {
        const panel = getSettingsPanel();
        if (panel) {
            panel.createOrShow(context.extensionUri, context);
        }
    }
}

// --- SESSION SUMMARY NOTIFICATION ---
// Called when user finishes a session (e.g., leaves conversation view)
async function showSessionSummaryNotification(context, summary) {
    log(`[Notification] showSessionSummaryNotification called with: ${JSON.stringify(summary)}`);
    if (!summary || summary.clicks === 0) {
        log(`[Notification] Session summary skipped: no clicks`);
        return;
    }
    log(`[Notification] Showing session summary for ${summary.clicks} clicks`);

    const lines = [
        `\u{1F7E2} This session:`,
        `- ${summary.clicks} actions auto-accepted`,
        `- ${summary.terminalCommands} terminal commands`,
        `- ${summary.fileEdits} file edits`,
        `- ${summary.blocked} interruptions blocked`
    ];

    if (summary.estimatedTimeSaved) {
        lines.push(`\n\u{23F3} Estimated time saved: ~${summary.estimatedTimeSaved} minutes`);
    }

    const message = lines.join('\n');

    vscode.window.showInformationMessage(
        `\u{1F916} Multi Purpose: ${summary.clicks} actions handled this session`,
        { detail: message },
        'View Stats'
    ).then(choice => {
        if (choice === 'View Stats') {
            const panel = getSettingsPanel();
            if (panel) panel.createOrShow(context.extensionUri, context);
        }
    });
}

// --- "AWAY" ACTIONS NOTIFICATION ---
// Called when user returns after window was minimized/unfocused
async function showAwayActionsNotification(context, actionsCount) {
    log(`[Notification] showAwayActionsNotification called with: ${actionsCount}`);
    if (!actionsCount || actionsCount === 0) {
        log(`[Notification] Away actions skipped: count is 0 or undefined`);
        return;
    }
    log(`[Notification] Showing away actions notification for ${actionsCount} actions`);

    const message = `\u{1F680} Multi Purpose handled ${actionsCount} action${actionsCount > 1 ? 's' : ''} while you were away.`;
    const detail = `Agents stayed autonomous while you focused elsewhere.`;

    vscode.window.showInformationMessage(
        message,
        { detail },
        'View Dashboard'
    ).then(choice => {
        if (choice === 'View Dashboard') {
            const panel = getSettingsPanel();
            if (panel) panel.createOrShow(context.extensionUri, context);
        }
    });
}

// --- AWAY MODE POLLING ---
// Check for "away actions" when user returns (called periodically)
let lastAwayCheck = Date.now();
async function checkForAwayActions(context) {
    log(`[Away] checkForAwayActions called. cdpHandler=${!!cdpHandler}, isEnabled=${isEnabled}`);
    if (!cdpHandler || !isEnabled) {
        log(`[Away] Skipping check: cdpHandler=${!!cdpHandler}, isEnabled=${isEnabled}`);
        return;
    }

    try {
        log(`[Away] Calling cdpHandler.getAwayActions()...`);
        const awayActions = await cdpHandler.getAwayActions();
        log(`[Away] Got awayActions: ${awayActions}`);
        if (awayActions > 0) {
            log(`[Away] Detected ${awayActions} actions while user was away. Showing notification...`);
            await showAwayActionsNotification(context, awayActions);
        } else {
            log(`[Away] No away actions to report`);
        }
    } catch (e) {
        log(`[Away] Error checking away actions: ${e.message}`);
    }
}

async function collectAndSaveStats(context) {
    if (!cdpHandler) return;

    try {
        // Get stats from browser and reset them
        const browserStats = await cdpHandler.resetStats();

        if (browserStats.clicks > 0 || browserStats.blocked > 0) {
            const currentStats = await loadROIStats(context);
            currentStats.clicksThisWeek += browserStats.clicks;
            currentStats.blockedThisWeek += browserStats.blocked;

            await context.globalState.update(ROI_STATS_KEY, currentStats);
            log(`ROI Stats collected: +${browserStats.clicks} clicks, +${browserStats.blocked} blocked (Total: ${currentStats.clicksThisWeek} clicks, ${currentStats.blockedThisWeek} blocked)`);

            // Broadcast update to real-time dashboard
            const panel = getSettingsPanel();
            if (panel) {
                panel.sendROIStats();
            }
        }
    } catch (e) {
        // Silently fail - stats collection should not interrupt normal operation
    }
}

async function incrementSessionCount(context) {
    const stats = await loadROIStats(context);
    stats.sessionsThisWeek++;
    await context.globalState.update(ROI_STATS_KEY, stats);
    log(`ROI Stats: Session count incremented to ${stats.sessionsThisWeek}`);
}

function startStatsCollection(context) {
    if (statsCollectionTimer) clearInterval(statsCollectionTimer);

    // Collect stats every 30 seconds and check for away actions
    statsCollectionTimer = setInterval(() => {
        if (isEnabled) {
            collectAndSaveStats(context);
            checkForAwayActions(context); // Check if user returned from away
        }
    }, 30000);

    log('ROI Stats: Collection started (every 30s)');
}


function updateStatusBar() {
    if (!statusBarItem) return;

    if (isEnabled) {
        let statusText = 'ON';
        let tooltip = `Multi Purpose is running.`;
        let bgColor = undefined;
        let icon = '\u{2705}';

        const cdpConnected = cdpHandler && cdpHandler.getConnectionCount() > 0;

        if (cdpConnected) {
            tooltip += ' (CDP Connected)';
        }

        if (isLockedOut) {
            statusText = 'PAUSED (Multi-window)';
            bgColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            icon = '\u{1F504}';
        }

        statusBarItem.text = `${icon} Multi Purpose: ${statusText}`;
        statusBarItem.tooltip = tooltip;
        statusBarItem.backgroundColor = bgColor;

    } else {
        statusBarItem.text = '\u{2B55} Multi Purpose: OFF';
        statusBarItem.tooltip = 'Click to enable Multi Purpose.';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}


// --- Antigravity Backend Integration ---

/**
 * Initialize the Antigravity client connection (non-blocking)
 */
async function initAntigravityClient() {
    try {
        const ClientClass = getAntigravityClient();
        if (!ClientClass) {
            log('[Antigravity] Failed to load AntigravityClient class');
            return false;
        }

        antigravityClient = new ClientClass(log);
        const connected = await antigravityClient.connect();

        if (connected) {
            log('[Antigravity] Client connected successfully');
            return true;
        } else {
            log('[Antigravity] Client connection failed');
            return false;
        }
    } catch (e) {
        log(`[Antigravity] Init error: ${e.message}`);
        return false;
    }
}

/**
 * Handle the checkAntigravityStatus command
 */
async function handleCheckAntigravityStatus() {
    log('[Antigravity] Checking status...');

    // Try to connect if not already connected
    if (!antigravityClient || !antigravityClient.isConnected()) {
        const connected = await initAntigravityClient();

        if (!connected) {
            vscode.window.showWarningMessage(
                'Antigravity: Could not connect to language server. Is Antigravity running?'
            );
            return { connected: false };
        }
    }

    const status = antigravityClient.getStatus();
    vscode.window.showInformationMessage(`Antigravity: ${status}`);
    return { connected: true, status };
}

/**
 * Handle the getAntigravityQuota command - returns quota data for settings panel
 */
async function handleGetAntigravityQuota() {
    log('[Antigravity] Fetching quota...');

    // Try to connect if not already connected
    if (!antigravityClient || !antigravityClient.isConnected()) {
        const connected = await initAntigravityClient();
        if (!connected) {
            return null;
        }
    }

    try {
        return await antigravityClient.getUserStatus();
    } catch (e) {
        log(`[Antigravity] Quota fetch error: ${e.message}`);
        return null;
    }
}

/**
 * Update the quota status bar item
 */
function updateQuotaStatusBar(text, tooltip) {
    if (statusQuotaItem) {
        statusQuotaItem.text = `\u{1F4CA} ${text}`;
        statusQuotaItem.tooltip = tooltip || 'Antigravity Quota - Click to view details';
    }
}

/**
 * Fetch quota and update status bar
 */
async function refreshQuotaStatus() {
    if (!antigravityClient || !antigravityClient.isConnected()) {
        updateQuotaStatusBar('N/A', 'Not connected to Antigravity');
        return;
    }

    try {
        const snapshot = await antigravityClient.getUserStatus();

        // Determine if any model is exhausted
        let anyExhausted = false;

        if (snapshot.models && snapshot.models.length > 0) {
            // Find the model with lowest quota for the icon
            // Find the model with lowest quota for the icon
            const sortedModels = snapshot.models
                .sort((a, b) => {
                    // Exhausted first
                    if (a.isExhausted && !b.isExhausted) return -1;
                    if (!a.isExhausted && b.isExhausted) return 1;

                    // Then by percentage
                    const pA = a.remainingPercentage !== undefined ? a.remainingPercentage : 0;
                    const pB = b.remainingPercentage !== undefined ? b.remainingPercentage : 0;
                    return pA - pB;
                });

            const lowestModel = sortedModels[0];

            // Check if any model is exhausted
            anyExhausted = snapshot.models.some(m => m.isExhausted === true);

            if (lowestModel) {
                const pct = (lowestModel.remainingPercentage !== undefined ? lowestModel.remainingPercentage : 0).toFixed(0) + '%';
                const icon = lowestModel.isExhausted ? '\u{1F534}' :
                    lowestModel.remainingPercentage < 20 ? '\u{1F7E0}' : '\u{1F7E2}';

                // Build tooltip with ALL model quotas
                const tooltipLines = ['\u{1F4CA} Antigravity Model Quotas:'];
                for (const model of snapshot.models) {
                    const mIcon = model.isExhausted ? '\u{1F534}' :
                        model.remainingPercentage < 20 ? '\u{1F7E0}' : '\u{1F7E2}';
                    const mPct = (model.remainingPercentage !== undefined ? model.remainingPercentage : 0).toFixed(0) + '%';

                    const resetInfo = model.timeUntilResetFormatted ? ` - ${model.timeUntilResetFormatted}` : '';
                    tooltipLines.push(`${mIcon} ${model.label}: ${mPct}${resetInfo}`);
                }
                tooltipLines.push('', 'Click to view details');

                updateQuotaStatusBar(
                    `${icon} ${pct}`,
                    tooltipLines.join('\n')
                );
            } else {
                updateQuotaStatusBar('OK', 'Quota available');
            }
        } else if (snapshot.promptCredits) {
            const pct = snapshot.promptCredits.remainingPercentage.toFixed(0);
            updateQuotaStatusBar(
                `${pct}%`,
                `Prompt Credits: ${snapshot.promptCredits.available}/${snapshot.promptCredits.monthly}`
            );
        } else {
            updateQuotaStatusBar('OK', 'Connected to Antigravity');
        }

        // Notify scheduler of quota status change
        if (scheduler) {
            scheduler.setQuotaExhausted(anyExhausted);
        }
    } catch (e) {
        log(`[Antigravity] Quota refresh error: ${e.message}`);
        updateQuotaStatusBar('ERR', `Error: ${e.message}`);
    }
}

/**
 * Start polling for quota updates
 */
function startQuotaPolling(intervalMs = 120000) {
    stopQuotaPolling();

    // Initial fetch
    refreshQuotaStatus();

    // Start polling
    quotaPollingTimer = setInterval(() => {
        refreshQuotaStatus();
    }, intervalMs);

    log(`[Antigravity] Quota polling started (interval: ${intervalMs}ms)`);
}

/**
 * Stop quota polling
 */
function stopQuotaPolling() {
    if (quotaPollingTimer) {
        clearInterval(quotaPollingTimer);
        quotaPollingTimer = null;
        log('[Antigravity] Quota polling stopped');
    }
}

/**
 * Toggle Antigravity Quota display
 */
function handleToggleAntigravityQuota(enabled) {
    const config = vscode.workspace.getConfiguration('auto-accept.antigravityQuota');
    config.update('enabled', enabled, vscode.ConfigurationTarget.Global);

    if (enabled) {
        if (statusQuotaItem) statusQuotaItem.show();

        if (antigravityClient && antigravityClient.isConnected()) {
            const pollInterval = config.get('pollInterval', 120) * 1000;
            startQuotaPolling(pollInterval);
        } else {
            initAntigravityClient().then(connected => {
                if (connected) {
                    const pollInterval = config.get('pollInterval', 120) * 1000;
                    startQuotaPolling(pollInterval);
                }
            });
        }
    } else {
        stopQuotaPolling();
        if (statusQuotaItem) statusQuotaItem.hide();
    }
}

// --- Debug HTTP Server ---
function startDebugServer() {
    if (debugServer) return;

    // Check if debug mode is enabled
    const debugEnabled = vscode.workspace.getConfiguration('auto-accept.debugMode').get('enabled', false);
    if (!debugEnabled) return;

    try {
        debugServer = http.createServer(async (req, res) => {
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
                res.end('Method not allowed');
                return;
            }

            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    let data = {};
                    if (body) {
                        data = JSON.parse(body);
                    }
                    const { action, params } = data;
                    log(`[DebugServer] Received action: ${action}`);

                    const result = await vscode.commands.executeCommand('auto-accept.debugCommand', action, params);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: e.message }));
                }
            });
        });

        debugServer.listen(54321, '127.0.0.1', () => {
            log('Debug Server running on http://127.0.0.1:54321');
        });

        debugServer.on('error', (e) => {
            log(`Debug Server Error: ${e.message}`);
            debugServer = null;
        });

    } catch (e) {
        log(`Failed to start Debug Server: ${e.message}`);
    }
}

function stopDebugServer() {
    if (debugServer) {
        debugServer.close();
        debugServer = null;
        log('Debug Server stopped');
    }
}

function deactivate() {
    stopPolling();
    stopQuotaPolling();
    stopDebugServer(); // Ensure server is stopped
    if (cdpHandler) {
        cdpHandler.stop();
    }
    if (antigravityClient) {
        antigravityClient.disconnect();
        antigravityClient = null;
    }
}

module.exports = { activate, deactivate };
