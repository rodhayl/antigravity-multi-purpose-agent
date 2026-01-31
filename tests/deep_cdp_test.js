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
    console.log('=== Deep CDP Diagnosis ===\n');

    try {
        // 1. Test sendPrompt directly to see the actual response
        console.log('1. Testing sendPrompt directly...');
        const sendRes = await sendCommand('sendPrompt', {
            prompt: 'TEST_PROMPT_' + Date.now()
        });
        console.log('   sendPrompt result:', JSON.stringify(sendRes, null, 2));

        // 2. Get conversations to verify browser script is injected
        console.log('\n2. Getting conversations from browser...');
        const convsRes = await sendCommand('getConversations');
        console.log('   Conversations:', JSON.stringify(convsRes, null, 2));

        // 3. Get full queue status
        console.log('\n3. Getting queue status...');
        const queueRes = await sendCommand('getQueueStatus');
        console.log('   Queue Status:', JSON.stringify(queueRes, null, 2));

        // 4. Get prompt history
        console.log('\n4. Getting prompt history...');
        const histRes = await sendCommand('getPromptHistory');
        console.log('   History:', JSON.stringify(histRes, null, 2));

    } catch (e) {
        console.error('ERROR:', e.message);
    }
}

run();
