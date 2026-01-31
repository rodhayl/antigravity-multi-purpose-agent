/**
 * Check all CDP targets for contenteditable elements
 */
const http = require('http');
const WebSocket = require('ws');

async function getPages() {
    return new Promise((resolve) => {
        http.get({ hostname: '127.0.0.1', port: 9004, path: '/json/list' }, (r) => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => resolve(JSON.parse(d)));
        }).on('error', () => resolve([]));
    });
}

async function evalInPage(wsUrl, code) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => { ws.close(); resolve({ error: 'timeout' }); }, 5000);

        ws.on('open', () => {
            ws.send(JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: { expression: code, returnByValue: true }
            }));
        });

        ws.on('message', (data) => {
            clearTimeout(timeout);
            const msg = JSON.parse(data.toString());
            if (msg.id === 1) {
                ws.close();
                resolve(msg.result?.result?.value || msg.result);
            }
        });

        ws.on('error', (e) => { clearTimeout(timeout); resolve({ error: e.message }); });
    });
}

async function main() {
    console.log('=== Checking All CDP Targets ===\n');

    const pages = await getPages();
    console.log('Found', pages.length, 'pages\n');

    for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        if (!p.webSocketDebuggerUrl) continue;

        console.log(`[${i}] ${p.type}: ${p.title?.substring(0, 40) || '(no title)'}`);

        const result = await evalInPage(p.webSocketDebuggerUrl,
            `JSON.stringify({
                editables: document.querySelectorAll('[contenteditable=true]').length,
                hasImeExcluded: Array.from(document.querySelectorAll('[contenteditable=true]')).filter(e => !(e.className||'').includes('ime')).length,
                title: document.title
            })`
        );

        console.log('    Result:', result);
    }
}

main().catch(console.error);
