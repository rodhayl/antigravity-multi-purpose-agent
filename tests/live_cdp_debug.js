/**
 * Live CDP Debug Script
 * 
 * This script uses the evaluateInBrowser debug action to explore the DOM
 * and find the chat input area WITHOUT requiring extension rebuilds.
 * 
 * Usage: node tests/live_cdp_debug.js
 */

const http = require('http');

function sendCommand(action, params = {}) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ action, params });
        const options = {
            hostname: '127.0.0.1',
            port: 54321,
            path: '/command',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
            timeout: 30000
        };
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { resolve({ raw: body }); }
            });
        });
        req.on('error', (e) => reject(e));
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(data);
        req.end();
    });
}

async function evalInBrowser(code) {
    const result = await sendCommand('evaluateInBrowser', { code });
    return result;
}

async function run() {
    console.log('=== Live CDP Debug ===\n');

    // Step 1: Check CDP connections
    console.log('1. Checking CDP connections...');
    const connResult = await sendCommand('getCDPConnections');
    console.log('   Connections:', JSON.stringify(connResult, null, 2));

    if (!connResult.success || connResult.count === 0) {
        console.log('   ERROR: No CDP connections! Cannot proceed.\n');
        return;
    }

    // Step 2: Check if __autoAcceptSendPrompt exists
    console.log('\n2. Checking if __autoAcceptSendPrompt exists...');
    const fnCheck = await evalInBrowser('typeof window.__autoAcceptSendPrompt');
    console.log('   Result:', JSON.stringify(fnCheck));

    // Step 3: Scan for input elements
    console.log('\n3. Scanning for input elements in the DOM...');
    const scanCode = `
        (function() {
            const results = {
                textareas: [],
                contentEditables: [],
                inputs: [],
                proseMirrors: [],
                divWithInput: []
            };
            
            // Helper to get all documents including iframe
            function getAllDocs(root = document) {
                let docs = [root];
                try {
                    const iframes = root.querySelectorAll('iframe, frame');
                    for (const iframe of iframes) {
                        try {
                            const doc = iframe.contentDocument || iframe.contentWindow?.document;
                            if (doc) docs.push(...getAllDocs(doc));
                        } catch (e) {}
                    }
                } catch (e) {}
                return docs;
            }
            
            function queryAll(sel) {
                const res = [];
                getAllDocs().forEach(doc => {
                    try { res.push(...Array.from(doc.querySelectorAll(sel))); } catch (e) {}
                });
                return res;
            }
            
            // Check if visible
            function isVisible(el) {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.display !== 'none' && rect.width > 0 && style.visibility !== 'hidden';
            }
            
            // Find textareas
            queryAll('textarea').forEach(el => {
                results.textareas.push({
                    id: el.id,
                    class: el.className,
                    placeholder: el.placeholder,
                    visible: isVisible(el),
                    value: el.value?.substring(0, 50)
                });
            });
            
            // Find contenteditable
            queryAll('[contenteditable="true"]').forEach(el => {
                results.contentEditables.push({
                    tag: el.tagName,
                    class: el.className,
                    visible: isVisible(el),
                    text: el.innerText?.substring(0, 50)
                });
            });
            
            // Find ProseMirror
            queryAll('.ProseMirror').forEach(el => {
                results.proseMirrors.push({
                    class: el.className,
                    visible: isVisible(el),
                    text: el.innerText?.substring(0, 50)
                });
            });
            
            // Find divs with 'input' in class
            queryAll('div[class*="input"]').forEach(el => {
                if (el.querySelector('textarea') || el.querySelector('[contenteditable]')) {
                    results.divWithInput.push({
                        class: el.className,
                        visible: isVisible(el),
                        hasTextarea: !!el.querySelector('textarea'),
                        hasEditable: !!el.querySelector('[contenteditable]')
                    });
                }
            });
            
            return JSON.stringify(results, null, 2);
        })()
    `;

    const scanResult = await evalInBrowser(scanCode);
    console.log('   Result:', JSON.stringify(scanResult, null, 2));

    // Step 4: Try to find the EXACT chat input used by Antigravity
    console.log('\n4. Looking for Antigravity-specific chat input...');
    const antigravityCode = `
        (function() {
            function getAllDocs(root = document) {
                let docs = [root];
                try {
                    const iframes = root.querySelectorAll('iframe, frame');
                    for (const iframe of iframes) {
                        try {
                            const doc = iframe.contentDocument || iframe.contentWindow?.document;
                            if (doc) docs.push(...getAllDocs(doc));
                        } catch (e) {}
                    }
                } catch (e) {}
                return docs;
            }
            
            function queryAll(sel) {
                const res = [];
                getAllDocs().forEach(doc => {
                    try { res.push(...Array.from(doc.querySelectorAll(sel))); } catch (e) {}
                });
                return res;
            }
            
            // Antigravity-specific selectors
            const selectors = [
                'div.full-input-box textarea',
                'div.full-input-box div[contenteditable="true"]',
                '.ProseMirror',
                'div[class*="input"] textarea',
                'div[class*="composer"] textarea',
                'textarea[placeholder*="Ask"]',
                'textarea[placeholder*="Type"]'
            ];
            
            const found = {};
            selectors.forEach(sel => {
                const els = queryAll(sel);
                if (els.length > 0) {
                    found[sel] = els.length + ' element(s)';
                }
            });
            
            return JSON.stringify(found);
        })()
    `;

    const antigravityResult = await evalInBrowser(antigravityCode);
    console.log('   Result:', JSON.stringify(antigravityResult, null, 2));

    // Step 5: Try to send a test message
    console.log('\n5. Attempting to send test message via __autoAcceptSendPrompt...');
    const testMessage = 'DEBUG_TEST_' + Date.now();
    const sendCode = `
        (function() {
            if (typeof window.__autoAcceptSendPrompt === 'function') {
                const result = window.__autoAcceptSendPrompt("${testMessage}");
                return JSON.stringify({ sent: true, result: result });
            } else {
                return JSON.stringify({ sent: false, error: '__autoAcceptSendPrompt not found' });
            }
        })()
    `;

    const sendResult = await evalInBrowser(sendCode);
    console.log('   Result:', JSON.stringify(sendResult, null, 2));

    console.log('\n=== DONE ===');
    console.log(`\nCheck your Antigravity chat panel for: "${testMessage}"`);
}

run().catch(console.error);
