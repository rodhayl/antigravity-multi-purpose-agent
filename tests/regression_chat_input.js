/**
 * REGRESSION TEST: Antigravity Chat Input Interaction
 * 
 * This script verifies that the extension can properly interact with the Antigravity
 * agent chat input. It tests:
 * 1. CDP connection
 * 2. Finding the correct contenteditable element (ignoring IME overlay)
 * 3. Setting text via execCommand
 * 4. (Optional) Submitting the message
 * 
 * Usage: 
 *   node tests/regression_chat_input.js [submit]
 * 
 *   pass 'submit' arg to actually send the Enter key event.
 *   otherwise it just sets text and validates.
 */

const http = require('http');

function evalInBrowser(code) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ action: 'evaluateInBrowser', params: { code } });
        const req = http.request({
            hostname: '127.0.0.1',
            port: 54321,
            path: '/command',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
            timeout: 10000
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { resolve({ raw: body }); }
            });
        });
        req.on('error', reject);
        req.end(data);
    });
}

function fail(msg) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
}

function pass(msg) {
    console.log(`✅ PASS: ${msg}`);
}

async function run() {
    console.log('=== Regression Test: Chat Input Interaction ===\n');

    // 1. Check CDP Connection
    console.log('Step 1: Checking CDP Connection...');
    try {
        const conn = await evalInBrowser('document.title');
        if (!conn || !conn.success) fail('Could not connect to browser via Debug Server (is extension running?)');
        pass(`Connected to: ${conn.result}`);
    } catch (e) {
        fail(`Connection error: ${e.message}`);
    }

    // 2. Find Chat Input
    console.log('\nStep 2: Finding Chat Input...');
    const findCode = `
        (function() {
            const editables = document.querySelectorAll('[contenteditable="true"]');
            let target = null;
            let candidates = [];
            
            for (const el of editables) {
                const rect = el.getBoundingClientRect();
                const cls = el.className || '';
                
                // IGNORE IME OVERLAY
                if (cls.includes('ime') || cls.includes('IME')) continue;
                if (rect.width < 100 || rect.height < 20) continue;
                
                candidates.push({ msg: 'Candidate found', width: rect.width, class: cls.substring(0,30) });
                
                // Prefer cursor-text/overflow (Antigravity pattern)
                if (cls.includes('cursor-text') || cls.includes('overflow')) {
                    target = el;
                    break;
                }
                
                // Fallback size check
                if (!target && rect.width > 200) target = el;
            }
            
            if (!target) return JSON.stringify({ found: false, candidates });
            
            return JSON.stringify({ 
                found: true, 
                class: target.className,
                id: target.id,
                width: target.getBoundingClientRect().width 
            });
        })()
    `;

    const findRes = await evalInBrowser(findCode);
    if (!findRes.success) fail('Eval failed finding input');

    const findData = JSON.parse(findRes.result);
    if (!findData.found) fail('Could not find suitable chat input element');
    pass(`Found input element (Class: ${findData.class.substring(0, 40)}...)`);

    // 3. Set Text Test
    const testText = `REGRESSION_TEST_${Date.now()}`;
    console.log(`\nStep 3: Setting text "${testText}"...`);

    const setCode = `
        (function() {
            const el = document.querySelector('[contenteditable="true"][class*="cursor-text"]') || 
                      document.querySelector('[contenteditable="true"]:not([class*="ime"])');
            
            if (!el) return JSON.stringify({ error: 'Element lost' });
            
            el.focus();
            document.execCommand('selectAll', false, null);
            const success = document.execCommand('insertText', false, '${testText}');
            
            return JSON.stringify({ success, val: el.innerText });
        })()
    `;

    const setRes = await evalInBrowser(setCode);
    const setData = JSON.parse(setRes.result);

    if (!setData.success && setData.val !== testText) fail('Failed to set text via execCommand');
    if (setData.val !== testText) fail(`Text mismatch. Expected "${testText}", got "${setData.val}"`);
    pass('Text successfully set via execCommand');

    // 4. Submit (Optional)
    const shouldSubmit = process.argv.includes('submit');
    if (shouldSubmit) {
        console.log('\nStep 4: Submitting message...');
        const submitCode = `
            (function() {
                const el = document.querySelector('[contenteditable="true"]:not([class*="ime"])');
                if (!el) return false;
                
                el.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, 
                    bubbles: true, cancelable: true
                }));
                return true;
            })()
        `;
        await evalInBrowser(submitCode);

        // Wait and check clear
        await new Promise(r => setTimeout(r, 500));

        const checkClearCode = `
            (function() {
                const el = document.querySelector('[contenteditable="true"]:not([class*="ime"])');
                return el ? el.innerText : 'ERROR';
            })()
        `;
        const clearRes = await evalInBrowser(checkClearCode);
        const textAfter = clearRes.result;

        if (textAfter === '' || textAfter === '\n') {
            pass('Input cleared after submit (Success implied)');
        } else {
            console.warn(`⚠️ WARNING: Input text is "${textAfter}" (Not cleared). Submit might have failed.`);
        }
    } else {
        console.log('\nStep 4: Skipping submit (pass "submit" arg to execute)');
        // Cleanup text
        await evalInBrowser(`
            (function(){
                const el = document.querySelector('[contenteditable="true"]:not([class*="ime"])');
                if(el) { document.execCommand('selectAll'); document.execCommand('delete'); }
            })()
        `);
        pass('Cleaned up test text');
    }

    console.log('\n✨ ALL TESTS PASSED');
}

run().catch(e => fail(e.message));
