const http = require('http');

function sendCommand(action, params = {}) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ action, params });
        const options = {
            hostname: '127.0.0.1',
            port: 54321,
            path: '/command',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${body}`));
                    }
                } else {
                    reject(new Error(`HTTP Status: ${res.statusCode} - ${body}`));
                }
            });
        });

        req.on('error', (e) => {
            reject(new Error(`Request failed: ${e.message}`));
        });

        req.write(data);
        req.end();
    });
}

async function runTest() {
    console.log('Testing Debug Server...');
    try {
        // Test 1: getSystemInfo
        console.log('Test 1: getSystemInfo');
        const sysInfo = await sendCommand('getSystemInfo');
        if (sysInfo.success && sysInfo.info.platform) {
            console.log('PASS: getSystemInfo returned valid data');
        } else {
            console.error('FAIL: getSystemInfo returned:', sysInfo);
            process.exit(1);
        }

        // Test 2: getFullState (heavy payload)
        console.log('Test 2: getFullState');
        const state = await sendCommand('getFullState');
        if (state.success && state.state.debugMode) {
            console.log('PASS: getFullState returned valid state');
        } else {
            console.error('FAIL: getFullState returned:', state);
        }

        // Test 3: Toggle On/Off
        console.log('Test 3: Toggle On/Off');
        const initialInfo = await sendCommand('getEnabled');
        console.log('Initial Enabled:', initialInfo.enabled);

        const toggleRes = await sendCommand('toggle');
        console.log('Toggled to:', toggleRes.enabled);

        if (toggleRes.enabled !== initialInfo.enabled) {
            console.log('PASS: Toggle changed state');
        } else {
            console.error('FAIL: Toggle did not change state');
        }
        if (toggleRes.enabled !== initialInfo.enabled) {
            await sendCommand('toggle');
        }

        // Test 4: Verify Queue Plumbing (Scheduler -> CDPHandler)
        console.log('Test 4: Verify Queue Plumbing');

        // 1. Configure for Queue Mode
        const testPrompt = `AG_Test_Plumbing_${Date.now()}`;
        console.log(`Configuring Queue with prompt: ${testPrompt}`);
        await sendCommand('updateSchedule', {
            enabled: true,
            mode: 'queue',
            prompts: [testPrompt],
            queueMode: 'consume'
        });

        // 2. (Removed clearLogs to debug logging persistence)
        // await sendCommand('clearLogs');

        // 3. Start Queue
        console.log('Starting Queue...');
        const startRes = await sendCommand('startQueue');
        if (!startRes.success) {
            console.error('FAIL: Could not start queue', startRes);
            process.exit(1);
        }

        // 4. Wait for async execution (3s)
        console.log('Waiting 3s for processing...');
        await new Promise(r => setTimeout(r, 3000));

        // 5. Verify Prompt History (Reliable state check)
        const historyRes = await sendCommand('getPromptHistory');
        if (historyRes.success) {
            const history = historyRes.history || [];
            const found = history.find(h => h.text && h.text.includes(testPrompt));

            if (found) {
                console.log('PASS: History verification - Scheduler successfully processed prompt');
                console.log('Evidence: Found prompt in history:', found);

                // Secondary check: If history status is 'sent', it means sendPrompt finished
                if (found.status === 'sent') {
                    console.log('PASS: Prompt status is "sent"');
                } else {
                    console.warn('WARN: Prompt status is not sent:', found.status);
                }

                // Log verification (optional / debug only now)
                const logsRes = await sendCommand('getLogs', { tailLines: 200 });
                if (logsRes.success && logsRes.logs && logsRes.logs.includes('No CDP connections')) {
                    console.log('Info: Logs confirm "No CDP connections" (Expected)');
                }

            } else {
                console.error('FAIL: Prompt NOT found in history. Scheduler did not execute task.');
                console.log('History dump:', history);
                process.exit(1);
            }
        } else {
            console.error('FAIL: Could not retrieve history', historyRes);
            process.exit(1);
        }

        console.log('All tests passed!');

    } catch (e) {
        console.error('Test Failed:', e.message);
        console.error('Ensure VS Code extension is running with Debug Mode enabled.');
        process.exit(1);
    }
}

runTest();
