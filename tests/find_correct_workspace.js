/**
 * Find which CDP connection actually has auto-accept-agent workspace
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

async function checkForChat(wsUrl) {
    return new Promise((resolve) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => { ws.close(); resolve(null); }, 3000);

        ws.on('open', () => {
            ws.send(JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: {
                    expression: `JSON.stringify({
                        title: document.title,
                        hasChat: document.querySelectorAll('[contenteditable="true"]').length > 0,
                        editableCount: Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(e => !(e.className || '').includes('ime')).length
                    })`,
                    returnByValue: true
                }
            }));
        });

        ws.on('message', (data) => {
            clearTimeout(timeout);
            const msg = JSON.parse(data.toString());
            if (msg.id === 1 && msg.result?.result?.value) {
                ws.close();
                resolve(JSON.parse(msg.result.result.value));
            }
        });

        ws.on('error', () => { clearTimeout(timeout); resolve(null); });
    });
}

async function main() {
    console.log('Finding auto-accept-agent workspace chat...\n');

    const pages = await getCDPTargets();
    console.log(`Found ${pages.length} CDP targets\n`);

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (!page.webSocketDebuggerUrl) continue;

        console.log(`[${i}] ${page.title || '(no title)'}`);

        const info = await checkForChat(page.webSocketDebuggerUrl);
        if (info) {
            console.log(`    Title: ${info.title}`);
            console.log(`    Has chat: ${info.hasChat ? 'YES' : 'NO'}`);
            console.log(`    Editables: ${info.editableCount}`);

            if (info.editableCount > 0) {
                console.log(`    ✓ CHAT FOUND!`);
                if (info.title.toLowerCase().includes('auto-accept-agent')) {
                    console.log(`    ✓✓ MATCHES auto-accept-agent workspace!`);
                } else {
                    console.log(`    ✗ Does NOT match auto-accept-agent`);
                }
            }
        }
        console.log();
    }
}

main().catch(console.error);
