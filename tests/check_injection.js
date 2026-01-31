/**
 * Check if CDP script is properly injected
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

async function checkInjection(wsUrl, title) {
    return new Promise((resolve) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => { ws.close(); resolve({ error: 'timeout' }); }, 3000);

        ws.on('open', () => {
            ws.send(JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: {
                    expression: `JSON.stringify({
                        hasSendPrompt: typeof window.__autoAcceptSendPrompt === 'function',
                        hasSendToConversation: typeof window.__autoAcceptSendPromptToConversation === 'function',
                        hasStart: typeof window.__autoAcceptStart === 'function',
                        scriptError: window.__autoAcceptError || null
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
                const result = JSON.parse(msg.result.result.value);
                resolve({ title, ...result });
            }
        });

        ws.on('error', () => { clearTimeout(timeout); resolve({ title, error: 'connection_failed' }); });
    });
}

async function main() {
    console.log('Checking CDP script injection status...\n');

    const pages = await getCDPTargets();
    console.log(`Found ${pages.length} CDP targets\n`);

    for (const page of pages) {
        if (!page.webSocketDebuggerUrl) continue;
        if (page.type !== 'page' && page.type !== 'webview' && page.type !== 'iframe') continue;

        const result = await checkInjection(page.webSocketDebuggerUrl, page.title || '(no title)');

        console.log(`${result.title}`);
        if (result.error) {
            console.log(`  ✗ Error: ${result.error}`);
        } else {
            console.log(`  __autoAcceptSendPrompt: ${result.hasSendPrompt ? '✓' : '✗'}`);
            console.log(`  __autoAcceptSendPromptToConversation: ${result.hasSendToConversation ? '✓' : '✗'}`);
            console.log(`  __autoAcceptStart: ${result.hasStart ? '✓' : '✗'}`);
            if (result.scriptError) {
                console.log(`  ⚠️  Script Error: ${result.scriptError}`);
            }
        }
        console.log();
    }
}

main().catch(console.error);
