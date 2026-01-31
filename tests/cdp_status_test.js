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
    console.log('=== CDP Connection Status Check ===\n');

    try {
        // Check CDP status
        console.log('Checking CDP connection status...');
        const cdpRes = await sendCommand('getCDPStatus');
        console.log('CDP Status:', JSON.stringify(cdpRes, null, 2));

        if (cdpRes.success) {
            console.log('\n=== ANALYSIS ===');
            if (cdpRes.cdp.connectionCount === 0) {
                console.log('❌ PROBLEM: No CDP connections established!');
                console.log('   The extension cannot communicate with the browser.');
                console.log('   Possible causes:');
                console.log('   1. Antigravity IDE is not running with --remote-debugging-port');
                console.log('   2. Port 9004 is not open or is in use by another app');
                console.log('   3. CDPHandler.start() was never called or failed silently');
            } else {
                console.log(`✓ CDP connections: ${cdpRes.cdp.connectionCount}`);
                console.log(`  Connection IDs: ${cdpRes.cdp.connections.join(', ')}`);
                console.log('  Script injection should be working...');
            }
        } else {
            console.log('Failed to get CDP status:', cdpRes.error);
        }

    } catch (e) {
        if (e.message.includes('Unknown debug action')) {
            console.log('⚠️  getCDPStatus not available - extension needs reload');
            console.log('   The user is running an old version of debug-handler.js');
        } else {
            console.error('ERROR:', e.message);
        }
    }
}

run();
