/**
 * Analytics Module Tests
 * Comprehensive tests for the refactored analytics system.
 */

const assert = require('assert');

// Mock browser environment BEFORE loading the module
global.window = {
    __autoAcceptState: null,
    addEventListener: () => { },
    dispatchEvent: () => { }
};
global.document = {
    hidden: false,
    addEventListener: () => { }
};
global.CustomEvent = class CustomEvent {
    constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
    }
};

// Now load the analytics module
const analytics = require('../main_scripts/analytics/index.js');

// ==========================================
// Test Helpers
// ==========================================

function resetState() {
    global.window.__autoAcceptState = null;
}

function mockLog(msg) {
    // Silent for tests, or uncomment for debugging:
    // console.log(`  [LOG] ${msg}`);
}

// ==========================================
// TEST SUITE: Initialization
// ==========================================

function test_initialize_creates_fresh_state() {
    resetState();
    analytics.initialize(mockLog);

    assert.ok(global.window.__autoAcceptState, 'State should be created');
    assert.ok(global.window.__autoAcceptState.stats, 'Stats should be created');
    assert.strictEqual(global.window.__autoAcceptState.stats.clicksThisSession, 0);
    console.log('✅ PASS: initialize creates fresh state');
}

function test_initialize_preserves_existing_state() {
    resetState();
    global.window.__autoAcceptState = {
        isRunning: true,
        someCustomField: 'test',
        stats: {
            clicksThisSession: 5,
            blockedThisSession: 0,
            isWindowFocused: true,
            actionsWhileAway: 0,
            fileEditsThisSession: 0,
            terminalCommandsThisSession: 0
        }
    };
    analytics.initialize(mockLog);

    assert.strictEqual(global.window.__autoAcceptState.isRunning, true, 'Existing fields preserved');
    assert.strictEqual(global.window.__autoAcceptState.someCustomField, 'test', 'Custom fields preserved');
    assert.strictEqual(global.window.__autoAcceptState.stats.clicksThisSession, 5, 'Existing stats preserved');
    console.log('✅ PASS: initialize preserves existing state');
}

function test_initialize_migrates_missing_fields() {
    resetState();
    global.window.__autoAcceptState = {
        stats: { clicksThisSession: 5, blockedThisSession: 0, isWindowFocused: true }
        // Missing: actionsWhileAway, fileEdits, terminalCommands
    };
    analytics.initialize(mockLog);

    assert.strictEqual(global.window.__autoAcceptState.stats.actionsWhileAway, 0, 'actionsWhileAway added');
    assert.strictEqual(global.window.__autoAcceptState.stats.fileEditsThisSession, 0, 'fileEditsThisSession added');
    assert.strictEqual(global.window.__autoAcceptState.stats.clicksThisSession, 5, 'Existing value preserved');
    console.log('✅ PASS: initialize migrates missing fields');
}

// ==========================================
// TEST SUITE: Click Tracking
// ==========================================

function test_trackClick_increments_total() {
    resetState();
    analytics.initialize(mockLog);

    analytics.trackClick('Accept', mockLog);
    analytics.trackClick('Run', mockLog);

    const stats = analytics.Analytics.getStats();
    assert.strictEqual(stats.clicksThisSession, 2, 'Total clicks should be 2');
    console.log('✅ PASS: trackClick increments total');
}

function test_trackClick_categorizes_terminal_commands() {
    resetState();
    analytics.initialize(mockLog);

    analytics.trackClick('Run', mockLog);
    analytics.trackClick('Execute command', mockLog);
    analytics.trackClick('Run in terminal', mockLog);

    const stats = analytics.Analytics.getStats();
    assert.strictEqual(stats.terminalCommandsThisSession, 3, 'Terminal commands should be 3');
    assert.strictEqual(stats.fileEditsThisSession, 0, 'File edits should be 0');
    console.log('✅ PASS: trackClick categorizes terminal commands');
}

function test_trackClick_categorizes_file_edits() {
    resetState();
    analytics.initialize(mockLog);

    analytics.trackClick('Accept', mockLog);
    analytics.trackClick('Accept All', mockLog);
    analytics.trackClick('Apply', mockLog);

    const stats = analytics.Analytics.getStats();
    assert.strictEqual(stats.fileEditsThisSession, 3, 'File edits should be 3');
    assert.strictEqual(stats.terminalCommandsThisSession, 0, 'Terminal commands should be 0');
    console.log('✅ PASS: trackClick categorizes file edits');
}

function test_trackClick_tracks_away_actions() {
    resetState();
    analytics.initialize(mockLog);

    // Simulate user leaving
    global.window.__autoAcceptState.stats.isWindowFocused = false;

    analytics.trackClick('Run', mockLog);
    analytics.trackClick('Accept', mockLog);

    const stats = analytics.Analytics.getStats();
    assert.strictEqual(stats.actionsWhileAway, 2, 'Away actions should be 2');
    console.log('✅ PASS: trackClick tracks away actions');
}

function test_trackClick_no_away_when_focused() {
    resetState();
    analytics.initialize(mockLog);

    // Window is focused (default)
    analytics.trackClick('Run', mockLog);
    analytics.trackClick('Accept', mockLog);

    const stats = analytics.Analytics.getStats();
    assert.strictEqual(stats.actionsWhileAway, 0, 'Away actions should be 0 when focused');
    console.log('✅ PASS: trackClick does not track away when focused');
}

// ==========================================
// TEST SUITE: Blocked Tracking
// ==========================================

function test_trackBlocked_increments_counter() {
    resetState();
    analytics.initialize(mockLog);

    analytics.trackBlocked(mockLog);
    analytics.trackBlocked(mockLog);
    analytics.trackBlocked(mockLog);

    const stats = analytics.Analytics.getStats();
    assert.strictEqual(stats.blockedThisSession, 3, 'Blocked should be 3');
    console.log('✅ PASS: trackBlocked increments counter');
}

// ==========================================
// TEST SUITE: ROI Collection
// ==========================================

function test_collectROI_returns_stats() {
    resetState();
    analytics.initialize(mockLog);

    analytics.trackClick('Run', mockLog);
    analytics.trackClick('Accept', mockLog);
    analytics.trackBlocked(mockLog);

    const collected = analytics.collectROI(mockLog);

    assert.strictEqual(collected.clicks, 2, 'Collected clicks should be 2');
    assert.strictEqual(collected.blocked, 1, 'Collected blocked should be 1');
    console.log('✅ PASS: collectROI returns stats');
}

function test_collectROI_resets_core_stats() {
    resetState();
    analytics.initialize(mockLog);

    analytics.trackClick('Run', mockLog);
    analytics.trackBlocked(mockLog);

    analytics.collectROI(mockLog);

    const stats = analytics.Analytics.getStats();
    assert.strictEqual(stats.clicksThisSession, 0, 'Clicks should be reset to 0');
    assert.strictEqual(stats.blockedThisSession, 0, 'Blocked should be reset to 0');
    console.log('✅ PASS: collectROI resets core stats');
}

function test_collectROI_preserves_ux_counters() {
    resetState();
    analytics.initialize(mockLog);

    // Simulate activity while away
    global.window.__autoAcceptState.stats.isWindowFocused = false;
    analytics.trackClick('Run', mockLog);
    analytics.trackClick('Accept', mockLog);

    // Collect ROI (should NOT reset away actions)
    analytics.collectROI(mockLog);

    const stats = analytics.Analytics.getStats();
    assert.strictEqual(stats.actionsWhileAway, 2, 'Away actions should NOT be reset');
    assert.strictEqual(stats.terminalCommandsThisSession, 1, 'Terminal commands should NOT be reset');
    assert.strictEqual(stats.fileEditsThisSession, 1, 'File edits should NOT be reset');
    console.log('✅ PASS: collectROI preserves UX counters');
}

// ==========================================
// TEST SUITE: Session Summary
// ==========================================

function test_getSessionSummary_returns_breakdown() {
    resetState();
    analytics.initialize(mockLog);

    analytics.trackClick('Run', mockLog);
    analytics.trackClick('Run', mockLog);
    analytics.trackClick('Accept', mockLog);
    analytics.trackBlocked(mockLog);

    const summary = analytics.getSessionSummary();

    assert.strictEqual(summary.clicks, 3, 'Summary clicks should be 3');
    assert.strictEqual(summary.terminalCommands, 2, 'Summary terminal commands should be 2');
    assert.strictEqual(summary.fileEdits, 1, 'Summary file edits should be 1');
    assert.strictEqual(summary.blocked, 1, 'Summary blocked should be 1');
    console.log('✅ PASS: getSessionSummary returns breakdown');
}

function test_getSessionSummary_time_estimate() {
    resetState();
    analytics.initialize(mockLog);

    // Add 24 clicks (24 * 5 = 120 seconds = 2 minutes base)
    for (let i = 0; i < 24; i++) {
        analytics.trackClick('Accept', mockLog);
    }

    const summary = analytics.getSessionSummary();

    assert.ok(summary.estimatedTimeSaved !== null, 'Time estimate should not be null');
    assert.ok(summary.estimatedTimeSaved.includes('–'), 'Time estimate should be a range');
    console.log('✅ PASS: getSessionSummary includes time estimate');
}

function test_getSessionSummary_null_time_when_no_clicks() {
    resetState();
    analytics.initialize(mockLog);

    const summary = analytics.getSessionSummary();

    assert.strictEqual(summary.estimatedTimeSaved, null, 'Time estimate should be null when no clicks');
    console.log('✅ PASS: getSessionSummary time is null when no clicks');
}

// ==========================================
// TEST SUITE: Away Actions
// ==========================================

function test_consumeAwayActions_returns_and_resets() {
    resetState();
    analytics.initialize(mockLog);

    global.window.__autoAcceptState.stats.isWindowFocused = false;
    analytics.trackClick('Run', mockLog);
    analytics.trackClick('Run', mockLog);
    analytics.trackClick('Run', mockLog);

    const count = analytics.consumeAwayActions(mockLog);

    assert.strictEqual(count, 3, 'Should return 3 away actions');
    assert.strictEqual(global.window.__autoAcceptState.stats.actionsWhileAway, 0, 'Should reset to 0');
    console.log('✅ PASS: consumeAwayActions returns and resets');
}

function test_consumeAwayActions_idempotent() {
    resetState();
    analytics.initialize(mockLog);

    global.window.__autoAcceptState.stats.actionsWhileAway = 5;

    const first = analytics.consumeAwayActions(mockLog);
    const second = analytics.consumeAwayActions(mockLog);

    assert.strictEqual(first, 5, 'First call should return 5');
    assert.strictEqual(second, 0, 'Second call should return 0');
    console.log('✅ PASS: consumeAwayActions is idempotent');
}

function test_isUserAway_returns_correct_state() {
    resetState();
    analytics.initialize(mockLog);

    assert.strictEqual(analytics.Analytics.isUserAway(), false, 'Should be focused by default');

    global.window.__autoAcceptState.stats.isWindowFocused = false;
    assert.strictEqual(analytics.Analytics.isUserAway(), true, 'Should be away when unfocused');

    global.window.__autoAcceptState.stats.isWindowFocused = true;
    assert.strictEqual(analytics.Analytics.isUserAway(), false, 'Should be focused after refocus');

    console.log('✅ PASS: isUserAway returns correct state');
}

// ==========================================
// TEST SUITE: Action Categorization
// ==========================================

function test_categorizeClick_terminal_keywords() {
    const { categorizeClick, ActionType } = analytics.Analytics;

    assert.strictEqual(categorizeClick('Run'), ActionType.TERMINAL_COMMAND);
    assert.strictEqual(categorizeClick('run'), ActionType.TERMINAL_COMMAND);
    assert.strictEqual(categorizeClick('RUN COMMAND'), ActionType.TERMINAL_COMMAND);
    assert.strictEqual(categorizeClick('Execute'), ActionType.TERMINAL_COMMAND);
    assert.strictEqual(categorizeClick('Run in terminal'), ActionType.TERMINAL_COMMAND);

    console.log('✅ PASS: categorizeClick identifies terminal keywords');
}

function test_categorizeClick_file_edit_default() {
    const { categorizeClick, ActionType } = analytics.Analytics;

    assert.strictEqual(categorizeClick('Accept'), ActionType.FILE_EDIT);
    assert.strictEqual(categorizeClick('Accept All'), ActionType.FILE_EDIT);
    assert.strictEqual(categorizeClick('Apply'), ActionType.FILE_EDIT);
    assert.strictEqual(categorizeClick('Confirm'), ActionType.FILE_EDIT);
    assert.strictEqual(categorizeClick(''), ActionType.FILE_EDIT);

    console.log('✅ PASS: categorizeClick defaults to file edit');
}

// ==========================================
// RUN ALL TESTS
// ==========================================

function runAllTests() {
    console.log('\n========================================');
    console.log('  ANALYTICS MODULE TESTS');
    console.log('========================================\n');

    let passed = 0;
    let failed = 0;

    const tests = [
        // Initialization
        test_initialize_creates_fresh_state,
        test_initialize_preserves_existing_state,
        test_initialize_migrates_missing_fields,

        // Click Tracking
        test_trackClick_increments_total,
        test_trackClick_categorizes_terminal_commands,
        test_trackClick_categorizes_file_edits,
        test_trackClick_tracks_away_actions,
        test_trackClick_no_away_when_focused,

        // Blocked Tracking
        test_trackBlocked_increments_counter,

        // ROI Collection
        test_collectROI_returns_stats,
        test_collectROI_resets_core_stats,
        test_collectROI_preserves_ux_counters,

        // Session Summary
        test_getSessionSummary_returns_breakdown,
        test_getSessionSummary_time_estimate,
        test_getSessionSummary_null_time_when_no_clicks,

        // Away Actions
        test_consumeAwayActions_returns_and_resets,
        test_consumeAwayActions_idempotent,
        test_isUserAway_returns_correct_state,

        // Categorization
        test_categorizeClick_terminal_keywords,
        test_categorizeClick_file_edit_default
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
