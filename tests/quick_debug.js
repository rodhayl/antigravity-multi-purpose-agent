/**
 * Direct CDP Debug - Find and test prompt sending
 */
const http = require('http');

function cmd(action, params = {}) {
    return new Promise((resolve) => {
        const d = JSON.stringify({ action, params });
        http.request({
            hostname: '127.0.0.1', port: 54321, path: '/command', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': d.length }
        }, (res) => {
            let b = '';
            res.on('data', c => b += c);
            res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve({ raw: b }); } });
        }).end(d);
    });
}

async function main() {
    console.log('=== CDP Debug ===\n');

    // 1. Check connections
    const conn = await cmd('getCDPConnections');
    console.log('1. Connections:', conn.count || 0, 'pages');
    if (!conn.count) { console.log('ERROR: No CDP connections!'); return; }

    // 2. Check page info
    const page = await cmd('evaluateInBrowser', { code: 'document.title' });
    console.log('2. Connected to:', page.result);

    // 3. Check if sendPrompt function exists
    const fnExists = await cmd('evaluateInBrowser', { code: 'typeof window.__autoAcceptSendPrompt' });
    console.log('3. __autoAcceptSendPrompt:', fnExists.result);

    // 4. Check for contenteditable
    const editables = await cmd('evaluateInBrowser', {
        code: 'document.querySelectorAll("[contenteditable=true]").length'
    });
    console.log('4. Contenteditable elements:', editables.result);

    // 5. Try to find the chat input
    const inputCheck = await cmd('evaluateInBrowser', {
        code: `(function(){
            const els = document.querySelectorAll('[contenteditable="true"]');
            for(const el of els) {
                const cls = el.className || '';
                if(cls.includes('ime')) continue;
                const rect = el.getBoundingClientRect();
                if(rect.width > 100) return JSON.stringify({found:true, class:cls.substring(0,50), w:rect.width, h:rect.height});
            }
            return JSON.stringify({found:false});
        })()`
    });
    console.log('5. Chat input:', inputCheck.result);

    // 6. Send test prompt
    console.log('\n6. Sending test prompt...');
    const testMsg = 'DEBUG_PROMPT_TEST_' + Date.now();
    const sendResult = await cmd('sendPrompt', { prompt: testMsg });
    console.log('   Result:', sendResult);

    console.log('\n=== Check chat for:', testMsg, '===');
}

main().catch(console.error);
