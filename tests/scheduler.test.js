/**
 * Unit Tests for Scheduler Class
 * Tests the Sequential Prompt Queue implementation
 */

const assert = require('assert');

// Dynamic mock config - can be modified per test
let mockConfig = {
    enabled: true,
    mode: 'queue',
    value: '30',
    prompt: 'Status report',
    prompts: ['Task A', 'Task B'],
    queueMode: 'consume',
    silenceTimeout: 30,
    'checkPrompt.enabled': false,
    'checkPrompt.text': 'Check prompt'
};

// Reset config to defaults
function resetMockConfig() {
    mockConfig = {
        enabled: true,
        mode: 'queue',
        value: '30',
        prompt: 'Status report',
        prompts: ['Task A', 'Task B'],
        queueMode: 'consume',
        silenceTimeout: 30,
        'checkPrompt.enabled': false,
        'checkPrompt.text': 'Check prompt'
    };
}

// Mock vscode
const mockVscode = {
    workspace: {
        getConfiguration: (section) => ({
            get: (key, defaultValue) => {
                if (section === 'auto-accept.schedule') {
                    return mockConfig[key] !== undefined ? mockConfig[key] : defaultValue;
                }
                if (section === 'auto-accept.antigravityQuota.resume') {
                    return key === 'enabled' ? true : defaultValue;
                }
                return defaultValue;
            },
            update: async () => true
        })
    },
    window: {
        showInformationMessage: () => { },
        showWarningMessage: () => { }
    },
    ConfigurationTarget: { Global: 1 }
};

// Mock CDPHandler
const mockCdpHandler = {
    sendPrompt: async (text, targetConversation) => {
        mockCdpHandler.lastPrompt = text;
        mockCdpHandler.lastTarget = targetConversation || '';
        mockCdpHandler.sendCount = (mockCdpHandler.sendCount || 0) + 1;
        return 1; // Return count (1 tab) to match real implementation
    },
    getStats: async () => ({ clicks: mockCdpHandler.clickCount || 0 }),
    lastPrompt: null,
    lastTarget: '',
    sendCount: 0,
    clickCount: 0
};

// Create a simplified Scheduler for testing
class TestScheduler {
    constructor(context, cdpHandler, logFn) {
        this.context = context;
        this.cdpHandler = cdpHandler;
        this.log = logFn || (() => { });
        this.runtimeQueue = [];
        this.queueIndex = 0;
        this.isRunningQueue = false;
        this.isQuotaExhausted = false;
        this.config = {};
        this.enabled = false;
        this.lastClickTime = 0;
        this.lastClickCount = 0;
        this.taskStartTime = 0;

        // Multi-queue ready fields
        this.targetConversation = '';
        this.promptHistory = [];
        this.conversationStatus = 'idle';
        this.isPaused = false;
        this.promptQueue = Promise.resolve();
    }

    loadConfig() {
        const cfg = mockVscode.workspace.getConfiguration('auto-accept.schedule');
        this.enabled = cfg.get('enabled', false);
        this.config = {
            mode: cfg.get('mode', 'interval'),
            prompts: cfg.get('prompts', []),
            queueMode: cfg.get('queueMode', 'consume'),
            silenceTimeout: cfg.get('silenceTimeout', 30) * 1000,
            checkPromptEnabled: cfg.get('checkPrompt.enabled', false),
            checkPromptText: cfg.get('checkPrompt.text', 'Check prompt')
        };
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

    async startQueue() {
        this.loadConfig();
        if (this.config.mode !== 'queue') {
            return { error: 'Not in queue mode' };
        }

        this.runtimeQueue = this.buildRuntimeQueue();
        this.queueIndex = 0;
        this.isRunningQueue = true;
        this.lastClickCount = 0;
        this.lastClickTime = Date.now();
        this.taskStartTime = Date.now();

        if (this.runtimeQueue.length === 0) {
            this.isRunningQueue = false;
            return { error: 'Queue is empty' };
        }

        await this.executeCurrentQueueItem();
        return { success: true };
    }

    async advanceQueue() {
        if (!this.isRunningQueue) return;

        this.queueIndex++;
        this.lastClickCount = 0;
        this.lastClickTime = Date.now();
        this.taskStartTime = Date.now();

        if (this.queueIndex >= this.runtimeQueue.length) {
            if (this.config.queueMode === 'loop' && this.runtimeQueue.length > 0) {
                this.queueIndex = 0;
            } else {
                this.isRunningQueue = false;
                return { completed: true };
            }
        }

        await this.executeCurrentQueueItem();
        return { advanced: true };
    }

    async executeCurrentQueueItem() {
        if (this.queueIndex >= this.runtimeQueue.length) return;
        const item = this.runtimeQueue[this.queueIndex];
        await this.sendPrompt(item.text);
    }

    async sendPrompt(text) {
        if (text && this.cdpHandler) {
            await this.cdpHandler.sendPrompt(text, this.targetConversation);
        }
    }

    async queuePrompt(text) {
        this.promptQueue = this.promptQueue.then(async () => {
            if (text && this.cdpHandler) {
                await this.cdpHandler.sendPrompt(text, this.targetConversation);
            }
        }).catch(err => {
            this.log(`Scheduler Error: ${err.message}`);
        });
        return this.promptQueue;
    }

    setQuotaExhausted(exhausted) {
        const wasExhausted = this.isQuotaExhausted;
        this.isQuotaExhausted = exhausted;
        return { wasExhausted, nowExhausted: exhausted };
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
            isPaused: this.isPaused
        };
    }

    // Multi-queue ready methods
    addToHistory(text, conversationId) {
        this.promptHistory.push({
            text: text.substring(0, 100),
            fullText: text,
            timestamp: Date.now(),
            status: 'sent',
            conversationId: conversationId || this.targetConversation || 'current'
        });
        if (this.promptHistory.length > 50) {
            this.promptHistory.shift();
        }
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

    setTargetConversation(id) {
        this.targetConversation = id || '';
    }

    // Queue control methods
    pauseQueue() {
        if (!this.isRunningQueue || this.isPaused) return false;
        this.isPaused = true;
        return true;
    }

    resumeQueue() {
        if (!this.isRunningQueue || !this.isPaused) return false;
        this.isPaused = false;
        return true;
    }

    async skipPrompt() {
        if (!this.isRunningQueue) return false;
        this.queueIndex++;
        this.isPaused = false;
        if (this.queueIndex >= this.runtimeQueue.length) {
            this.isRunningQueue = false;
            this.conversationStatus = 'idle';
        }
        return true;
    }

    stopQueue() {
        if (!this.isRunningQueue && this.runtimeQueue.length === 0) return false;
        this.isRunningQueue = false;
        this.runtimeQueue = [];
        this.queueIndex = 0;
        this.conversationStatus = 'idle';
        this.isPaused = false;
        return true;
    }

    getCurrentPrompt() {
        if (!this.isRunningQueue || this.queueIndex >= this.runtimeQueue.length) return null;
        return this.runtimeQueue[this.queueIndex];
    }
}

// Test Suite
console.log('\n=== Scheduler Unit Tests ===\n');

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        resetMockConfig();
        mockCdpHandler.lastPrompt = null;
        await fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`✗ ${name}`);
        console.log(`  Error: ${e.message}`);
        failed++;
    }
}

async function runTests() {
    // Test 1: buildRuntimeQueue without check prompts
    await test('buildRuntimeQueue creates correct queue without check prompts', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        scheduler.loadConfig();

        const queue = scheduler.buildRuntimeQueue();

        assert.strictEqual(queue.length, 2);
        assert.strictEqual(queue[0].type, 'task');
        assert.strictEqual(queue[0].text, 'Task A');
        assert.strictEqual(queue[1].text, 'Task B');
    });

    // Test 2: buildRuntimeQueue with check prompts
    await test('buildRuntimeQueue interleaves check prompts correctly', async () => {
        mockConfig['checkPrompt.enabled'] = true;
        mockConfig['checkPrompt.text'] = 'Check this';

        const scheduler = new TestScheduler({}, mockCdpHandler);
        scheduler.loadConfig();

        const queue = scheduler.buildRuntimeQueue();

        assert.strictEqual(queue.length, 4);
        assert.strictEqual(queue[0].type, 'task');
        assert.strictEqual(queue[1].type, 'check');
        assert.strictEqual(queue[1].text, 'Check this');
    });

    // Test 3: startQueue sends first prompt
    await test('startQueue sends first prompt', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        const result = await scheduler.startQueue();

        assert.strictEqual(result.success, true);
        assert.strictEqual(mockCdpHandler.lastPrompt, 'Task A');
        assert.strictEqual(scheduler.isRunningQueue, true);
    });

    // Test 4: startQueue with empty queue
    await test('startQueue returns error for empty queue', async () => {
        mockConfig.prompts = [];

        const scheduler = new TestScheduler({}, mockCdpHandler);
        const result = await scheduler.startQueue();

        assert.strictEqual(result.error, 'Queue is empty');
        assert.strictEqual(scheduler.isRunningQueue, false);
    });

    // Test 5: advanceQueue moves to next item
    await test('advanceQueue moves to next item', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        await scheduler.startQueue();

        await scheduler.advanceQueue();

        assert.strictEqual(scheduler.queueIndex, 1);
        assert.strictEqual(mockCdpHandler.lastPrompt, 'Task B');
    });

    // Test 6: Queue completes and stops in consume mode
    await test('Queue completes and stops in consume mode', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        await scheduler.startQueue();

        await scheduler.advanceQueue(); // Task B
        const result = await scheduler.advanceQueue(); // Complete

        assert.strictEqual(result.completed, true);
        assert.strictEqual(scheduler.isRunningQueue, false);
    });

    // Test 7: Queue loops in loop mode
    await test('Queue loops in loop mode', async () => {
        mockConfig.queueMode = 'loop';

        const scheduler = new TestScheduler({}, mockCdpHandler);
        await scheduler.startQueue();

        await scheduler.advanceQueue(); // Task B
        await scheduler.advanceQueue(); // Loop to Task A

        assert.strictEqual(scheduler.queueIndex, 0);
        assert.strictEqual(scheduler.isRunningQueue, true);
    });

    // Test 8: setQuotaExhausted tracks state transitions
    await test('setQuotaExhausted tracks state transitions', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);

        let result = scheduler.setQuotaExhausted(true);
        assert.strictEqual(result.wasExhausted, false);
        assert.strictEqual(result.nowExhausted, true);

        result = scheduler.setQuotaExhausted(false);
        assert.strictEqual(result.wasExhausted, true);
        assert.strictEqual(result.nowExhausted, false);
    });

    // Test 9: getStatus returns correct info
    await test('getStatus returns correct queue information', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        await scheduler.startQueue();

        const status = scheduler.getStatus();

        assert.strictEqual(status.isRunningQueue, true);
        assert.strictEqual(status.queueLength, 2);
        assert.strictEqual(status.queueIndex, 0);
    });

    // Test 10: getStatus shows correct info when not started
    await test('getStatus shows Not Started when queue not running', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        scheduler.loadConfig();

        const status = scheduler.getStatus();

        assert.strictEqual(status.isRunningQueue, false);
        assert.strictEqual(status.queueLength, 0); // Runtime queue not built yet
        assert.strictEqual(status.isQuotaExhausted, false);
    });

    // Test 11: getStatus shows paused state when quota exhausted
    await test('getStatus shows quota exhausted state', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        await scheduler.startQueue();
        scheduler.setQuotaExhausted(true);

        const status = scheduler.getStatus();

        assert.strictEqual(status.isRunningQueue, true);
        assert.strictEqual(status.isQuotaExhausted, true);
    });

    // Test 12: getStatus tracks queue progress correctly
    await test('getStatus tracks queue progress through items', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        await scheduler.startQueue();

        let status = scheduler.getStatus();
        assert.strictEqual(status.queueIndex, 0);
        assert.strictEqual(status.queueLength, 2);

        await scheduler.advanceQueue();
        status = scheduler.getStatus();
        assert.strictEqual(status.queueIndex, 1);
    });

    // Test 13: getStatus shows completed state
    await test('getStatus shows completed state after queue finishes', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        await scheduler.startQueue();
        await scheduler.advanceQueue(); // Task B
        await scheduler.advanceQueue(); // Complete

        const status = scheduler.getStatus();

        assert.strictEqual(status.isRunningQueue, false);
        assert.strictEqual(status.queueIndex, 2);
    });

    // Test 14: Mode returned in status
    await test('getStatus includes mode in response', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        scheduler.loadConfig();

        const status = scheduler.getStatus();

        assert.strictEqual(status.mode, 'queue');
    });

    // Test 15: addToHistory creates entry
    await test('addToHistory creates history entry', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        scheduler.addToHistory('Test prompt for history', 'chat-1');

        assert.strictEqual(scheduler.promptHistory.length, 1);
        assert.strictEqual(scheduler.promptHistory[0].text, 'Test prompt for history');
        assert.strictEqual(scheduler.promptHistory[0].conversationId, 'chat-1');
    });

    // Test 16: getHistory returns formatted entries
    await test('getHistory returns formatted entries with timeAgo', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        scheduler.addToHistory('Recent prompt', '');

        const history = scheduler.getHistory();

        assert.strictEqual(history.length, 1);
        assert.strictEqual(history[0].timeAgo, 'just now');
        assert.strictEqual(history[0].conversation, 'current');
    });

    // Test 17: History respects 50-item limit
    await test('History respects 50-item limit', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);

        // Add 55 items
        for (let i = 0; i < 55; i++) {
            scheduler.addToHistory(`Prompt ${i}`, 'chat');
        }

        assert.strictEqual(scheduler.promptHistory.length, 50);
        assert.strictEqual(scheduler.promptHistory[0].text, 'Prompt 5'); // First 5 removed
    });

    // Test 18: formatTimeAgo formats correctly
    await test('formatTimeAgo formats time correctly', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        const now = Date.now();

        assert.strictEqual(scheduler.formatTimeAgo(now - 30000), 'just now');
        assert.strictEqual(scheduler.formatTimeAgo(now - 120000), '2m ago');
        assert.strictEqual(scheduler.formatTimeAgo(now - 7200000), '2h ago');
    });

    // Test 19: setTargetConversation updates state
    await test('setTargetConversation updates target', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);

        scheduler.setTargetConversation('my-chat');
        assert.strictEqual(scheduler.targetConversation, 'my-chat');

        scheduler.setTargetConversation('');
        assert.strictEqual(scheduler.targetConversation, '');
    });

    // Test 20: pauseQueue/resumeQueue toggle pause state
    await test('pauseQueue and resumeQueue toggle pause state', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        scheduler.isRunningQueue = true;
        scheduler.runtimeQueue = [{ text: 'test' }];

        assert.strictEqual(scheduler.isPaused, false);
        scheduler.pauseQueue();
        assert.strictEqual(scheduler.isPaused, true);
        scheduler.resumeQueue();
        assert.strictEqual(scheduler.isPaused, false);
    });

    // Test 21: skipPrompt advances queue
    await test('skipPrompt advances queue index', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        scheduler.isRunningQueue = true;
        scheduler.runtimeQueue = [{ text: 'one' }, { text: 'two' }, { text: 'three' }];
        scheduler.queueIndex = 0;

        await scheduler.skipPrompt();
        assert.strictEqual(scheduler.queueIndex, 1);
    });

    // Test 22: stopQueue clears queue
    await test('stopQueue clears queue and resets state', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        scheduler.isRunningQueue = true;
        scheduler.runtimeQueue = [{ text: 'one' }, { text: 'two' }];
        scheduler.queueIndex = 1;
        scheduler.isPaused = true;

        scheduler.stopQueue();
        assert.strictEqual(scheduler.isRunningQueue, false);
        assert.strictEqual(scheduler.runtimeQueue.length, 0);
        assert.strictEqual(scheduler.queueIndex, 0);
        assert.strictEqual(scheduler.isPaused, false);
    });

    // Test 23: getCurrentPrompt returns current item
    await test('getCurrentPrompt returns current queue item', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        scheduler.isRunningQueue = true;
        scheduler.runtimeQueue = [{ text: 'first' }, { text: 'second' }];
        scheduler.queueIndex = 1;

        const current = scheduler.getCurrentPrompt();
        assert.strictEqual(current.text, 'second');
    });

    // Test 24: queuePrompt passes targetConversation to CDP handler
    await test('queuePrompt passes targetConversation to CDP handler', async () => {
        const scheduler = new TestScheduler({}, mockCdpHandler);
        scheduler.enabled = true;
        scheduler.targetConversation = 'test-conversation';

        const initialCount = mockCdpHandler.sendCount;
        await scheduler.queuePrompt('Hello world');
        await scheduler.promptQueue; // Wait for queue to complete

        assert.strictEqual(mockCdpHandler.lastPrompt, 'Hello world');
        assert.strictEqual(mockCdpHandler.lastTarget, 'test-conversation');
        assert.strictEqual(mockCdpHandler.sendCount, initialCount + 1);
    });

    await test('CDPHandler.isCDPAvailable uses only port 9004', async () => {
        const { CDPHandler } = require('../main_scripts/cdp-handler');
        const handler = new CDPHandler(() => { });
        const requestedPorts = [];
        handler._getPages = async (port) => {
            requestedPorts.push(port);
            return [{ id: 'page-1' }];
        };

        const ok = await handler.isCDPAvailable();

        assert.strictEqual(ok, true);
        assert.deepStrictEqual(requestedPorts, [9004]);
    });

    await test('CDPHandler.start fetches pages on port 9004 only', async () => {
        const { CDPHandler } = require('../main_scripts/cdp-handler');
        const handler = new CDPHandler(() => { });
        const requestedPorts = [];
        const connectedIds = [];
        const injectedIds = [];

        handler._getPages = async (port) => {
            requestedPorts.push(port);
            return [{
                id: 'page-1',
                title: 'Test Page',
                url: 'https://example.test',
                webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/page-1'
            }];
        };
        handler._connect = async (id) => {
            connectedIds.push(id);
            handler.connections.set(id, { ws: null, injected: false });
        };
        handler._inject = async (id) => {
            injectedIds.push(id);
        };

        await handler.start({ ide: 'antigravity', pollInterval: 50 });

        assert.deepStrictEqual(requestedPorts, [9004]);
        assert.deepStrictEqual(connectedIds, ['9004:page-1']);
        assert.deepStrictEqual(injectedIds, ['9004:page-1']);
        assert.strictEqual(handler.getConnectionCount(), 1);
    });

    await test('DebugHandler.getLatestCdpLogPath picks newest multi-purpose log', async () => {
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const Module = require('module');

        const originalLoad = Module._load;
        Module._load = function (request, parent, isMain) {
            if (request === 'vscode') {
                return {
                    workspace: { getConfiguration: () => ({ get: () => false }) },
                    window: {},
                    commands: {}
                };
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        try {
            const { DebugHandler } = require('../main_scripts/debug-handler');

            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpa-logs-'));
            const older = path.join(tmpDir, 'multi-purpose-cdp-0000-010101.log');
            const newer = path.join(tmpDir, 'multi-purpose-cdp-5959-311299.log');
            const ignored = path.join(tmpDir, 'auto-accept-cdp.log');

            fs.writeFileSync(older, 'old\n', 'utf8');
            fs.writeFileSync(newer, 'new\n', 'utf8');
            fs.writeFileSync(ignored, 'ignored\n', 'utf8');

            const now = Date.now();
            fs.utimesSync(older, new Date(now - 20000), new Date(now - 20000));
            fs.utimesSync(newer, new Date(now - 10000), new Date(now - 10000));

            const handler = new DebugHandler({ extensionPath: tmpDir, globalState: { get: () => false } }, { log: () => { } });
            const selected = handler.getLatestCdpLogPath();

            assert.strictEqual(selected, newer);
        } finally {
            Module._load = originalLoad;
        }
    });

    await test('DebugHandler.getLatestCdpLogPath returns null when no logs exist', async () => {
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const Module = require('module');

        const originalLoad = Module._load;
        Module._load = function (request, parent, isMain) {
            if (request === 'vscode') {
                return {
                    workspace: { getConfiguration: () => ({ get: () => false }) },
                    window: {},
                    commands: {}
                };
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        try {
            const { DebugHandler } = require('../main_scripts/debug-handler');
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpa-nologs-'));
            const handler = new DebugHandler({ extensionPath: tmpDir, globalState: { get: () => false } }, { log: () => { } });
            const selected = handler.getLatestCdpLogPath();
            assert.strictEqual(selected, null);
        } finally {
            Module._load = originalLoad;
        }
    });

    // Results
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(e => {
    console.error('Test runner error:', e);
    process.exit(1);
});
