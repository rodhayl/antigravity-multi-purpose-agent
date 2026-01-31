// instantiate gloabl state tracker with default fallback
window.__autoAcceptState = window.__autoAcceptState || {
    isRunning: false,
    tabNames: [],
    sessionID: 0,
    currentMode: null
};

// define global functions

window.__autoAcceptStart = function (config) {
    const newMode = 'simple';
    if (window.__autoAcceptState.isRunning && window.__autoAcceptState.currentMode === newMode) {
        return; // Already running in the correct mode
    }

    // Stop existing if any
    if (window.__autoAcceptState.isRunning) {
        window.__autoAcceptStop();
    }

    window.__autoAcceptState.isRunning = true;
    window.__autoAcceptState.currentMode = newMode;
    window.__autoAcceptState.sessionID++;

    startSimpleCycle(config);
};

window.__autoAcceptStop = function () {
    window.__autoAcceptState.isRunning = false;
    // Reset the global state fields
    window.__autoAcceptState.currentMode = null;
    window.__autoAcceptState.tabNames = [];
    window.__autoAcceptState.sessionID = 0;
};

function startSimpleCycle(config) {
    const buttons = ['accept', 'retry'];
    const sid = window.__autoAcceptState.sessionID;
    function step() {
        if (!window.__autoAcceptState.isRunning || window.__autoAcceptState.sessionID !== sid) {
            return;
        }
        autoAccept(buttons);
        setTimeout(step, config.pollInterval || 1000);
    }
    step();
}
