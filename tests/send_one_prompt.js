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
    console.log('Preparing to send prompt via Queue subsystem...');
    try {
        const testPrompt = 'Hello from Auto-Accept Agent Verification! (Sent via Debug Server)';

        // 1. Configure for Queue Mode
        console.log('Configuring Queue...');
        const configRes = await sendCommand('updateSchedule', {
            enabled: true,
            mode: 'queue',
            prompts: [testPrompt],
            queueMode: 'consume'
        });

        if (!configRes.success) {
            console.error('FAILED: Could not configure queue:', configRes);
            return;
        }

        // 2. Start Queue
        console.log('Starting Queue...');
        const startRes = await sendCommand('startQueue');

        if (startRes.success) {
            console.log('SUCCESS: Queue started. The prompt should appear in the browser shortly.');
        } else {
            console.error('FAILED: Could not start queue:', startRes);
        }

    } catch (e) {
        console.error('ERROR:', e.message);
    }
}

run();
