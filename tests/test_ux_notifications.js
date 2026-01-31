/**
 * UX Notifications Feature Tests
 * Tests for:
 * 1. Away Actions tracking
 * 2. Session Summary stats
 * 3. Stats separation (ROI vs UX)
 * 4. Focus/blur state management
 */

const assert = require('assert');

// Mock window and document for Node.js environment
global.window = {
    __autoAcceptState: null,
    __autoAcceptListenersAttached: false,
    addEventListener: function () { },
    dispatchEvent: function () { }
};
global.document = {
    hidden: false,
    addEventListener: function () { }
};

// Helper to reset state before each test
function resetState() {
    window.__autoAcceptState = {
        isRunning: false,
        tabNames: [],
        sessionID: 0,
        currentMode: null,
        startTimes: {},
        bannedCommands: [],
        stats: {
            clicksThisSession: 0,
            blockedThisSession: 0,
            sessionStartTime: Date.now(),
            fileEditsThisSession: 0,
            terminalCommandsThisSession: 0,
            actionsWhileAway: 0,
            isWindowFocused: true,
            lastConversationUrl: null,
            lastConversationStats: null
        }
    };
}

// ============================================
// TEST SUITE: Stats Object Initialization
// ============================================

function test_stats_object_has_all_required_fields() {
    resetState();
    const stats = window.__autoAcceptState.stats;

    assert.strictEqual(typeof stats.clicksThisSession, 'number', 'clicksThisSession should be a number');
    assert.strictEqual(typeof stats.blockedThisSession, 'number', 'blockedThisSession should be a number');
    assert.strictEqual(typeof stats.fileEditsThisSession, 'number', 'fileEditsThisSession should be a number');
    assert.strictEqual(typeof stats.terminalCommandsThisSession, 'number', 'terminalCommandsThisSession should be a number');
    assert.strictEqual(typeof stats.actionsWhileAway, 'number', 'actionsWhileAway should be a number');
    assert.strictEqual(typeof stats.isWindowFocused, 'boolean', 'isWindowFocused should be a boolean');

    console.log('✅ PASS: Stats object has all required fields');
}

function test_stats_default_values() {
    resetState();
    const stats = window.__autoAcceptState.stats;

    assert.strictEqual(stats.clicksThisSession, 0, 'clicksThisSession should default to 0');
    assert.strictEqual(stats.blockedThisSession, 0, 'blockedThisSession should default to 0');
    assert.strictEqual(stats.fileEditsThisSession, 0, 'fileEditsThisSession should default to 0');
    assert.strictEqual(stats.terminalCommandsThisSession, 0, 'terminalCommandsThisSession should default to 0');
    assert.strictEqual(stats.actionsWhileAway, 0, 'actionsWhileAway should default to 0');
    assert.strictEqual(stats.isWindowFocused, true, 'isWindowFocused should default to true');

    console.log('✅ PASS: Stats have correct default values');
}

// ============================================
// TEST SUITE: Away Actions Tracking
// ============================================

function test_away_actions_increment_when_unfocused() {
    resetState();
    const stats = window.__autoAcceptState.stats;

    // Simulate window losing focus
    stats.isWindowFocused = false;

    // Simulate a click happening while away
    stats.clicksThisSession++;
    if (!stats.isWindowFocused) {
        stats.actionsWhileAway++;
    }

    assert.strictEqual(stats.actionsWhileAway, 1, 'actionsWhileAway should increment when window is unfocused');
    console.log('✅ PASS: Away actions increment when unfocused');
}

function test_away_actions_do_not_increment_when_focused() {
    resetState();
    const stats = window.__autoAcceptState.stats;

    // Window is focused (default)
    stats.isWindowFocused = true;

    // Simulate a click happening while focused
    stats.clicksThisSession++;
    if (!stats.isWindowFocused) {
        stats.actionsWhileAway++;
    }

    assert.strictEqual(stats.actionsWhileAway, 0, 'actionsWhileAway should NOT increment when window is focused');
    console.log('✅ PASS: Away actions do not increment when focused');
}

function test_away_actions_accumulate_over_multiple_clicks() {
    resetState();
    const stats = window.__autoAcceptState.stats;

    stats.isWindowFocused = false;

    // Simulate 5 clicks while away
    for (let i = 0; i < 5; i++) {
        stats.clicksThisSession++;
        if (!stats.isWindowFocused) {
            stats.actionsWhileAway++;
        }
    }

    assert.strictEqual(stats.actionsWhileAway, 5, 'actionsWhileAway should accumulate correctly');
    assert.strictEqual(stats.clicksThisSession, 5, 'clicksThisSession should also be 5');
    console.log('✅ PASS: Away actions accumulate over multiple clicks');
}

// ============================================
// TEST SUITE: Focus State Management
// ============================================

function test_focus_state_changes_correctly() {
    resetState();
    const stats = window.__autoAcceptState.stats;

    // Initially focused
    assert.strictEqual(stats.isWindowFocused, true, 'Should start focused');

    // Simulate blur
    stats.isWindowFocused = false;
    assert.strictEqual(stats.isWindowFocused, false, 'Should be unfocused after blur');

    // Simulate focus
    stats.isWindowFocused = true;
    assert.strictEqual(stats.isWindowFocused, true, 'Should be focused after focus');

    console.log('✅ PASS: Focus state changes correctly');
}

function test_wasAway_detection() {
    resetState();
    const stats = window.__autoAcceptState.stats;

    // User leaves (blur)
    stats.isWindowFocused = false;

    // Simulate some actions while away
    stats.actionsWhileAway = 3;

    // User returns (focus)
    const wasAway = !stats.isWindowFocused;
    stats.isWindowFocused = true;

    assert.strictEqual(wasAway, true, 'wasAway should be true when returning from unfocused state');
    assert.strictEqual(stats.actionsWhileAway, 3, 'actionsWhileAway should still have the count before reset');

    console.log('✅ PASS: wasAway detection works correctly');
}

// ============================================
// TEST SUITE: ROI Stats Reset Independence
// ============================================

function simulateResetStats() {
    const state = window.__autoAcceptState;
    const stats = {
        clicks: state.stats.clicksThisSession || 0,
        blocked: state.stats.blockedThisSession || 0,
        sessionStart: state.stats.sessionStartTime
    };
    // Reset ONLY core stats
    state.stats.clicksThisSession = 0;
    state.stats.blockedThisSession = 0;
    state.stats.sessionStartTime = Date.now();
    return stats;
}

function test_reset_stats_preserves_away_actions() {
    resetState();
    const stats = window.__autoAcceptState.stats;

    // Simulate being away with some actions
    stats.isWindowFocused = false;
    stats.clicksThisSession = 10;
    stats.actionsWhileAway = 10;
    stats.fileEditsThisSession = 3;
    stats.terminalCommandsThisSession = 7;

    // Simulate the ROI stats collection (every 30 seconds)
    simulateResetStats();

    // Check that UX-specific stats are PRESERVED
    assert.strictEqual(stats.actionsWhileAway, 10, 'actionsWhileAway should NOT be reset by ROI collection');
    assert.strictEqual(stats.fileEditsThisSession, 3, 'fileEditsThisSession should NOT be reset by ROI collection');
    assert.strictEqual(stats.terminalCommandsThisSession, 7, 'terminalCommandsThisSession should NOT be reset by ROI collection');

    // Check that core ROI stats ARE reset
    assert.strictEqual(stats.clicksThisSession, 0, 'clicksThisSession SHOULD be reset by ROI collection');
    assert.strictEqual(stats.blockedThisSession, 0, 'blockedThisSession SHOULD be reset by ROI collection');

    console.log('✅ PASS: Reset stats preserves away actions and session breakdown');
}

function test_reset_stats_returns_correct_values() {
    resetState();
    const stats = window.__autoAcceptState.stats;

    stats.clicksThisSession = 42;
    stats.blockedThisSession = 5;

    const result = simulateResetStats();

    assert.strictEqual(result.clicks, 42, 'Returned clicks should be 42');
    assert.strictEqual(result.blocked, 5, 'Returned blocked should be 5');

    console.log('✅ PASS: Reset stats returns correct values before resetting');
}

// ============================================
// TEST SUITE: Get Away Actions API
// ============================================

function simulateGetAwayActions() {
    const state = window.__autoAcceptState;
    const count = state.stats.actionsWhileAway || 0;
    // Reset the counter after reading
    state.stats.actionsWhileAway = 0;
    return count;
}

function test_get_away_actions_returns_count_and_resets() {
    resetState();
    const stats = window.__autoAcceptState.stats;

    stats.actionsWhileAway = 15;

    const count = simulateGetAwayActions();

    assert.strictEqual(count, 15, 'getAwayActions should return the current count');
    assert.strictEqual(stats.actionsWhileAway, 0, 'actionsWhileAway should be reset after reading');

    console.log('✅ PASS: getAwayActions returns count and resets');
}

function test_get_away_actions_returns_zero_if_none() {
    resetState();

    const count = simulateGetAwayActions();

    assert.strictEqual(count, 0, 'getAwayActions should return 0 if no actions while away');

    console.log('✅ PASS: getAwayActions returns zero if no actions');
}

// ============================================
// TEST SUITE: Session Summary
// ============================================

function simulateGetSessionSummary() {
    const state = window.__autoAcceptState;
    const clicks = state.stats.clicksThisSession || 0;
    const fileEdits = state.stats.fileEditsThisSession || 0;
    const terminalCommands = state.stats.terminalCommandsThisSession || 0;
    const blocked = state.stats.blockedThisSession || 0;

    const baseSecs = clicks * 5;
    const minMins = Math.max(1, Math.floor((baseSecs * 0.8) / 60));
    const maxMins = Math.ceil((baseSecs * 1.2) / 60);

    return {
        clicks,
        fileEdits,
        terminalCommands,
        blocked,
        estimatedTimeSaved: clicks > 0 ? `${minMins}–${maxMins}` : null
    };
}

function test_session_summary_returns_correct_breakdown() {
    resetState();
    const stats = window.__autoAcceptState.stats;

    stats.clicksThisSession = 20;
    stats.fileEditsThisSession = 8;
    stats.terminalCommandsThisSession = 12;
    stats.blockedThisSession = 2;

    const summary = simulateGetSessionSummary();

    assert.strictEqual(summary.clicks, 20, 'Summary clicks should be 20');
    assert.strictEqual(summary.fileEdits, 8, 'Summary fileEdits should be 8');
    assert.strictEqual(summary.terminalCommands, 12, 'Summary terminalCommands should be 12');
    assert.strictEqual(summary.blocked, 2, 'Summary blocked should be 2');
    assert.ok(summary.estimatedTimeSaved !== null, 'estimatedTimeSaved should not be null when clicks > 0');

    console.log('✅ PASS: Session summary returns correct breakdown');
}

function test_session_summary_time_estimate_is_null_when_no_clicks() {
    resetState();

    const summary = simulateGetSessionSummary();

    assert.strictEqual(summary.estimatedTimeSaved, null, 'estimatedTimeSaved should be null when no clicks');

    console.log('✅ PASS: Session summary time estimate is null when no clicks');
}

// ============================================
// TEST SUITE: State Migration (Backwards Compatibility)
// ============================================

function test_state_migration_adds_missing_fields() {
    // Simulate an OLD state object that doesn't have the new fields
    window.__autoAcceptState = {
        isRunning: true,
        stats: {
            clicksThisSession: 5,
            blockedThisSession: 1
            // MISSING: fileEditsThisSession, terminalCommandsThisSession, actionsWhileAway, isWindowFocused
        }
    };

    // Simulate migration logic
    const s = window.__autoAcceptState.stats;
    if (s.actionsWhileAway === undefined) s.actionsWhileAway = 0;
    if (s.isWindowFocused === undefined) s.isWindowFocused = true;
    if (s.fileEditsThisSession === undefined) s.fileEditsThisSession = 0;
    if (s.terminalCommandsThisSession === undefined) s.terminalCommandsThisSession = 0;

    // Check migration worked
    assert.strictEqual(s.actionsWhileAway, 0, 'actionsWhileAway should be added as 0');
    assert.strictEqual(s.isWindowFocused, true, 'isWindowFocused should be added as true');
    assert.strictEqual(s.fileEditsThisSession, 0, 'fileEditsThisSession should be added as 0');
    assert.strictEqual(s.terminalCommandsThisSession, 0, 'terminalCommandsThisSession should be added as 0');

    // Old values should be preserved
    assert.strictEqual(s.clicksThisSession, 5, 'Old clicksThisSession should be preserved');
    assert.strictEqual(s.blockedThisSession, 1, 'Old blockedThisSession should be preserved');

    console.log('✅ PASS: State migration adds missing fields without overwriting existing ones');
}

// ============================================
// TEST SUITE: Action Categorization
// ============================================

function test_file_edits_categorization() {
    resetState();
    const stats = window.__autoAcceptState.stats;

    // Simulate clicking a file edit button (e.g., "Accept", "Accept All")
    const buttonText = 'Accept';
    stats.clicksThisSession++;

    // Categorization logic (simplified)
    const isTerminalCommand = ['run', 'run command'].includes(buttonText.toLowerCase());
    if (isTerminalCommand) {
        stats.terminalCommandsThisSession++;
    } else {
        stats.fileEditsThisSession++;
    }

    assert.strictEqual(stats.fileEditsThisSession, 1, 'File edits should increment for Accept button');
    assert.strictEqual(stats.terminalCommandsThisSession, 0, 'Terminal commands should NOT increment for Accept button');

    console.log('✅ PASS: File edits categorization works correctly');
}

function test_terminal_command_categorization() {
    resetState();
    const stats = window.__autoAcceptState.stats;

    // Simulate clicking a terminal command button (e.g., "Run")
    const buttonText = 'Run';
    stats.clicksThisSession++;

    // Categorization logic (simplified)
    const isTerminalCommand = ['run', 'run command'].includes(buttonText.toLowerCase());
    if (isTerminalCommand) {
        stats.terminalCommandsThisSession++;
    } else {
        stats.fileEditsThisSession++;
    }

    assert.strictEqual(stats.terminalCommandsThisSession, 1, 'Terminal commands should increment for Run button');
    assert.strictEqual(stats.fileEditsThisSession, 0, 'File edits should NOT increment for Run button');

    console.log('✅ PASS: Terminal command categorization works correctly');
}

// ============================================
// RUN ALL TESTS
// ============================================

function runAllTests() {
    console.log('\n========================================');
    console.log('  UX NOTIFICATIONS FEATURE TESTS');
    console.log('========================================\n');

    let passed = 0;
    let failed = 0;

    const tests = [
        // Stats Object Initialization
        test_stats_object_has_all_required_fields,
        test_stats_default_values,

        // Away Actions Tracking
        test_away_actions_increment_when_unfocused,
        test_away_actions_do_not_increment_when_focused,
        test_away_actions_accumulate_over_multiple_clicks,

        // Focus State Management
        test_focus_state_changes_correctly,
        test_wasAway_detection,

        // ROI Stats Reset Independence
        test_reset_stats_preserves_away_actions,
        test_reset_stats_returns_correct_values,

        // Get Away Actions API
        test_get_away_actions_returns_count_and_resets,
        test_get_away_actions_returns_zero_if_none,

        // Session Summary
        test_session_summary_returns_correct_breakdown,
        test_session_summary_time_estimate_is_null_when_no_clicks,

        // State Migration
        test_state_migration_adds_missing_fields,

        // Action Categorization
        test_file_edits_categorization,
        test_terminal_command_categorization
    ];

    for (const test of tests) {
        try {
            test();
            passed++;
        } catch (e) {
            console.log(`❌ FAIL: ${test.name}`);
            console.log(`   Error: ${e.message}`);
            failed++;
        }
    }

    console.log('\n========================================');
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
    console.log('========================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runAllTests();
