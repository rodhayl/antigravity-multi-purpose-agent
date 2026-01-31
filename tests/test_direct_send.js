/**
 * Test __autoAcceptSendPrompt directly
 */
const http = require('http');
const WebSocket = require('ws');

async function getCDPTargets() {
    return new Promise((resolve) => {
        http.get({ hostname: '127.0.0.1', port: 9004, path: '/json/list', timeout: 2000 }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { resolve([]); }
            });
        }).on('error', () => resolve([])).on('timeout', () => resolve([]));
    });
}

async function testSend(wsUrl, title, testId) {
    return new Promise((resolve) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => { ws.close(); resolve({ error: 'timeout' }); }, 5000);

        ws.on('open', () => {
            ws.send(JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: {
                    expression: `
                        (function() {
                            try {
                                const result = window.__autoAcceptSendPrompt('${testId}: Test from ${title}');
                                return JSON.stringify({ success: result, error: null });
                            } catch (e) {
                                return JSON.stringify({ success: false, error: e.message });
                            }
                        })()
                    `,
                    returnByValue: true
                }
            }));
        });

        ws.on('message', (data) => {
            clearTimeout(timeout);
            const msg = JSON.parse(data.toString());
            if (msg.id === 1) {
                ws.close();
                if (msg.result?.result?.value) {
                    const result = JSON.parse(msg.result.result.value);
                    resolve({ title, ...result });
                } else {
                    resolve({ title, error: 'no_result' });
                }
            }
        });

        ws.on('error', () => { clearTimeout(timeout); resolve({ title, error: 'connection_failed' }); });
    });
}

async function main() {
    const testId = `DIRECT_TEST_${Date.now()}`;
    console.log(`Testing direct __autoAcceptSendPrompt call...\n`);
    console.log(`Test ID: ${testId}\n`);

    const pages = await getCDPTargets();

    for (const page of pages) {
        if (!page.webSocketDebuggerUrl) continue;
        if (!page.title || !page.title.includes('auto-accept-agent')) continue;

        console.log(`Testing: ${page.title}`);
        const result = await testSend(page.webSocketDebuggerUrl, page.title, testId);

        if (result.error) {
            console.log(`  ✗ Error: ${result.error}`);
        } else {
            console.log(`  Function returned: ${result.success}`);
            if (!result.success) {
                console.log(`  ⚠️  Function returned false - input not found!`);
            }
        }
        console.log();
    }

    console.log(`\nWaiting 30s for user to confirm if "${testId}" arrived...`);
}

main().catch(console.error);
