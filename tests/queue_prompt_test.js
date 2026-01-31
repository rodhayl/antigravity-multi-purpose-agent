/**
 * Queue Prompt Sending Test
 * 
 * This script tests the prompt sending functionality by:
 * 1. Connecting to CDP
 * 2. Injecting the full_cdp_script
 * 3. Calling __autoAcceptSendPrompt with a test message
 * 
 * Run with: node tests/queue_prompt_test.js
 */

const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const CDP_PORT = 9004;

// Load the full CDP script
const fullScriptPath = path.join(__dirname, '..', 'main_scripts', 'full_cdp_script.js');

async function getPages(port) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/json`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(2000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
}

async function evaluate(ws, expression) {
    return new Promise((resolve, reject) => {
        const id = Date.now();
        const handler = (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.id === id) {
                ws.off('message', handler);
                if (msg.error) {
                    reject(new Error(msg.error.message));
                } else {
                    resolve(msg.result);
                }
            }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({
            id,
            method: 'Runtime.evaluate',
            params: { expression, awaitPromise: true }
        }));

        setTimeout(() => {
            ws.off('message', handler);
            reject(new Error('Evaluation timeout'));
        }, 10000);
    });
}

async function connectToPage(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
}

async function main() {
    console.log('=== Queue Prompt Sending Test ===\n');

    // 1. Find CDP pages
    console.log('1. Fetching CDP pages...');
    let foundPages = [];

    try {
        const pages = await getPages(CDP_PORT);
        for (const page of pages) {
            if (page.webSocketDebuggerUrl) {
                console.log(`   Port ${CDP_PORT}: [${page.type}] ${page.title?.substring(0, 60) || 'Untitled'}`);
                foundPages.push({ port: CDP_PORT, ...page });
            }
        }
    } catch (e) { }

    if (foundPages.length === 0) {
        console.log('   ERROR: No CDP pages found! Is the extension running?');
        console.log('   Make sure VS Code/Antigravity is launched with CDP enabled.');
        process.exit(1);
    }

    // Pick the first page that looks like a webview (not our extension)
    const agentPage = foundPages.find(p =>
        p.url?.includes('workbench') ||
        p.title?.toLowerCase().includes('conversation') ||
        p.type === 'webview'
    ) || foundPages.find(p => p.type === 'page') || foundPages[0];

    console.log(`\n   Selected: ${agentPage.title || agentPage.url}`);
    const foundPage = agentPage;

    // 2. Connect to page
    console.log(`\n2. Connecting to: ${foundPage.webSocketDebuggerUrl}`);
    let ws;
    try {
        ws = await connectToPage(foundPage.webSocketDebuggerUrl);
        console.log('   Connected!');

        // Enable Runtime domain
        await new Promise((resolve, reject) => {
            const id = Date.now();
            ws.send(JSON.stringify({ id, method: 'Runtime.enable' }));
            const handler = (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.id === id) {
                    ws.off('message', handler);
                    resolve();
                }
            };
            ws.on('message', handler);
            setTimeout(() => { ws.off('message', handler); reject(new Error('Runtime.enable timeout')); }, 5000);
        });
        console.log('   Runtime enabled!');
    } catch (e) {
        console.log(`   ERROR: Failed to connect: ${e.message}`);
        process.exit(1);
    }

    // 3. Check if script is already injected
    console.log('\n3. Checking if CDP script is injected...');
    try {
        const checkResult = await evaluate(ws, `typeof window.__autoAcceptSendPrompt`);
        if (checkResult.result?.value === 'function') {
            console.log('   Script already injected!');
        } else {
            console.log('   Script not found, injecting...');
            const script = fs.readFileSync(fullScriptPath, 'utf8');
            await evaluate(ws, script);
            console.log('   Script injected!');
        }
    } catch (e) {
        console.log(`   ERROR: ${e.message}`);
        ws.close();
        process.exit(1);
    }

    // 4. Send test prompt
    const testMessage = `🧪 TEST MESSAGE: Queue prompt test at ${new Date().toLocaleTimeString()}`;
    console.log(`\n4. Sending test prompt: "${testMessage}"`);

    try {
        const sendResult = await evaluate(ws, `
            (async function() {
                console.log('[Test] Sending test prompt...');
                if (window.__autoAcceptSendPrompt) {
                    window.__autoAcceptSendPrompt(${JSON.stringify(testMessage)});
                    return 'Prompt sent via __autoAcceptSendPrompt';
                } else {
                    return 'ERROR: __autoAcceptSendPrompt not found';
                }
            })()
        `);
        console.log(`   Result: ${sendResult.result?.value || 'No result'}`);
    } catch (e) {
        console.log(`   ERROR sending prompt: ${e.message}`);
    }

    // 5. Wait and cleanup
    console.log('\n5. Waiting 2 seconds for prompt to be processed...');
    await new Promise(r => setTimeout(r, 2000));

    ws.close();
    console.log('\n=== Test Complete ===');
    console.log('Check the conversation to see if the test message was sent!');
}

main().catch(e => {
    console.error('Test failed:', e);
    process.exit(1);
});
