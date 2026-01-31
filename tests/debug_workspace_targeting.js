/**
 * Debug workspace targeting
 */
const http = require('http');

function post(action, params = {}) {
    return new Promise(r => {
        const d = JSON.stringify({ action, params });
        http.request({
            hostname: '127.0.0.1',
            port: 54321,
            path: '/command',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': d.length }
        }, (res) => {
            let b = '';
            res.on('data', c => b += c);
            res.on('end', () => r(JSON.parse(b)));
        }).end(d);
    });
}

async function main() {
    console.log('Checking workspace detection...\n');

    // Get CDP connections
    const conns = await post('getCDPConnections');
    console.log(`Total connections: ${conns.count}\n`);

    // Check each connection's title
    console.log('Connection details:');
    for (const conn of conns.connections || []) {
        const titleCheck = await post('evaluateInBrowser', {
            code: `document.title`
        });
        console.log(`  ${conn.id}: ${titleCheck.result || 'unknown'}`);
    }

    console.log('\nSending test message...');
    const testId = `WORKSPACE_DEBUG_${Date.now()}`;
    const result = await post('sendPrompt', { prompt: `${testId}: Reply OK if you get this in auto-accept-agent chat` });

    console.log(`Result: ${result.success ? 'Sent' : 'Failed'}`);
    console.log(`\nWaiting 30 seconds for user confirmation...`);
    console.log(`Message ID to look for: ${testId}`);
}

main().catch(console.error);
