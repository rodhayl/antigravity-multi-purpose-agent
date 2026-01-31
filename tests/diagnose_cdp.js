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

async function run() {
    console.log('Diagnosing CDP State...');
    try {
        // 1. Get Full State
        console.log('Fetching State...');
        const stateRes = await sendCommand('getFullState');
        if (stateRes.success) {
            console.log('--- EXTENSION STATE ---');
            console.log('Enabled:', stateRes.state.enabled);
            console.log('Queue Status:', stateRes.state.queueStatus);
            console.log('Antigravity Integration:', stateRes.state.antigravityStatus);
            // Note: getFullState doesn't return CDP connection count directly in current implementation
            // We might need to rely on logs or add a new debug field
        } else {
            console.error('Failed to get state:', stateRes);
        }

        // 2. Get Recent Logs (Crucial for connection errors)
        console.log('\nFetching Logs...');
        const logsRes = await sendCommand('getLogs', { tailLines: 50 });
        if (logsRes.success) {
            console.log('--- RECENT LOGS ---');
            console.log(logsRes.logs);
        } else {
            console.error('Failed to get logs:', logsRes);
        }

    } catch (e) {
        console.error('ERROR:', e.message);
    }
}

run();
