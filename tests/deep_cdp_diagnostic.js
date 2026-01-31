/**
 * Deep diagnostic of CDP connections
 */
const http = require('http');

function debugAction(action, params = {}) {
    return new Promise((resolve) => {
        const d = JSON.stringify({ action, params });
        const req = http.request({
            hostname: '127.0.0.1',
            port: 54321,
            path: '/command',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': d.length }
        }, (r) => {
            let b = '';
            r.on('data', c => b += c);
            r.on('end', () => {
                try { resolve(JSON.parse(b)); } catch (e) { resolve({ error: b }); }
            });
        });
        req.on('error', e => resolve({ error: e.message }));
        req.end(d);
    });
}

async function main() {
    console.log('=== Deep CDP Diagnostic ===\n');

    // Check what pages have contenteditable
    console.log('1. Checking connected pages for contenteditable...');
    const result = await debugAction('evaluateInBrowser', {
        code: `(function() {
            const all = document.querySelectorAll('[contenteditable="true"]');
            const nonIme = Array.from(all).filter(e => !(e.className || '').includes('ime'));
            return JSON.stringify({
                total: all.length,
                nonIme: nonIme.length,
                first: nonIme[0] ? {
                    tag: nonIme[0].tagName,
                    className: (nonIme[0].className || '').substring(0, 50),
                    visible: getComputedStyle(nonIme[0]).display !== 'none'
                } : null,
                docTitle: document.title,
                bodyText: document.body?.innerText?.substring(0, 100)
            });
        })()`
    });
    console.log('   Result:', result.result || result.error || result);

    // Check if we can find the chat input through body scanning
    console.log('\n2. Scanning for chat-like elements...');
    const scan = await debugAction('evaluateInBrowser', {
        code: `(function() {
            const inputs = document.querySelectorAll('input, textarea, [role="textbox"]');
            const buttons = document.querySelectorAll('button');
            return JSON.stringify({
                inputs: inputs.length,
                buttons: buttons.length,
                firstInput: inputs[0] ? inputs[0].tagName + '.' + (inputs[0].className || 'no-class').substring(0,30) : null,
                firstButton: buttons[0] ? buttons[0].innerText?.substring(0,20) : null
            });
        })()`
    });
    console.log('   Result:', scan.result || scan.error || scan);

    // Try sending prompt directly
    console.log('\n3. Attempting to call __autoAcceptSendPrompt...');
    const send = await debugAction('evaluateInBrowser', {
        code: `(function() {
            if (typeof window.__autoAcceptSendPrompt === 'function') {
                const result = window.__autoAcceptSendPrompt('DEEP_DIAGNOSTIC_TEST_' + Date.now());
                return 'Sent: ' + result;
            }
            return 'Function not found';
        })()`
    });
    console.log('   Result:', send.result || send.error || send);
}

main().catch(console.error);
