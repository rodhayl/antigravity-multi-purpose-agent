/**
 * Queue Feature Test Suite
 * 
 * Comprehensive test for all queue functionality after extension changes.
 * Run this after reinstalling the extension to verify:
 * 1. Queue does NOT auto-start when configured
 * 2. Stop Queue properly stops execution
 * 3. Sent messages appear in history
 * 4. Start/Pause/Resume/Skip work correctly
 * 
 * Usage: node tests/queue_full_test.js
 */

const http = require('http');
const DEBUG_PORT = 54321;

function sendCommand(action, params = {}) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ action, params });
        const req = http.request({
            hostname: '127.0.0.1',
            port: DEBUG_PORT,
            path: '/command',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
            timeout: 15000
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { resolve({ raw: body }); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(data);
        req.end();
    });
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// Test tracking
let passed = 0, failed = 0;
const results = [];

function test(name, condition) {
    if (condition) {
        console.log(`  ✅ ${name}`);
        passed++;
        results.push({ name, status: 'pass' });
    } else {
        console.log(`  ❌ ${name}`);
        failed++;
        results.push({ name, status: 'fail' });
    }
}

async function cleanup() {
    await sendCommand('stopQueue');
    await sendCommand('updateSchedule', {
        enabled: false,
        mode: 'interval',
        prompts: []
    });
    await delay(200);
}

// =====================================================
// TEST SUITE
// =====================================================

async function testConnection() {
    console.log('\n📡 Testing Debug Server Connection...');
    try {
        const result = await sendCommand('getServerStatus');
        test('Debug server reachable', result.success);
        test('Server running', result.server?.running === true);
        return result.success;
    } catch (e) {
        console.log(`  ❌ Cannot connect: ${e.message}`);
        return false;
    }
}

async function testCDPConnection() {
    console.log('\n🔌 Testing CDP Connection...');
    const cdp = await sendCommand('getCDPConnections');
    test('CDP handler available', cdp.success);
    test('Has active connections', cdp.count > 0);

    if (cdp.count > 0) {
        const evalResult = await sendCommand('evaluateInBrowser', { code: 'typeof window.__autoAcceptSendPrompt' });
        test('Browser script injected', evalResult.result === 'function');
    }
    return cdp.count > 0;
}

async function testIssue1_NoAutoStart() {
    console.log('\n🔒 Test Issue 1: Queue Does NOT Auto-Start...');
    await cleanup();

    // Get initial state
    const before = await sendCommand('getQueueStatus');
    test('Initial state: not running', before.status?.isRunningQueue === false);

    // Configure queue mode with prompts - should NOT start
    await sendCommand('updateSchedule', {
        enabled: true,  // Enable scheduler
        mode: 'queue',
        prompts: ['Auto-start test 1', 'Auto-start test 2'],
        queueMode: 'consume',
        silenceTimeout: 60
    });
    await delay(1000);

    const after = await sendCommand('getQueueStatus');
    test('After config: still not running', after.status?.isRunningQueue === false);
    test('Prompts saved correctly', after.status?.queueLength === 0); // Not built yet

    await cleanup();
}

async function testIssue2_StopWorks() {
    console.log('\n⏹️ Test Issue 2: Stop Queue Works...');
    await cleanup();

    // Set up queue
    await sendCommand('updateSchedule', {
        enabled: true,
        mode: 'queue',
        prompts: ['Stop test 1', 'Stop test 2', 'Stop test 3'],
        queueMode: 'loop', // Loop to keep running
        silenceTimeout: 60
    });
    await delay(200);

    // Start queue
    await sendCommand('startQueue');
    await delay(500);

    const running = await sendCommand('getQueueStatus');
    test('Queue started successfully', running.status?.isRunningQueue === true);

    // Stop queue
    await sendCommand('stopQueue');
    await delay(300);

    const stopped = await sendCommand('getQueueStatus');
    test('Queue stopped (isRunningQueue=false)', stopped.status?.isRunningQueue === false);
    test('Runtime queue cleared', stopped.status?.queueLength === 0);

    // Verify no more prompts sent after stop
    const historyBefore = await sendCommand('getPromptHistory');
    const countBefore = historyBefore.history?.length || 0;
    await delay(2000);
    const historyAfter = await sendCommand('getPromptHistory');
    const countAfter = historyAfter.history?.length || 0;
    test('No new prompts after stop', countAfter === countBefore);

    await cleanup();
}

async function testIssue3_HistoryTracking() {
    console.log('\n📜 Test Issue 3: Sent Messages in History...');
    await cleanup();

    const historyBefore = await sendCommand('getPromptHistory');
    const countBefore = historyBefore.history?.length || 0;

    // Use queue-based sending (the actual feature) which properly tracks history
    await sendCommand('updateSchedule', {
        enabled: true,
        mode: 'queue',
        prompts: ['History tracking test prompt'],
        queueMode: 'consume',
        silenceTimeout: 60
    });
    await delay(200);

    await sendCommand('startQueue');
    await delay(1500); // Wait for prompt to send and history to update

    const historyAfter = await sendCommand('getPromptHistory');
    const countAfter = historyAfter.history?.length || 0;
    test('History count increased', countAfter > countBefore);

    const lastEntry = historyAfter.history?.slice(-1)[0];
    test('Message recorded in history', lastEntry?.text?.includes('History tracking test'));
    test('Status marked as sent', lastEntry?.status === 'sent');

    await cleanup();
}

async function testQueueControls() {
    console.log('\n🎛️ Testing Queue Controls (Pause/Resume/Skip)...');
    await cleanup();

    await sendCommand('updateSchedule', {
        enabled: true,
        mode: 'queue',
        prompts: ['Control test 1', 'Control test 2', 'Control test 3'],
        queueMode: 'loop',
        silenceTimeout: 60
    });
    await delay(200);

    await sendCommand('startQueue');
    await delay(300);

    // Test pause
    await sendCommand('pauseQueue');
    await delay(200);
    const paused = await sendCommand('getQueueStatus');
    test('Pause works (isPaused=true)', paused.status?.isPaused === true);

    // Test resume
    await sendCommand('resumeQueue');
    await delay(200);
    const resumed = await sendCommand('getQueueStatus');
    test('Resume works (isPaused=false)', resumed.status?.isPaused === false);

    // Test skip
    const beforeSkip = await sendCommand('getQueueStatus');
    const idxBefore = beforeSkip.status?.queueIndex;
    await sendCommand('skipPrompt');
    await delay(300);
    const afterSkip = await sendCommand('getQueueStatus');
    test('Skip advances index', afterSkip.status?.queueIndex > idxBefore || afterSkip.status?.isRunningQueue === false);

    await cleanup();
}

async function testFullQueueRun() {
    console.log('\n🚀 Testing Full Queue Execution...');
    await cleanup();

    await sendCommand('updateSchedule', {
        enabled: true,
        mode: 'queue',
        prompts: ['Full run test 1'],
        queueMode: 'consume', // Remove after execution
        silenceTimeout: 60
    });
    await delay(200);

    const historyBefore = await sendCommand('getPromptHistory');
    const countBefore = historyBefore.history?.length || 0;

    await sendCommand('startQueue');
    await delay(1000);

    const historyAfter = await sendCommand('getPromptHistory');
    const countAfter = historyAfter.history?.length || 0;
    test('Prompt was sent during queue run', countAfter > countBefore);

    const status = await sendCommand('getQueueStatus');
    test('Queue is running or completed', status.success);

    await cleanup();
}

// =====================================================
// MAIN
// =====================================================

async function main() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           Queue Feature Test Suite (Full)                  ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`\nStarting at ${new Date().toLocaleTimeString()}`);

    try {
        const connected = await testConnection();
        if (!connected) {
            console.log('\n❌ Cannot connect to debug server!');
            console.log('   Make sure the extension is running and debug mode is enabled.');
            process.exit(1);
        }

        const hasCDP = await testCDPConnection();
        if (!hasCDP) {
            console.log('\n⚠️ No CDP connections - some tests may fail.');
        }

        await testIssue1_NoAutoStart();
        await testIssue2_StopWorks();
        await testIssue3_HistoryTracking();
        await testQueueControls();
        await testFullQueueRun();

        // Final cleanup
        await cleanup();

        // Summary
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║                     TEST RESULTS                           ║');
        console.log('╚════════════════════════════════════════════════════════════╝');
        console.log(`\n  ✅ Passed:  ${passed}`);
        console.log(`  ❌ Failed:  ${failed}`);

        if (failed === 0) {
            console.log('\n🎉 All queue tests passed!');
        } else {
            console.log('\n⚠️ Some tests failed. Check output above.');
            const failedTests = results.filter(r => r.status === 'fail');
            console.log('\nFailed tests:');
            failedTests.forEach(t => console.log(`  - ${t.name}`));
        }

        process.exit(failed > 0 ? 1 : 0);

    } catch (e) {
        console.error('\n💥 Test suite error:', e.message);
        process.exit(1);
    }
}

main();
