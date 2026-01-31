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
    console.log('=== Browser Script Injection Test ===\n');

    try {
        // Test if the browser script functions exist
        console.log('Checking if browser script is injected...\n');

        // getConversations calls cdpHandler.getConversations which evaluates window.__autoAcceptState.tabNames
        const convsRes = await sendCommand('getConversations');
        console.log('getConversations result:', JSON.stringify(convsRes, null, 2));

        if (convsRes.conversations && convsRes.conversations.length > 0) {
            console.log('\n✓ Browser script IS injected - found tabs:', convsRes.conversations);
        } else {
            console.log('\n✗ Browser script may NOT be injected or no tabs open');
            console.log('  The __autoAcceptState.tabNames is empty or undefined');
        }

        // Also check getStats which uses a different browser function
        console.log('\nChecking getStats (uses window.__autoAcceptGetStats)...');
        const statsRes = await sendCommand('getStats');
        console.log('getStats result:', JSON.stringify(statsRes, null, 2));

    } catch (e) {
        console.error('ERROR:', e.message);
    }
}

run();
