/**
 * Queue Issues Diagnostic Script
 * 
 * Tests three reported issues:
 * 1. Queue auto-starts when enabled (should wait for user to click Start)
 * 2. Stop Queue button doesn't stop the queue from sending
 * 3. "Sent" messages don't seem to appear
 * 
 * Usage: node tests/queue_issues_debug.js
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
        req.write(data);
        req.end();
    });
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =========================================================
// DIAGNOSTIC TESTS
// =========================================================

async function diagnoseIssue1_AutoStart() {
    console.log('\n' + '='.repeat(60));
    console.log('ISSUE 1: Queue Auto-Start Diagnosis');
    console.log('='.repeat(60));

    // Step 1: Get initial state
    const initialStatus = await sendCommand('getQueueStatus');
    console.log('\n1. Initial queue status:');
    console.log('   - isRunningQueue:', initialStatus?.status?.isRunningQueue);
    console.log('   - mode:', initialStatus?.status?.mode);
    console.log('   - queueLength:', initialStatus?.status?.queueLength);

    // Step 2: Reset to clean state
    console.log('\n2. Resetting queue to clean state...');
    await sendCommand('stopQueue');
    await delay(500);

    // Step 3: Get schedule config
    const scheduleConfig = await sendCommand('getSchedule');
    console.log('\n3. Current schedule config:');
    console.log('   - enabled:', scheduleConfig?.schedule?.enabled);
    console.log('   - mode:', scheduleConfig?.schedule?.mode);
    console.log('   - prompts:', scheduleConfig?.schedule?.prompts?.length || 0, 'prompts');

    // Step 4: Set up queue mode with prompts WITHOUT starting
    console.log('\n4. Configuring queue mode (this should NOT auto-start)...');
    await sendCommand('updateSchedule', {
        enabled: true,  // This is the "schedule enabled" toggle
        mode: 'queue',
        prompts: ['Test prompt 1', 'Test prompt 2'],
        queueMode: 'consume',
        silenceTimeout: 30
    });
    await delay(1000);

    // Step 5: Check if it auto-started
    const afterConfig = await sendCommand('getQueueStatus');
    console.log('\n5. Queue status AFTER configuring (should NOT be running):');
    console.log('   - isRunningQueue:', afterConfig?.status?.isRunningQueue);
    console.log('   - queueIndex:', afterConfig?.status?.queueIndex);
    console.log('   - queueLength:', afterConfig?.status?.queueLength);

    if (afterConfig?.status?.isRunningQueue) {
        console.log('\n   ❌ BUG CONFIRMED: Queue auto-started when mode was configured!');
        console.log('   ROOT CAUSE: The "schedule enabled" toggle or mode change triggers auto-start');
        return false;
    } else {
        console.log('\n   ✅ Queue did NOT auto-start. Checking for UI-triggered auto-start...');
    }

    return true;
}

async function diagnoseIssue2_StopQueue() {
    console.log('\n' + '='.repeat(60));
    console.log('ISSUE 2: Stop Queue Not Working Diagnosis');
    console.log('='.repeat(60));

    // Step 1: Set up and start queue
    console.log('\n1. Setting up queue with test prompts...');
    await sendCommand('updateSchedule', {
        enabled: true,
        mode: 'queue',
        prompts: ['Stop test 1', 'Stop test 2', 'Stop test 3'],
        queueMode: 'consume',
        silenceTimeout: 60
    });
    await delay(300);

    // Step 2: Start the queue
    console.log('\n2. Starting queue...');
    const startResult = await sendCommand('startQueue');
    console.log('   Start result:', startResult);
    await delay(500);

    // Step 3: Verify queue is running
    const runningStatus = await sendCommand('getQueueStatus');
    console.log('\n3. Queue status after start:');
    console.log('   - isRunningQueue:', runningStatus?.status?.isRunningQueue);
    console.log('   - queueIndex:', runningStatus?.status?.queueIndex);
    console.log('   - queueLength:', runningStatus?.status?.queueLength);

    if (!runningStatus?.status?.isRunningQueue) {
        console.log('\n   ⚠️  Queue is not running - cannot test stop behavior');
        return null;
    }

    // Step 4: Stop the queue
    console.log('\n4. Stopping queue...');
    const stopResult = await sendCommand('stopQueue');
    console.log('   Stop result:', stopResult);
    await delay(300);

    // Step 5: Check if stopped
    const afterStop = await sendCommand('getQueueStatus');
    console.log('\n5. Queue status AFTER stop:');
    console.log('   - isRunningQueue:', afterStop?.status?.isRunningQueue);
    console.log('   - queueIndex:', afterStop?.status?.queueIndex);
    console.log('   - runtimeQueue length:', afterStop?.status?.queueLength);

    if (afterStop?.status?.isRunningQueue) {
        console.log('\n   ❌ BUG CONFIRMED: Queue is still running after stopQueue()!');
        return false;
    } else {
        console.log('\n   ✅ Queue stopped successfully at API level.');
    }

    // Step 6: Check if prompts are still being processed
    console.log('\n6. Checking silence detection is disabled...');
    await delay(3000); // Wait for any pending silence checks

    const afterWait = await sendCommand('getQueueStatus');
    console.log('   After 3s wait - isRunningQueue:', afterWait?.status?.isRunningQueue);

    return !afterWait?.status?.isRunningQueue;
}

async function diagnoseIssue3_SentMessages() {
    console.log('\n' + '='.repeat(60));
    console.log('ISSUE 3: Sent Messages Not Appearing Diagnosis');
    console.log('='.repeat(60));

    // Step 1: Check CDP connection
    console.log('\n1. Checking CDP connections...');
    const cdpStatus = await sendCommand('getCDPConnections');
    console.log('   - Connection count:', cdpStatus?.count ?? 'ERROR');

    if (!cdpStatus?.count || cdpStatus.count === 0) {
        console.log('\n   ❌ No CDP connections! Messages cannot be sent.');
        console.log('   SOLUTION: Ensure Antigravity is running with --remote-debugging-port=9004');
        return false;
    }

    console.log('   - Connections:', cdpStatus?.connections?.map(c => c.id).join(', '));

    // Step 2: Check if send function exists in browser
    console.log('\n2. Checking __autoAcceptSendPrompt function exists...');
    const fnCheck = await sendCommand('evaluateInBrowser', {
        code: 'typeof window.__autoAcceptSendPrompt'
    });
    console.log('   - Function type:', fnCheck?.result);

    if (fnCheck?.result !== 'function') {
        console.log('\n   ❌ Browser script not injected properly!');
        console.log('   SOLUTION: Ensure CDP script is being injected');
        return false;
    }

    // Step 3: Find the chat input element
    console.log('\n3. Checking for chat input element...');
    const inputCheck = await sendCommand('evaluateInBrowser', {
        code: `
            (function() {
                const editables = document.querySelectorAll('[contenteditable="true"]');
                const results = [];
                for (const el of editables) {
                    const rect = el.getBoundingClientRect();
                    const className = el.className || '';
                    if (className.includes('ime')) continue;
                    if (rect.width < 100 || rect.height < 20) continue;
                    results.push({
                        width: rect.width,
                        height: rect.height,
                        classes: className.substring(0, 50),
                        hasCursorText: className.includes('cursor-text')
                    });
                }
                return JSON.stringify(results);
            })()
        `
    });

    try {
        const elements = JSON.parse(inputCheck?.result || '[]');
        console.log('   - Found', elements.length, 'suitable contenteditable elements');
        if (elements.length > 0) {
            console.log('   - First element:', elements[0]);
        }
    } catch (e) {
        console.log('   - Parse error:', e.message);
        console.log('   - Raw result:', inputCheck?.result);
    }

    // Step 4: Get prompt history to see if messages were recorded
    console.log('\n4. Checking prompt history...');
    const history = await sendCommand('getPromptHistory');
    console.log('   - History entries:', history?.history?.length ?? 0);
    if (history?.history?.length > 0) {
        console.log('   - Last 3 entries:');
        history.history.slice(-3).forEach(h => {
            console.log(`     [${h.timeAgo}] ${h.text.substring(0, 40)}...`);
        });
    }

    // Step 5: Try sending a test message
    console.log('\n5. Attempting to send test message via CDP...');
    const sendResult = await sendCommand('sendPrompt', {
        prompt: 'TEST_MESSAGE_' + Date.now()
    });
    console.log('   - sendPrompt result:', sendResult);
    await delay(500);

    // Step 6: Check history again
    const historyAfter = await sendCommand('getPromptHistory');
    const lastEntry = historyAfter?.history?.slice(-1)[0];
    console.log('\n6. After send - last history entry:');
    console.log('   - Text:', lastEntry?.text?.substring(0, 50));
    console.log('   - Time:', lastEntry?.timeAgo);

    return sendResult?.success;
}

async function checkSchedulerResumeLogic() {
    console.log('\n' + '='.repeat(60));
    console.log('CHECKING: Scheduler.resume() auto-start behavior');
    console.log('='.repeat(60));

    // The scheduler has resume logic that may auto-start the queue
    // when schedule.enabled is true and mode is 'queue'

    const fullState = await sendCommand('getFullState');
    console.log('\n1. Full state dump:');
    console.log('   - Extension enabled:', fullState?.state?.enabled);
    console.log('   - Schedule.enabled:', fullState?.state?.schedule?.enabled);
    console.log('   - Schedule.mode:', fullState?.state?.schedule?.mode);
    console.log('   - Queue status:');
    console.log('     - isRunningQueue:', fullState?.state?.queueStatus?.isRunningQueue);
    console.log('     - isPaused:', fullState?.state?.queueStatus?.isPaused);
    console.log('   - Quota resume enabled:', fullState?.state?.quota?.resumeEnabled);
}

// =========================================================
// MAIN
// =========================================================

async function main() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           Queue Issues Diagnostic Script                   ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    try {
        // Check connection first
        const ping = await sendCommand('getServerStatus');
        if (!ping.success) {
            console.log('\n❌ Cannot connect to debug server on port', DEBUG_PORT);
            return;
        }
        console.log('\n✅ Debug server connected');

        // Run diagnostics
        await checkSchedulerResumeLogic();

        const issue1Ok = await diagnoseIssue1_AutoStart();
        const issue2Ok = await diagnoseIssue2_StopQueue();
        const issue3Ok = await diagnoseIssue3_SentMessages();

        // Summary
        console.log('\n' + '='.repeat(60));
        console.log('DIAGNOSTIC SUMMARY');
        console.log('='.repeat(60));
        console.log('Issue 1 (Auto-start):', issue1Ok ? '✅ Not reproduced' : '❌ Confirmed');
        console.log('Issue 2 (Stop Queue):', issue2Ok ? '✅ Working' : (issue2Ok === null ? '⚠️ Skipped' : '❌ Broken'));
        console.log('Issue 3 (Sent Messages):', issue3Ok ? '✅ Working' : '❌ Broken');

        // Cleanup
        console.log('\n\nCleaning up...');
        await sendCommand('stopQueue');
        await sendCommand('updateSchedule', {
            enabled: false,
            mode: 'interval',
            prompts: []
        });

    } catch (e) {
        console.error('Error:', e.message);
    }
}

main();
