# Sending Messages to Antigravity Agent Chat

This document details the implementation of programmatically sending messages to the Antigravity agent chat panel. This feature enables the **Prompt Queue** functionality and automated testing.

## Table of Contents
- [Overview](#overview)
- [The Challenge](#the-challenge)
- [Solution](#solution)
- [Implementation Details](#implementation-details)
- [Key Findings](#key-findings)
- [Code Flow](#code-flow)
- [Testing](#testing)

## Overview

The Auto Accept extension needs to send prompts to the Antigravity agent chat programmatically. This is required for:
- **Prompt Queue** - Automatically sending a series of prompts at scheduled intervals
- **Scheduler** - Running prompts based on cron schedules or timers
- **Testing** - Verifying the extension works correctly

## The Challenge

Antigravity's chat input is NOT accessible through standard VS Code extension APIs. We discovered:

1. **VS Code Chat Commands Don't Work** - Commands like `workbench.action.chat.open` and `workbench.action.chat.submit` target the GitHub Copilot chat panel, NOT Antigravity's agent panel.

2. **Antigravity Commands Exist But Behave Differently** - The command `antigravity.sendTextToChat` exists but doesn't send messages as expected (it actually closes the chat).

3. **The Chat Panel is a Webview** - Antigravity renders its chat interface inside a webview, which is accessible via Chrome DevTools Protocol (CDP).

4. **IME Overlay Trap** - There's a hidden `textarea.ime-text-area` element (Input Method Editor overlay) that appears in the DOM but is NOT the actual chat input.

## Solution

We use **Chrome DevTools Protocol (CDP)** to inject JavaScript directly into the webview and interact with the DOM:

```
Extension (Node.js) 
    → CDP Handler (WebSocket)
        → Antigravity Webview (Browser)
            → DOM Manipulation (JavaScript)
                → contenteditable element
                    → Enter key event → Message sent!
```

### The Winning Approach

1. **Find the REAL chat input** - A `contenteditable="true"` div with CSS classes like `cursor-text` and `overflow-y-auto`
2. **Exclude IME overlay** - Skip any element with `ime` in its class name
3. **Set text via `execCommand`** - Use `document.execCommand('selectAll')` followed by `document.execCommand('insertText', false, text)`
4. **Submit via Enter key** - Dispatch a `keydown` event with key `Enter`

## Implementation Details

### File: `main_scripts/full_cdp_script.js`

The `__autoAcceptSendPrompt` function handles sending messages:

```javascript
window.__autoAcceptSendPrompt = function (text) {
    // PRIORITY 1: Find large contenteditable (the real chat input)
    // Exclude elements with 'ime' in class (IME composition overlay)
    let inputBox = null;
    const editables = queryAll('[contenteditable="true"]');
    
    for (const el of editables) {
        const rect = el.getBoundingClientRect();
        const className = el.className || '';
        
        // Skip IME overlay and tiny elements
        if (className.includes('ime') || className.includes('IME')) continue;
        if (rect.width < 100 || rect.height < 20) continue;
        
        // Prefer elements with cursor-text or overflow classes
        if (className.includes('cursor-text') || className.includes('overflow')) {
            inputBox = el;
            break;
        }
        
        // Keep as candidate if large enough
        if (!inputBox && rect.width > 200) {
            inputBox = el;
        }
    }
    
    // Focus and set text
    inputBox.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
    inputBox.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Submit via Enter key after delay
    setTimeout(() => {
        inputBox.focus();
        inputBox.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        }));
    }, 300);
    
    return true;
};
```

### File: `main_scripts/cdp-handler.js`

The CDP handler calls the browser-side function:

```javascript
async sendPrompt(text, targetConversation = '') {
    for (const [id] of this.connections) {
        const result = await this._evaluate(id, `(async function(){ 
            if(window.__autoAcceptSendPromptToConversation) {
                await window.__autoAcceptSendPromptToConversation(
                    ${JSON.stringify(text)}, 
                    ${JSON.stringify(targetConversation)}
                );
                return 'sent';
            }
            return 'no function';
        })()`);
    }
}
```

### File: `extension.js`

The Scheduler's `queuePrompt` method orchestrates the flow:

```javascript
async queuePrompt(text) {
    this.promptQueue = this.promptQueue.then(async () => {
        if (text) {
            // Try Antigravity command first (alternative approach)
            try {
                await vscode.commands.executeCommand('antigravity.sendTextToChat', text);
            } catch (e) {
                // Fall back to CDP
                if (this.cdpHandler) {
                    await this.cdpHandler.sendPrompt(text, this.targetConversation);
                }
            }
        }
    });
}
```

## Key Findings

### 1. The Real Chat Input Element

The Antigravity chat input is a `contenteditable` div with these characteristics:

| Property | Value |
|----------|-------|
| Tag | `DIV` |
| Attribute | `contenteditable="true"` |
| Class contains | `cursor-text`, `overflow-y-auto`, `max-h-[300px]` |
| Size | ~379px wide, ~26px+ tall |
| NOT | `ime-text-area` (this is the IME overlay!) |

### 2. Why `execCommand` Works

The `document.execCommand('insertText')` method:
- Properly updates React's internal state
- Triggers the correct input event handlers
- Is recognized by the contenteditable element's event system

Direct assignment (`el.innerText = text`) does NOT work because React doesn't recognize the change.

### 3. Why Enter Key Submission Works

The chat submits when an Enter key `keydown` event is dispatched. The event must include:
- `key: 'Enter'`
- `bubbles: true`
- `cancelable: true`

### 4. The 300ms Delay

A delay before sending Enter is necessary because:
1. The UI needs time to process the text input
2. React's state update cycle needs to complete
3. The send button (if any) needs to become enabled

## Code Flow

```
User triggers "Send Prompt" (via Scheduler, Debug Server, or Command)
    ↓
extension.js: Scheduler.queuePrompt(text)
    ↓
cdp-handler.js: CDPHandler.sendPrompt(text, targetConversation)
    ↓
cdp-handler.js: CDPHandler._evaluate(id, scriptCode)
    ↓
CDP WebSocket → Antigravity Webview
    ↓
full_cdp_script.js: window.__autoAcceptSendPromptToConversation(text, target)
    ↓
(optional) Click target conversation tab
    ↓
full_cdp_script.js: window.__autoAcceptSendPrompt(text)
    ↓
1. Find contenteditable (exclude ime overlay)
2. Focus element
3. execCommand('selectAll') + execCommand('insertText', text)
4. Dispatch 'input' event
5. Wait 300ms
6. Dispatch 'keydown' Enter event
    ↓
Message appears in Antigravity agent chat! ✅
```

## Testing

### Interactive Testing (No Rebuild Required)

Use the `evaluateInBrowser` debug action to test JavaScript in the browser context:

```bash
node tests/queue_prompt_test.js
```

This script:
1. Finds the contenteditable chat input
2. Sets text using execCommand
3. Sends Enter key
4. Verifies if text was cleared (indicates successful submission)

### Debug Server Testing

Send a test prompt via the debug HTTP server:

```bash
node -e "const http=require('http');const data=JSON.stringify({action:'sendChatPrompt',params:{prompt:'Test message'}});http.request({hostname:'127.0.0.1',port:54321,path:'/command',method:'POST',headers:{'Content-Type':'application/json','Content-Length':data.length}},(res)=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>console.log(body))}).end(data)"
```

### Verification Checklist

- [ ] CDP connections established (check with `getCDPConnections` action)
- [ ] Script injected (`window.__autoAcceptSendPrompt` exists)
- [ ] Contenteditable element found (not IME overlay)
- [ ] Text set in element (check value after set)
- [ ] Enter key dispatched
- [ ] Text cleared after submission (indicates success)
- [ ] Message appears in chat panel

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| No CDP connections | CDPHandler not started | Ensure `cdpHandler.start(config)` is called |
| Script not injected | CDP connected to wrong webview | Check if connected to `antigravity.agentPanel` |
| Text set but not submitted | Enter event not processed | Increase delay before Enter key |
| Wrong element targeted | IME overlay found first | Check element class excludes `ime` |
| Message not appearing | Contenteditable not focused | Ensure `focus()` called before execCommand |

## Related Files

| File | Purpose |
|------|---------|
| `main_scripts/full_cdp_script.js` | Browser-side script with `__autoAcceptSendPrompt` |
| `main_scripts/cdp-handler.js` | CDP WebSocket connection manager |
| `main_scripts/debug-handler.js` | Debug HTTP server with `evaluateInBrowser` action |
| `extension.js` | Main extension with `Scheduler.queuePrompt` |
| `tests/queue_prompt_test.js` | Prompt sending test script |
| `INTERACTIVE-DEBUGGING.md` | How to debug without rebuilding |
