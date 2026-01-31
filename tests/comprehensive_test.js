/**
 * Comprehensive Extension Test Suite
 * 
 * Tests all extension functionality via the debug server API.
 * Combines programmatic state testing with WebView UI testing.
 * 
 * Usage: node tests/comprehensive_test.js
 * 
 * Prerequisites:
 * - Extension must be running in VS Code
 * - Debug mode must be enabled (default: true)
 * - Settings panel should be opened for UI tests
 */

const http = require('http');

// === Configuration ===
const DEBUG_PORT = 54321;
const TEST_TIMEOUT = 30000;

// === Utility Functions ===
function sendCommand(action, params = {}) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ action, params });
        const options = {
            hostname: '127.0.0.1',
            port: DEBUG_PORT,
            path: '/command',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
            timeout: TEST_TIMEOUT
        };
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { resolve({ raw: body }); }
            });
        });
        req.on('error', (e) => reject(e));
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(data);
        req.end();
    });
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// === Test Tracking ===
let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
        passed++;
        results.push({ status: 'pass', message });
    } else {
        console.log(`  ❌ ${message}`);
        failed++;
        results.push({ status: 'fail', message });
    }
}

function skip(message) {
    console.log(`  ⏭️  ${message}`);
    skipped++;
    results.push({ status: 'skip', message });
}

// === Test Categories ===

async function testDebugServerConnection() {
    console.log('\n📡 Testing Debug Server Connection...');

    try {
        const result = await sendCommand('getServerStatus');
        assert(result.success === true, 'Debug server is reachable');
        assert(result.server?.running === true, 'Server reports running state');
        assert(result.server?.port === DEBUG_PORT, `Server running on port ${DEBUG_PORT}`);
    } catch (e) {
        assert(false, `Debug server connection failed: ${e.message}`);
        return false;
    }
    return true;
}

async function testCoreToggle() {
    console.log('\n🔘 Testing Core Toggle...');

    // Get initial state
    const initial = await sendCommand('getEnabled');
    assert(initial.success, 'Can query enabled state');
    const initialEnabled = initial.enabled;

    // Toggle once
    await sendCommand('toggle');
    await delay(300);
    const afterToggle = await sendCommand('getEnabled');

    // Check that state changed
    assert(afterToggle.enabled !== initialEnabled, 'Toggle changes enabled state');

    // Restore original state
    if (afterToggle.enabled !== initialEnabled) {
        await sendCommand('toggle');
        await delay(100);
    }
}

async function testScheduleConfiguration() {
    console.log('\n📅 Testing Schedule Configuration...');

    const initial = await sendCommand('getSchedule');
    assert(initial.success, 'Can query schedule');
    assert(initial.schedule.mode !== undefined, 'Schedule has mode');

    // Update schedule
    await sendCommand('updateSchedule', {
        enabled: true,
        mode: 'queue',
        prompts: ['Test prompt 1', 'Test prompt 2'],
        queueMode: 'consume',
        silenceTimeout: 45
    });
    await delay(100);

    const updated = await sendCommand('getSchedule');
    assert(updated.schedule.enabled === true, 'Schedule enabled correctly');
    assert(updated.schedule.mode === 'queue', 'Schedule mode set to queue');
    assert(updated.schedule.prompts.length === 2, 'Prompts saved correctly');
    assert(updated.schedule.silenceTimeout === 45, 'Silence timeout saved');

    // Restore defaults
    await sendCommand('updateSchedule', {
        enabled: false,
        mode: 'interval',
        prompts: [],
        silenceTimeout: 30
    });
}

async function testQueueControl() {
    console.log('\n📋 Testing Queue Control...');

    const status = await sendCommand('getQueueStatus');
    assert(status.success, 'Can query queue status');
    assert(status.status.hasOwnProperty('isRunningQueue'), 'Status has isRunningQueue');
    assert(status.status.hasOwnProperty('queueLength'), 'Status has queueLength');

    // Test pause/resume (only if queue is running)
    if (status.status.isRunningQueue) {
        await sendCommand('pauseQueue');
        const paused = await sendCommand('getQueueStatus');
        assert(paused.status.isPaused === true, 'Queue paused');

        await sendCommand('resumeQueue');
        const resumed = await sendCommand('getQueueStatus');
        assert(resumed.status.isPaused === false, 'Queue resumed');
    } else {
        skip('Queue not running - skipping pause/resume test');
    }
}

async function testBannedCommands() {
    console.log('\n🚫 Testing Banned Commands...');

    const initial = await sendCommand('getBannedCommands');
    assert(initial.success, 'Can query banned commands');
    assert(Array.isArray(initial.commands), 'Banned commands is an array');

    // Update with test command
    const testCommands = ['rm -rf /', 'test-banned-cmd'];
    await sendCommand('updateBannedCommands', { commands: testCommands });
    await delay(100);

    const updated = await sendCommand('getBannedCommands');
    assert(updated.commands.includes('test-banned-cmd'), 'New banned command saved');

    // Restore
    const defaultCommands = initial.commands.filter(c => c !== 'test-banned-cmd');
    await sendCommand('updateBannedCommands', { commands: defaultCommands });
}

async function testAntigravityQuota() {
    console.log('\n💰 Testing Antigravity Quota...');

    const enabled = await sendCommand('getAntigravityQuota');
    assert(enabled.success, 'Can query quota enabled state');

    const snapshot = await sendCommand('refreshAntigravityQuota');
    assert(snapshot.success, 'Can refresh quota');
    // Snapshot may or may not have data depending on connection status
}

async function testAutoContinue() {
    console.log('\n🤖 Testing Auto-Continue...');

    const initial = await sendCommand('getAutoContinue');
    assert(initial.success, 'Can query auto-continue');

    // Enable
    await sendCommand('setAutoContinue', { value: true });
    await delay(100);
    const enabled = await sendCommand('getAutoContinue');
    assert(enabled.enabled === true, 'Auto-continue can be enabled');

    // Disable
    await sendCommand('setAutoContinue', { value: false });
    await delay(100);
    const disabled = await sendCommand('getAutoContinue');
    assert(disabled.enabled === false, 'Auto-continue can be disabled');
}

async function testStats() {
    console.log('\n📊 Testing Stats...');

    const stats = await sendCommand('getStats');
    assert(stats.success, 'Can query stats');

    const roi = await sendCommand('getROIStats');
    assert(roi.success, 'Can query ROI stats');
}

async function testLogs() {
    console.log('\n📝 Testing Logs...');

    const logs = await sendCommand('getLogs', { tailLines: 50 });
    assert(logs.success, 'Can read logs');
    assert(typeof logs.logs === 'string', 'Logs is a string');
    assert(logs.linesCount >= 0, 'Lines count is valid');
}

async function testCDPConnections() {
    console.log('\n🔌 Testing CDP Connections...');

    const connections = await sendCommand('getCDPConnections');
    assert(connections.success, 'Can query CDP connections');
    assert(typeof connections.count === 'number', 'Connection count is a number');

    if (connections.count > 0) {
        assert(connections.connections.length > 0, 'Has connection details');

        // Test evaluateInBrowser
        const evalResult = await sendCommand('evaluateInBrowser', { code: 'document.title' });
        assert(evalResult.success, 'Can evaluate in browser');
    } else {
        skip('No CDP connections - skipping browser evaluation test');
    }
}

async function testFullState() {
    console.log('\n🔍 Testing Full State Snapshot...');

    const state = await sendCommand('getFullState');
    assert(state.success, 'Can get full state');
    assert(state.state.hasOwnProperty('enabled'), 'Has enabled property');
    assert(state.state.hasOwnProperty('frequency'), 'Has frequency property');
    assert(state.state.hasOwnProperty('schedule'), 'Has schedule property');
    assert(state.state.hasOwnProperty('quota'), 'Has quota property');
    assert(state.state.hasOwnProperty('bannedCommands'), 'Has bannedCommands property');
    assert(state.state.hasOwnProperty('stats'), 'Has stats property');
    assert(state.state.hasOwnProperty('debugMode'), 'Has debugMode property');
    assert(state.state.hasOwnProperty('antigravityStatus'), 'Has antigravityStatus property');
}

async function testSystemInfo() {
    console.log('\n💻 Testing System Info...');

    const info = await sendCommand('getSystemInfo');
    assert(info.success, 'Can get system info');
    assert(info.info.platform === 'win32', `Platform is ${info.info.platform}`);
    assert(info.info.appName !== undefined, 'Has app name');
}

async function testWebViewUIBridge() {
    console.log('\n🖼️ Testing WebView UI Bridge...');

    // First, try to open settings panel
    await sendCommand('openSettingsPanel');
    await delay(500);

    // Try to get UI snapshot
    const snapshot = await sendCommand('getUISnapshot');
    if (!snapshot.success) {
        skip('Settings panel not open or UI bridge not available');
        return;
    }

    assert(snapshot.success, 'Can get UI snapshot');
    if (snapshot.snapshot?.snapshot) {
        assert(snapshot.snapshot.snapshot.hasOwnProperty('scheduleEnabled'), 'Snapshot has scheduleEnabled');
        assert(snapshot.snapshot.snapshot.hasOwnProperty('scheduleMode'), 'Snapshot has scheduleMode');
    }

    // List elements
    const elements = await sendCommand('listUIElements');
    if (elements.success) {
        assert(elements.count > 0, `Found ${elements.count} interactive elements`);
    }

    // Test clicking a known element
    const clickResult = await sendCommand('uiAction', { type: 'getValue', target: 'scheduleMode' });
    if (clickResult.result) {
        assert(clickResult.success, 'Can get element value via UI bridge');
    }
}

async function testVSCodeCommandExecution() {
    console.log('\n⚡ Testing VS Code Command Execution...');

    // List chat-related commands
    const commands = await sendCommand('listChatCommands');
    assert(commands.success, 'Can list commands');
    assert(commands.count > 0, `Found ${commands.count} relevant commands`);

    // Execute a safe command
    const exec = await sendCommand('executeVSCodeCommand', { command: 'workbench.action.focusActiveEditorGroup' });
    assert(exec.success, 'Can execute VS Code command');
}

// === Main Test Runner ===

async function runAllTests() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     Multi Purpose Agent - Comprehensive Test Suite        ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`\nStarting tests at ${new Date().toISOString()}`);
    console.log(`Debug server: http://127.0.0.1:${DEBUG_PORT}`);

    const startTime = Date.now();

    // Run tests
    const connected = await testDebugServerConnection();
    if (!connected) {
        console.log('\n❌ Cannot connect to debug server. Make sure:');
        console.log('   1. VS Code extension is running');
        console.log('   2. Debug mode is enabled (auto-accept.debugMode.enabled: true)');
        console.log('   3. Extension has been activated');
        return;
    }

    await testCoreToggle();
    await testScheduleConfiguration();
    await testQueueControl();
    await testBannedCommands();
    await testAntigravityQuota();
    await testAutoContinue();
    await testStats();
    await testLogs();
    await testCDPConnections();
    await testFullState();
    await testSystemInfo();
    await testVSCodeCommandExecution();
    await testWebViewUIBridge();

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                     TEST RESULTS                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`\n  ✅ Passed:  ${passed}`);
    console.log(`  ❌ Failed:  ${failed}`);
    console.log(`  ⏭️  Skipped: ${skipped}`);
    console.log(`  ⏱️  Duration: ${duration}s`);

    if (failed === 0) {
        console.log('\n🎉 All tests passed!');
    } else {
        console.log('\n⚠️  Some tests failed. Review the output above.');
    }

    // Return exit code
    process.exitCode = failed > 0 ? 1 : 0;
}

// Run the tests
runAllTests().catch(err => {
    console.error('Test suite error:', err);
    process.exitCode = 1;
});
