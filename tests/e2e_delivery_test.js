/**
 * END-TO-END DELIVERY TEST
 * Verifies that prompts actually reach the Antigravity chat
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
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║         END-TO-END PROMPT DELIVERY VERIFICATION           ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    // Step 1: Check CDP connections
    console.log('Step 1: Checking CDP connections...');
    const conns = await debugAction('getCDPConnections');
    console.log(`  ✓ Found ${conns.count || 0} CDP connection(s)\n`);

    if (conns.count === 0) {
        console.log('  ❌ ERROR: No CDP connections. Cannot send prompts.');
        console.log('\n  Troubleshooting:');
        console.log('    1. Ensure extension is enabled');
        console.log('    2. Ensure Antigravity launched with --remote-debugging-port=9004');
        console.log('    3. Try toggling the extension off/on');
        return;
    }

    // Step 2: Send test prompt with unique ID
    const testId = `E2E_TEST_${Date.now()}`;
    const testPrompt = `${testId}: Respond with "OK" if you receive this message`;

    console.log('Step 2: Sending test prompt...');
    console.log(`  Message: "${testPrompt}"`);

    const result = await debugAction('sendPrompt', { prompt: testPrompt });
    console.log(`  Result: ${result.success ? '✓ Sent' : '✗ Failed'}`);

    if (!result.success) {
        console.log(`  ❌ ERROR: ${result.error}`);
        return;
    }

    // Step 3: Check history
    console.log('\nStep 3: Verifying in prompt history...');
    await new Promise(r => setTimeout(r, 500)); // Wait a bit
    const history = await debugAction('getPromptHistory');
    const historyList = history.history || [];
    const found = historyList.find(h => h.text && h.text.includes(testId));

    if (found) {
        console.log(`  ✓ Found in history: "${found.text.substring(0, 60)}..."`);
        console.log(`  ✓ Sent ${found.timeAgo}`);
    } else {
        console.log(`  ✗ NOT found in history`);
    }

    // Step 4: Summary
    console.log('\n' + '='.repeat(63));
    console.log('SUMMARY');
    console.log('='.repeat(63));
    console.log(`CDP Connections: ${conns.count}`);
    console.log(`Prompt Sent: ${result.success ? 'YES' : 'NO'}`);
    console.log(`In History: ${found ? 'YES' : 'NO'}`);
    console.log();

    if (result.success && found) {
        console.log('✅ TEST PASSED - Prompt was sent successfully');
        console.log();
        console.log('⚠️  MANUAL VERIFICATION REQUIRED:');
        console.log('   Please check the Antigravity chat to confirm the message');
        console.log(`   appeared and the AI responded. Look for: "${testId}"`);
    } else {
        console.log('❌ TEST FAILED - Prompt delivery issue detected');
    }
}

main().catch(console.error);
