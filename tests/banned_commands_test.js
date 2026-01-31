/**
 * Banned Commands Feature Test Suite
 * Tests the command detection and blocking functionality
 */

// Mock DOM environment for testing
class MockElement {
    constructor(tagName, textContent = '', attributes = {}, children = []) {
        this.tagName = tagName.toLowerCase();
        this.textContent = textContent;
        this.attributes = attributes;
        this.children = children;
        this.parentElement = null;
        this.previousElementSibling = null;

        // Set up parent references for children
        children.forEach(child => {
            child.parentElement = this;
        });
    }

    getAttribute(name) {
        return this.attributes[name] || null;
    }

    querySelectorAll(selector) {
        const results = [];
        this._findMatching(selector, results);
        return results;
    }

    _findMatching(selector, results) {
        if (this._matchesSelector(selector)) {
            results.push(this);
        }
        this.children.forEach(child => child._findMatching(selector, results));
    }

    _matchesSelector(selector) {
        // Simple selector matching for tests
        if (selector === this.tagName) return true;
        if (selector.startsWith('.') && this.attributes.class?.includes(selector.slice(1))) return true;
        if (selector.startsWith('[class*="')) {
            const pattern = selector.match(/\[class\*="(.+)"\]/)?.[1];
            if (pattern && this.attributes.class?.includes(pattern)) return true;
        }
        if (selector.includes('code') && this.tagName === 'code') return true;
        if (selector.includes('pre') && this.tagName === 'pre') return true;
        return false;
    }
}

// Simulated banned command detection functions (mirroring full_cdp_script.js)
function findNearbyCommandText(el) {
    const commandSelectors = [
        'code', 'pre', 'pre code', '.monaco-editor',
        '[class*="terminal"]', '[class*="command"]',
        '[class*="code-block"]', '[class*="shell"]'
    ];

    let commandText = '';

    // Strategy 1: Traverse up to find the containing card/panel
    let container = el.parentElement;
    let maxDepth = 8;

    while (container && maxDepth > 0) {
        for (const selector of commandSelectors) {
            const codeElements = container.querySelectorAll(selector);
            for (const codeEl of codeElements) {
                if (codeEl && codeEl.textContent) {
                    const text = codeEl.textContent.trim();
                    if (text.length > 3 && text.length < 2000) {
                        commandText += ' ' + text;
                    }
                }
            }
        }

        if (commandText.length > 50) break;
        container = container.parentElement;
        maxDepth--;
    }

    // Strategy 2: Check siblings
    let sibling = el.previousElementSibling;
    let siblingCount = 0;
    while (sibling && siblingCount < 5) {
        for (const selector of commandSelectors) {
            const codeElements = sibling.querySelectorAll(selector);
            for (const codeEl of codeElements) {
                if (codeEl && codeEl.textContent) {
                    commandText += ' ' + codeEl.textContent.trim();
                }
            }
        }
        if (sibling.textContent) {
            commandText += ' ' + sibling.textContent.trim();
        }
        sibling = sibling.previousElementSibling;
        siblingCount++;
    }

    // Strategy 3: Check aria-label and title
    if (el.getAttribute('aria-label')) {
        commandText += ' ' + el.getAttribute('aria-label');
    }
    if (el.getAttribute('title')) {
        commandText += ' ' + el.getAttribute('title');
    }

    return commandText.toLowerCase();
}

function isCommandBanned(commandText, bannedList) {
    if (bannedList.length === 0) return { banned: false, pattern: null };
    const lowerText = commandText.toLowerCase();

    for (const banned of bannedList) {
        const pattern = banned.toLowerCase().trim();
        if (pattern && lowerText.includes(pattern)) {
            return { banned: true, pattern };
        }
    }
    return { banned: false, pattern: null };
}

// Test cases
const tests = [];

function test(name, fn) {
    tests.push({ name, fn });
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

// === TEST CASES ===

test('should detect rm -rf / command in code block', () => {
    const codeBlock = new MockElement('code', 'rm -rf /');
    const container = new MockElement('div', '', {}, [
        codeBlock,
        new MockElement('button', 'Run Command')
    ]);
    const button = container.children[1];
    button.parentElement = container;

    const commandText = findNearbyCommandText(button);
    const result = isCommandBanned(commandText, ['rm -rf /']);

    assert(result.banned === true, 'Should detect rm -rf / as banned');
    assert(result.pattern === 'rm -rf /', 'Should identify the matching pattern');
});

test('should detect format c: command', () => {
    const codeBlock = new MockElement('code', 'format c: /q');
    const container = new MockElement('div', '', {}, [
        codeBlock,
        new MockElement('button', 'Run')
    ]);
    const button = container.children[1];
    button.parentElement = container;

    const commandText = findNearbyCommandText(button);
    const result = isCommandBanned(commandText, ['format c:']);

    assert(result.banned === true, 'Should detect format c: as banned');
});

test('should allow safe commands', () => {
    const codeBlock = new MockElement('code', 'npm install lodash');
    const container = new MockElement('div', '', {}, [
        codeBlock,
        new MockElement('button', 'Run Command')
    ]);
    const button = container.children[1];
    button.parentElement = container;

    const commandText = findNearbyCommandText(button);
    const result = isCommandBanned(commandText, ['rm -rf /', 'format c:']);

    assert(result.banned === false, 'npm install should not be banned');
});

test('should detect del /f /s /q command', () => {
    const codeBlock = new MockElement('code', 'del /f /s /q C:\\*');
    const container = new MockElement('div', '', {}, [
        codeBlock,
        new MockElement('button', 'Execute')
    ]);
    const button = container.children[1];
    button.parentElement = container;

    const commandText = findNearbyCommandText(button);
    const result = isCommandBanned(commandText, ['del /f /s /q']);

    assert(result.banned === true, 'Should detect del command as banned');
});

test('should detect fork bomb', () => {
    const codeBlock = new MockElement('code', ':(){:|:&};:');
    const container = new MockElement('div', '', {}, [
        codeBlock,
        new MockElement('button', 'Run')
    ]);
    const button = container.children[1];
    button.parentElement = container;

    const commandText = findNearbyCommandText(button);
    const result = isCommandBanned(commandText, [':(){:|:&};:']);

    assert(result.banned === true, 'Should detect fork bomb as banned');
});

test('should find command in nested pre > code structure', () => {
    const code = new MockElement('code', 'rm -rf ~/*');
    const pre = new MockElement('pre', '', {}, [code]);
    const container = new MockElement('div', '', {}, [
        pre,
        new MockElement('button', 'Run')
    ]);
    const button = container.children[1];
    button.parentElement = container;

    const commandText = findNearbyCommandText(button);
    const result = isCommandBanned(commandText, ['rm -rf ~']);

    assert(result.banned === true, 'Should detect rm -rf ~ in nested structure');
});

test('should find command in previous sibling', () => {
    const siblingWithCode = new MockElement('div', '', {}, [
        new MockElement('code', 'dd if=/dev/zero of=/dev/sda')
    ]);
    const button = new MockElement('button', 'Execute');
    button.previousElementSibling = siblingWithCode;

    const commandText = findNearbyCommandText(button);
    const result = isCommandBanned(commandText, ['dd if=']);

    assert(result.banned === true, 'Should detect dd command in sibling');
});

test('should detect command from aria-label', () => {
    const button = new MockElement('button', 'Run', {
        'aria-label': 'Execute: chmod -R 777 /'
    });

    const commandText = findNearbyCommandText(button);
    const result = isCommandBanned(commandText, ['chmod -R 777 /']);

    assert(result.banned === true, 'Should detect command in aria-label');
});

test('should handle empty banned list', () => {
    const codeBlock = new MockElement('code', 'rm -rf /');
    const container = new MockElement('div', '', {}, [
        codeBlock,
        new MockElement('button', 'Run')
    ]);
    const button = container.children[1];
    button.parentElement = container;

    const commandText = findNearbyCommandText(button);
    const result = isCommandBanned(commandText, []);

    assert(result.banned === false, 'Empty banned list should allow all commands');
});

test('should be case insensitive', () => {
    const codeBlock = new MockElement('code', 'RM -RF /');
    const container = new MockElement('div', '', {}, [
        codeBlock,
        new MockElement('button', 'Run')
    ]);
    const button = container.children[1];
    button.parentElement = container;

    const commandText = findNearbyCommandText(button);
    const result = isCommandBanned(commandText, ['rm -rf /']);

    assert(result.banned === true, 'Should match case-insensitively');
});

test('should detect mkfs command', () => {
    const codeBlock = new MockElement('code', 'mkfs.ext4 /dev/sda1');
    const container = new MockElement('div', '', {}, [
        codeBlock,
        new MockElement('button', 'Run')
    ]);
    const button = container.children[1];
    button.parentElement = container;

    const commandText = findNearbyCommandText(button);
    const result = isCommandBanned(commandText, ['mkfs.']);

    assert(result.banned === true, 'Should detect mkfs command');
});

test('should detect rmdir /s /q command', () => {
    const codeBlock = new MockElement('code', 'rmdir /s /q C:\\Windows');
    const container = new MockElement('div', '', {}, [
        codeBlock,
        new MockElement('button', 'Run')
    ]);
    const button = container.children[1];
    button.parentElement = container;

    const commandText = findNearbyCommandText(button);
    const result = isCommandBanned(commandText, ['rmdir /s /q']);

    assert(result.banned === true, 'Should detect rmdir command');
});

// === RUN TESTS ===
console.log('======================================');
console.log('  BANNED COMMANDS TEST SUITE');
console.log('======================================\n');

let passed = 0;
let failed = 0;

for (const { name, fn } of tests) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (error) {
        console.log(`✗ ${name}`);
        console.log(`  Error: ${error.message}`);
        failed++;
    }
}

console.log('\n======================================');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('======================================');

if (failed > 0) {
    process.exit(1);
} else {
    console.log('\n✓ All tests passed!');
}
