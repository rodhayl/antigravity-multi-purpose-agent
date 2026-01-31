# Live CDP Debugging

This document describes the Live CDP Debugging feature for troubleshooting browser-side issues without requiring extension rebuilds.

## Overview

When developing features that interact with the Antigravity webview (like sending messages to the chat), you can use Live CDP Debugging to:
- Execute arbitrary JavaScript in the browser context
- Explore DOM elements
- Test selectors and input methods
- Iterate rapidly without rebuilding the extension

## Architecture

```
Test Script (Node.js)
    ↓ HTTP POST to localhost:54321
Debug Handler (Extension)
    ↓ evaluateInBrowser action
CDP Handler
    ↓ WebSocket connection
Antigravity Webview (Browser)
    ↓ Runtime.evaluate
JavaScript execution result → returned to test script
```

## Debug Actions

### `evaluateInBrowser`

Evaluates arbitrary JavaScript code in the browser context via CDP.

**Request:**
```json
{
    "action": "evaluateInBrowser",
    "params": {
        "code": "document.title"
    }
}
```

**Response:**
```json
{
    "success": true,
    "result": "Antigravity"
}
```

### `getCDPConnections`

Lists all active CDP connections and their injection status.

**Request:**
```json
{
    "action": "getCDPConnections",
    "params": {}
}
```

**Response:**
```json
{
    "success": true,
    "connections": [
        { "id": "9000:ABC123", "injected": true }
    ],
    "count": 1
}
```

## Usage Examples

### From Node.js Test Scripts

```javascript
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
            timeout: 15000
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

// Example: Find all contenteditable elements
const result = await evalInBrowser(`
    document.querySelectorAll('[contenteditable="true"]').length
`);
console.log(result); // { success: true, result: 2 }
```

### From Command Line

```bash
# Check document title
node -e "const http=require('http');const data=JSON.stringify({action:'evaluateInBrowser',params:{code:'document.title'}});http.request({hostname:'127.0.0.1',port:54321,path:'/command',method:'POST',headers:{'Content-Type':'application/json','Content-Length':data.length}},(res)=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>console.log(body))}).end(data)"

# Get CDP connection count
node -e "const http=require('http');const data=JSON.stringify({action:'getCDPConnections'});http.request({hostname:'127.0.0.1',port:54321,path:'/command',method:'POST',headers:{'Content-Type':'application/json','Content-Length':data.length}},(res)=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>console.log(body))}).end(data)"
```

## Debugging Workflow

### Step 1: Check CDP Connections

First verify CDP is connected to the browser:

```javascript
const connResult = await sendCommand('getCDPConnections', {});
console.log(connResult);
// Should return { success: true, count: N } where N > 0
```

### Step 2: Verify Script Injection

Check if the auto-accept script is injected:

```javascript
const fnCheck = await evalInBrowser('typeof window.__autoAcceptSendPrompt');
console.log(fnCheck);
// Should return { success: true, result: 'function' }
```

### Step 3: Explore DOM Elements

Scan for input elements:

```javascript
const scanResult = await evalInBrowser(`
    JSON.stringify({
        textareas: document.querySelectorAll('textarea').length,
        editables: document.querySelectorAll('[contenteditable="true"]').length
    })
`);
console.log(JSON.parse(scanResult.result));
```

### Step 4: Test Element Interaction

Once you find the right element, test setting text:

```javascript
const setResult = await evalInBrowser(`
    (function() {
        const el = document.querySelector('[contenteditable="true"]:not(.ime-text-area)');
        if (!el) return JSON.stringify({ error: 'Not found' });
        
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, 'Test message');
        
        return JSON.stringify({ success: true, text: el.innerText });
    })()
`);
console.log(setResult);
```

## Test Scripts

The following test scripts are available in `tests/`:

| Script | Purpose |
|--------|---------|
| `live_cdp_debug.js` | Comprehensive CDP connection and DOM exploration |
| `queue_prompt_test.js` | Send a prompt via injected browser script |
| `deep_cdp_diagnostic.js` | Deeper CDP inspection and diagnostics |
| `check_injection.js` | Verify injection and runtime functions |

### Running Test Scripts

```bash
# Comprehensive debug
node tests/live_cdp_debug.js

# Send a test prompt through the injected helper
node tests/queue_prompt_test.js
```

## Implementation Details

### Debug Handler (`main_scripts/debug-handler.js`)

The `evaluateInBrowser` action calls `scheduler.cdpHandler.evaluate()`:

```javascript
case 'evaluateInBrowser':
    if (params.code && scheduler && scheduler.cdpHandler) {
        try {
            const result = await scheduler.cdpHandler.evaluate(params.code);
            return { success: true, result: result };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
    return { success: false, error: 'No code provided or CDP handler not available' };
```

### CDP Handler (`main_scripts/cdp-handler.js`)

The `evaluate()` method runs code on all connections:

```javascript
async evaluate(expression) {
    let lastResult = null;
    for (const [id] of this.connections) {
        try {
            const res = await this._evaluate(id, expression);
            if (res) lastResult = res.result?.value;
        } catch (e) { }
    }
    return lastResult;
}
```

## Notes

- Evaluates code on **ALL** active CDP connections
- Returns the result from the first successful evaluation
- Useful for finding which webview contains the chat panel
- No extension rebuild required for testing JavaScript changes
- The extension must be running with debug mode enabled (default)

## Related Documentation

- [Send Message to Agent Chat](./SEND_MESSAGE_ANTIGRAVITY_TO_AGENT_CHAT.md) - How prompts are sent to the chat
- [GEMINI.md](../GEMINI.md) - AI assistant development notes
