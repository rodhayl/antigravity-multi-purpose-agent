const { CDPHandler } = require('../main_scripts/cdp-handler');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

// Mocking dependencies
const EventEmitter = require('events');

console.log('--- Testing CDPHandler Script Composition ---');

console.log('--- Initializing handler ---');
const handler = new CDPHandler();
console.log('--- Composing script ---');
const script = handler.getComposedScript();
console.log('--- Script composed, length:', script.length, '---');

assert(script.includes('window.__autoAcceptState'), 'Script should include state initialization');
assert(script.includes('window.__autoAcceptStart'), 'Script should include start function');
assert(script.includes('window.__autoAcceptStop'), 'Script should include stop function');
assert(script.includes('autoAccept'), 'Script should include autoAccept logic');

// Check that imports/exports are removed
assert(!script.includes('import * as utils'), 'Script should not have imports');
assert(!script.includes('export function'), 'Script should not have exports');

// Check namespace flattening (utils.getIDEName -> getIDEName)
assert(script.includes('const ide = getIDEName()') || script.includes('getIDEName()'), 'Namespace should be flattened');

console.log('✓ Script composition test passed');

console.log('\n--- Testing CDPHandler Command Sending (Mocked) ---');

class MockWS extends EventEmitter {
    constructor() { super(); this.readyState = 1; this.sent = []; }
    send(str) {
        this.sent.push(JSON.parse(str));
        const msg = JSON.parse(str);
        // Echo back success for any command
        setImmediate(() => {
            this.emit('message', JSON.stringify({ id: msg.id, result: { success: true } }));
        });
    }
}

async function testCommands() {
    const mockWS = new MockWS();
    handler.connections.set('p1', { ws: mockWS, injected: false });

    const res = await handler.sendCommand('p1', 'Runtime.evaluate', { expression: '1+1' });
    assert(res.success === true, 'Command should return result');
    assert(mockWS.sent[0].method === 'Runtime.evaluate', 'Method should match');
    assert(mockWS.sent[0].params.expression === '1+1', 'Params should match');

    console.log('✓ Command sending test passed');
}

testCommands().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
