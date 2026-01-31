/**
 * Automated Tests for Antigravity Integration
 * 
 * Run with: node tests/antigravity-integration.test.js
 */

'use strict';

const assert = require('assert');

// Test utilities
let testsPassed = 0;
let testsFailed = 0;
const testResults = [];

function test(name, fn) {
    try {
        fn();
        testsPassed++;
        testResults.push({ name, passed: true });
        console.log(`  ✅ ${name}`);
    } catch (e) {
        testsFailed++;
        testResults.push({ name, passed: false, error: e.message });
        console.log(`  ❌ ${name}`);
        console.log(`     Error: ${e.message}`);
    }
}

async function testAsync(name, fn) {
    try {
        await fn();
        testsPassed++;
        testResults.push({ name, passed: true });
        console.log(`  ✅ ${name}`);
    } catch (e) {
        testsFailed++;
        testResults.push({ name, passed: false, error: e.message });
        console.log(`  ❌ ${name}`);
        console.log(`     Error: ${e.message}`);
    }
}

// ============================================================
// STRATEGIES TESTS
// ============================================================

console.log('\n📋 Testing: strategies.js');
console.log('─'.repeat(50));

const { WindowsStrategy, UnixStrategy } = require('../main_scripts/antigravity/strategies');

test('WindowsStrategy: constructor initializes with PowerShell', () => {
    const strategy = new WindowsStrategy();
    assert.strictEqual(strategy.usePowerShell, true);
});

test('WindowsStrategy: getProcessListCommand returns PowerShell command', () => {
    const strategy = new WindowsStrategy();
    const cmd = strategy.getProcessListCommand('language_server_windows_x64.exe');
    assert.ok(cmd.includes('powershell'));
    assert.ok(cmd.includes('Get-CimInstance'));
    assert.ok(cmd.includes('language_server_windows_x64.exe'));
});

test('WindowsStrategy: isAntigravityProcess detects --app_data_dir antigravity', () => {
    const strategy = new WindowsStrategy();
    assert.strictEqual(
        strategy.isAntigravityProcess('--app_data_dir antigravity --other args'),
        true
    );
    assert.strictEqual(
        strategy.isAntigravityProcess('--app_data_dir vscode'),
        false
    );
});

test('WindowsStrategy: isAntigravityProcess detects antigravity path', () => {
    const strategy = new WindowsStrategy();
    assert.strictEqual(
        strategy.isAntigravityProcess('C:\\Users\\test\\antigravity\\server.exe'),
        true
    );
    assert.strictEqual(
        strategy.isAntigravityProcess('/opt/antigravity/bin/server'),
        true
    );
});

test('WindowsStrategy: parseProcessInfo handles JSON array', () => {
    const strategy = new WindowsStrategy();
    const stdout = JSON.stringify([
        {
            ProcessId: 1234,
            CommandLine: 'server.exe --app_data_dir antigravity --extension_server_port 54321 --csrf_token abc-123-def'
        }
    ]);

    const result = strategy.parseProcessInfo(stdout);
    assert.ok(result);
    assert.strictEqual(result.pid, 1234);
    assert.strictEqual(result.extensionPort, 54321);
    assert.strictEqual(result.csrfToken, 'abc-123-def');
});

test('WindowsStrategy: parseProcessInfo handles single JSON object', () => {
    const strategy = new WindowsStrategy();
    const stdout = JSON.stringify({
        ProcessId: 5678,
        CommandLine: 'server.exe --app_data_dir antigravity --extension_server_port=9999 --csrf_token=xyz-789'
    });

    const result = strategy.parseProcessInfo(stdout);
    assert.ok(result);
    assert.strictEqual(result.pid, 5678);
    assert.strictEqual(result.extensionPort, 9999);
    assert.strictEqual(result.csrfToken, 'xyz-789');
});

test('WindowsStrategy: parseProcessInfo returns null for non-Antigravity process', () => {
    const strategy = new WindowsStrategy();
    const stdout = JSON.stringify({
        ProcessId: 1111,
        CommandLine: 'server.exe --app_data_dir vscode --extension_server_port 12345 --csrf_token aaa-bbb'
    });

    const result = strategy.parseProcessInfo(stdout);
    assert.strictEqual(result, null);
});

test('WindowsStrategy: parseProcessInfo returns null for empty array', () => {
    const strategy = new WindowsStrategy();
    const result = strategy.parseProcessInfo('[]');
    assert.strictEqual(result, null);
});

test('WindowsStrategy: parseProcessInfo handles WMIC format', () => {
    const strategy = new WindowsStrategy();
    strategy.usePowerShell = false;

    const stdout = `
CommandLine=server.exe --app_data_dir antigravity --extension_server_port 8080 --csrf_token wmic-token-123
ProcessId=9999

`;

    const result = strategy.parseProcessInfo(stdout);
    assert.ok(result);
    assert.strictEqual(result.pid, 9999);
    assert.strictEqual(result.extensionPort, 8080);
    assert.strictEqual(result.csrfToken, 'wmic-token-123');
});

test('WindowsStrategy: parseListeningPorts handles JSON array', () => {
    const strategy = new WindowsStrategy();
    const stdout = JSON.stringify([8080, 9004, 9005]);

    const ports = strategy.parseListeningPorts(stdout, 1234);
    assert.deepStrictEqual(ports, [8080, 9004, 9005]);
});

test('WindowsStrategy: parseListeningPorts handles single number', () => {
    const strategy = new WindowsStrategy();
    const stdout = '8080';

    const ports = strategy.parseListeningPorts(stdout, 1234);
    assert.deepStrictEqual(ports, [8080]);
});

test('UnixStrategy: constructor stores platform', () => {
    const darwin = new UnixStrategy('darwin');
    const linux = new UnixStrategy('linux');
    assert.strictEqual(darwin.platform, 'darwin');
    assert.strictEqual(linux.platform, 'linux');
});

test('UnixStrategy: getProcessListCommand returns platform-specific command', () => {
    const darwin = new UnixStrategy('darwin');
    const linux = new UnixStrategy('linux');

    assert.ok(darwin.getProcessListCommand('server').includes('pgrep -fl'));
    assert.ok(linux.getProcessListCommand('server').includes('pgrep -af'));
});

test('UnixStrategy: parseProcessInfo handles null input', () => {
    const strategy = new UnixStrategy('linux');
    assert.strictEqual(strategy.parseProcessInfo(null), null);
    assert.strictEqual(strategy.parseProcessInfo(undefined), null);
    assert.strictEqual(strategy.parseProcessInfo(''), null);
});

test('UnixStrategy: parseProcessInfo parses valid process line', () => {
    const strategy = new UnixStrategy('linux');
    const stdout = '12345 /opt/server --extension_server_port 9999 --csrf_token unix-token-456';

    const result = strategy.parseProcessInfo(stdout);
    assert.ok(result);
    assert.strictEqual(result.pid, 12345);
    assert.strictEqual(result.extensionPort, 9999);
    assert.strictEqual(result.csrfToken, 'unix-token-456');
});

// ============================================================
// PROCESS FINDER TESTS
// ============================================================

console.log('\n📋 Testing: process-finder.js');
console.log('─'.repeat(50));

const { ProcessFinder } = require('../main_scripts/antigravity/process-finder');

test('ProcessFinder: constructor initializes correctly on Windows', () => {
    // Mock for testing
    const mockLog = () => { };
    const finder = new ProcessFinder(mockLog);

    assert.ok(finder.strategy);
    assert.ok(finder.processName);
    assert.strictEqual(typeof finder.log, 'function');
});

test('ProcessFinder: find() method exists', () => {
    const finder = new ProcessFinder(() => { });
    assert.strictEqual(typeof finder.find, 'function');
});

test('ProcessFinder: detectProcessInfo() method exists', () => {
    const finder = new ProcessFinder(() => { });
    assert.strictEqual(typeof finder.detectProcessInfo, 'function');
});

test('ProcessFinder: testPort() method exists', () => {
    const finder = new ProcessFinder(() => { });
    assert.strictEqual(typeof finder.testPort, 'function');
});

// ============================================================
// CLIENT TESTS
// ============================================================

console.log('\n📋 Testing: client.js');
console.log('─'.repeat(50));

const { AntigravityClient } = require('../main_scripts/antigravity/client');

test('AntigravityClient: constructor initializes with defaults', () => {
    const client = new AntigravityClient(() => { });

    assert.strictEqual(client.port, 0);
    assert.strictEqual(client.csrfToken, '');
    assert.strictEqual(client.connected, false);
    assert.ok(client.processFinder);
    assert.strictEqual(client.reconnectAttempts, 0);
    assert.strictEqual(client.maxReconnectAttempts, 3);
});

test('AntigravityClient: init() sets connection details', () => {
    const client = new AntigravityClient(() => { });
    client.init(8080, 'test-token-123');

    assert.strictEqual(client.port, 8080);
    assert.strictEqual(client.csrfToken, 'test-token-123');
    assert.strictEqual(client.connected, true);
});

test('AntigravityClient: isConnected() returns correct state', () => {
    const client = new AntigravityClient(() => { });

    assert.strictEqual(client.isConnected(), false);
    client.init(8080, 'token');
    assert.strictEqual(client.isConnected(), true);
});

test('AntigravityClient: getStatus() returns correct string', () => {
    const client = new AntigravityClient(() => { });

    assert.strictEqual(client.getStatus(), 'Disconnected');
    client.init(8080, 'token');
    assert.strictEqual(client.getStatus(), 'Connected (port 8080)');
});

test('AntigravityClient: disconnect() resets state', () => {
    const client = new AntigravityClient(() => { });
    client.init(8080, 'test-token');

    assert.strictEqual(client.connected, true);
    client.disconnect();

    assert.strictEqual(client.connected, false);
    assert.strictEqual(client.port, 0);
    assert.strictEqual(client.csrfToken, '');
});

test('AntigravityClient: onUpdate() registers callback', () => {
    const client = new AntigravityClient(() => { });
    const callback = () => { };

    client.onUpdate(callback);
    assert.strictEqual(client.updateCallback, callback);
});

test('AntigravityClient: onError() registers callback', () => {
    const client = new AntigravityClient(() => { });
    const callback = () => { };

    client.onError(callback);
    assert.strictEqual(client.errorCallback, callback);
});

test('AntigravityClient: formatTime() handles ready state', () => {
    const client = new AntigravityClient(() => { });
    assert.strictEqual(client.formatTime(-1000, new Date()), 'Ready');
    assert.strictEqual(client.formatTime(0, new Date()), 'Ready');
});

test('AntigravityClient: formatTime() formats minutes correctly', () => {
    const client = new AntigravityClient(() => { });
    const resetTime = new Date(Date.now() + 30 * 60 * 1000);
    const result = client.formatTime(30 * 60 * 1000, resetTime);

    assert.ok(result.includes('30m'));
});

test('AntigravityClient: formatTime() formats hours correctly', () => {
    const client = new AntigravityClient(() => { });
    const resetTime = new Date(Date.now() + 90 * 60 * 1000);
    const result = client.formatTime(90 * 60 * 1000, resetTime);

    assert.ok(result.includes('1h'));
});

test('AntigravityClient: parseResponse() handles empty data', () => {
    const client = new AntigravityClient(() => { });
    const result = client.parseResponse({});

    assert.ok(result.timestamp);
    assert.strictEqual(result.promptCredits, null);
    assert.deepStrictEqual(result.models, []);
    assert.deepStrictEqual(result.user, { name: '', email: '', plan: 'Unknown' });
});

test('AntigravityClient: parseResponse() parses user info', () => {
    const client = new AntigravityClient(() => { });
    const result = client.parseResponse({
        userStatus: {
            name: 'Test User',
            email: 'test@example.com',
            planStatus: {
                planInfo: {
                            planName: 'Test Plan'
                }
            }
        }
    });

    assert.strictEqual(result.user.name, 'Test User');
    assert.strictEqual(result.user.email, 'test@example.com');
    assert.strictEqual(result.user.plan, 'Test Plan');
});

test('AntigravityClient: parseResponse() calculates prompt credits', () => {
    const client = new AntigravityClient(() => { });
    const result = client.parseResponse({
        userStatus: {
            planStatus: {
                planInfo: {
                    monthlyPromptCredits: 1000
                },
                availablePromptCredits: 750
            }
        }
    });

    assert.ok(result.promptCredits);
    assert.strictEqual(result.promptCredits.available, 750);
    assert.strictEqual(result.promptCredits.monthly, 1000);
    assert.strictEqual(result.promptCredits.remainingPercentage, 75);
    assert.strictEqual(result.promptCredits.usedPercentage, 25);
});

test('AntigravityClient: request() rejects when not connected', async () => {
    const client = new AntigravityClient(() => { });

    try {
        await client.request('/test', {});
        assert.fail('Should have thrown');
    } catch (e) {
        assert.strictEqual(e.message, 'Client not connected');
    }
});

// ============================================================
// INDEX TESTS
// ============================================================

console.log('\n📋 Testing: index.js (barrel export)');
console.log('─'.repeat(50));

test('index.js: exports all classes', () => {
    const index = require('../main_scripts/antigravity/index');

    assert.ok(index.AntigravityClient);
    assert.ok(index.ProcessFinder);
    assert.ok(index.WindowsStrategy);
    assert.ok(index.UnixStrategy);
});

// ============================================================
// SUMMARY
// ============================================================

console.log('\n' + '═'.repeat(50));
console.log('📊 TEST SUMMARY');
console.log('═'.repeat(50));
console.log(`  Total:  ${testsPassed + testsFailed}`);
console.log(`  Passed: ${testsPassed} ✅`);
console.log(`  Failed: ${testsFailed} ❌`);
console.log('═'.repeat(50));

if (testsFailed > 0) {
    console.log('\n❌ FAILED TESTS:');
    testResults.filter(t => !t.passed).forEach(t => {
        console.log(`  - ${t.name}: ${t.error}`);
    });
    process.exit(1);
} else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
}
