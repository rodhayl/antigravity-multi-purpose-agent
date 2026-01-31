/**
 * FULL CDP CORE BUNDLE
 * Monolithic script for browser-side injection.
 * Combines utils, analytics, auto-accept, and lifecycle management.
 */
(function () {
    "use strict";

    // Guard: Bail out immediately if not in a browser context (e.g., service worker)
    if (typeof window === 'undefined') return;

    // ============================================================
    // ANALYTICS MODULE (Embedded)
    // Clean, modular analytics with separated concerns.
    // See: main_scripts/analytics/ for standalone module files
    // ============================================================
    const Analytics = (function () {
        // --- Constants ---
        const TERMINAL_KEYWORDS = ['run', 'execute', 'command', 'terminal'];
        const SECONDS_PER_CLICK = 5;
        const TIME_VARIANCE = 0.2;

        const ActionType = {
            FILE_EDIT: 'file_edit',
            TERMINAL_COMMAND: 'terminal_command'
        };

        // --- State Management ---
        function createDefaultStats() {
            return {
                clicksThisSession: 0,
                blockedThisSession: 0,
                sessionStartTime: null,
                fileEditsThisSession: 0,
                terminalCommandsThisSession: 0,
                actionsWhileAway: 0,
                isWindowFocused: true,
                lastConversationUrl: null,
                lastConversationStats: null
            };
        }

        function getStats() {
            return window.__autoAcceptState?.stats || createDefaultStats();
        }

        function getStatsMutable() {
            return window.__autoAcceptState.stats;
        }

        // --- Click Tracking ---
        function categorizeClick(buttonText) {
            const text = (buttonText || '').toLowerCase();
            for (const keyword of TERMINAL_KEYWORDS) {
                if (text.includes(keyword)) return ActionType.TERMINAL_COMMAND;
            }
            return ActionType.FILE_EDIT;
        }

        function trackClick(buttonText, log) {
            const stats = getStatsMutable();
            stats.clicksThisSession++;
            log(`[Stats] Click tracked. Total: ${stats.clicksThisSession}`);

            const category = categorizeClick(buttonText);
            if (category === ActionType.TERMINAL_COMMAND) {
                stats.terminalCommandsThisSession++;
                log(`[Stats] Terminal command. Total: ${stats.terminalCommandsThisSession}`);
            } else {
                stats.fileEditsThisSession++;
                log(`[Stats] File edit. Total: ${stats.fileEditsThisSession}`);
            }

            let isAway = false;
            if (!stats.isWindowFocused) {
                stats.actionsWhileAway++;
                isAway = true;
                log(`[Stats] Away action. Total away: ${stats.actionsWhileAway}`);
            }

            return { category, isAway, totalClicks: stats.clicksThisSession };
        }

        function trackBlocked(log) {
            const stats = getStatsMutable();
            stats.blockedThisSession++;
            log(`[Stats] Blocked. Total: ${stats.blockedThisSession}`);
        }

        // --- ROI Reporting ---
        function collectROI(log) {
            const stats = getStatsMutable();
            const collected = {
                clicks: stats.clicksThisSession || 0,
                blocked: stats.blockedThisSession || 0,
                sessionStart: stats.sessionStartTime
            };
            log(`[ROI] Collected: ${collected.clicks} clicks, ${collected.blocked} blocked`);
            stats.clicksThisSession = 0;
            stats.blockedThisSession = 0;
            stats.sessionStartTime = Date.now();
            return collected;
        }

        // --- Session Summary ---
        function getSessionSummary() {
            const stats = getStats();
            const clicks = stats.clicksThisSession || 0;
            const baseSecs = clicks * SECONDS_PER_CLICK;
            const minMins = Math.max(1, Math.floor((baseSecs * (1 - TIME_VARIANCE)) / 60));
            const maxMins = Math.ceil((baseSecs * (1 + TIME_VARIANCE)) / 60);

            return {
                clicks,
                fileEdits: stats.fileEditsThisSession || 0,
                terminalCommands: stats.terminalCommandsThisSession || 0,
                blocked: stats.blockedThisSession || 0,
                estimatedTimeSaved: clicks > 0 ? `${minMins}–${maxMins} minutes` : null
            };
        }

        // --- Away Actions ---
        function consumeAwayActions(log) {
            const stats = getStatsMutable();
            const count = stats.actionsWhileAway || 0;
            log(`[Away] Consuming away actions: ${count}`);
            stats.actionsWhileAway = 0;
            return count;
        }

        function isUserAway() {
            return !getStats().isWindowFocused;
        }

        // --- Focus Management ---
        // NOTE: Browser-side focus events are UNRELIABLE in webview contexts.
        // The VS Code extension pushes the authoritative focus state via __autoAcceptSetFocusState.
        // We only keep a minimal initializer here that defaults to focused=true.

        function initializeFocusState(log) {
            const state = window.__autoAcceptState;
            if (state && state.stats) {
                // Default to focused (assume user is present) - extension will correct this
                state.stats.isWindowFocused = true;
                log('[Focus] Initialized (awaiting extension sync)');
            }
        }

        // --- Initialization ---
        function initialize(log) {
            if (!window.__autoAcceptState) {
                window.__autoAcceptState = {
                    isRunning: false,
                    tabNames: [],
                    sessionID: 0,
                    currentMode: null,
                    bannedCommands: [],
                    stats: createDefaultStats()
                };
                log('[Analytics] State initialized');
            } else if (!window.__autoAcceptState.stats) {
                window.__autoAcceptState.stats = createDefaultStats();
                log('[Analytics] Stats added to existing state');
            } else {
                const s = window.__autoAcceptState.stats;
                if (s.actionsWhileAway === undefined) s.actionsWhileAway = 0;
                if (s.isWindowFocused === undefined) s.isWindowFocused = true;
                if (s.fileEditsThisSession === undefined) s.fileEditsThisSession = 0;
                if (s.terminalCommandsThisSession === undefined) s.terminalCommandsThisSession = 0;
            }

            initializeFocusState(log);

            if (!window.__autoAcceptState.stats.sessionStartTime) {
                window.__autoAcceptState.stats.sessionStartTime = Date.now();
            }

            log('[Analytics] Initialized');
        }

        // Set focus state (called from extension via CDP)
        function setFocusState(isFocused, log) {
            const state = window.__autoAcceptState;
            if (!state || !state.stats) return;

            const wasAway = !state.stats.isWindowFocused;
            state.stats.isWindowFocused = isFocused;

            if (log) {
                log(`[Focus] Extension sync: focused=${isFocused}, wasAway=${wasAway}`);
            }
        }

        // Public API
        return {
            initialize,
            trackClick,
            trackBlocked,
            categorizeClick,
            ActionType,
            collectROI,
            getSessionSummary,
            consumeAwayActions,
            isUserAway,
            getStats,
            setFocusState
        };
    })();

    // --- LOGGING ---
    const log = (msg, isSuccess = false) => {
        // Simple log for CDP interception
        console.log(`[AutoAccept] ${msg}`);
    };

    // Initialize Analytics
    Analytics.initialize(log);

    // --- 1. UTILS ---
    const getDocuments = (root = document) => {
        let docs = [root];
        try {
            const iframes = root.querySelectorAll('iframe, frame');
            for (const iframe of iframes) {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (iframeDoc) docs.push(...getDocuments(iframeDoc));
                } catch (e) { }
            }
        } catch (e) { }
        return docs;
    };

    const queryAll = (selector) => {
        const results = [];
        getDocuments().forEach(doc => {
            try { results.push(...Array.from(doc.querySelectorAll(selector))); } catch (e) { }
        });
        return results;
    };

    // Helper to strip time suffixes like "3m", "4h", "12s"
    const stripTimeSuffix = (text) => {
        return (text || '').trim().replace(/\s*\d+[smh]$/, '').trim();
    };

    // Helper to deduplicate tab names by appending (2), (3), etc.
    const deduplicateNames = (names) => {
        const counts = {};
        return names.map(name => {
            if (counts[name] === undefined) {
                counts[name] = 1;
                return name;
            } else {
                counts[name]++;
                return `${name} (${counts[name]})`;
            }
        });
    };

    const updateTabNames = (tabs) => {
        const rawNames = Array.from(tabs).map(tab => stripTimeSuffix(tab.textContent));
        const tabNames = deduplicateNames(rawNames);

        if (JSON.stringify(window.__autoAcceptState.tabNames) !== JSON.stringify(tabNames)) {
            log(`updateTabNames: Detected ${tabNames.length} tabs: ${tabNames.join(', ')}`);
            window.__autoAcceptState.tabNames = tabNames;
        }
    };

    // --- 2. BANNED COMMAND DETECTION ---
    /**
     * Traverses the parent containers and their siblings to find the command text being executed.
     * Based on Antigravity DOM structure: the command is in a PRE/CODE block that's a sibling
     * of the button's parent/grandparent container.
     * 
     * DOM Structure (Antigravity):
     *   <div> (grandparent: flex w-full...)
     *     <p>Run command?</p>
     *     <div> (parent: ml-auto flex...)
     *       <button>Reject</button>
     *       <button>Accept</button>  <-- we start here
     *     </div>
     *   </div>
     *   
     * The command text is in a PRE block that's a previous sibling of the grandparent.
     */
    function findNearbyCommandText(el) {
        const commandSelectors = ['pre', 'code', 'pre code'];
        let commandText = '';

        // Strategy 1: Walk up to find parent containers, then search their previous siblings
        // This matches the actual Antigravity DOM where PRE blocks are siblings of the button's ancestor
        let container = el.parentElement;
        let depth = 0;
        const maxDepth = 10; // Walk up to 10 levels

        while (container && depth < maxDepth) {
            // Search previous siblings of this container for PRE/CODE blocks
            let sibling = container.previousElementSibling;
            let siblingCount = 0;

            while (sibling && siblingCount < 5) {
                // Check if sibling itself is a PRE/CODE
                if (sibling.tagName === 'PRE' || sibling.tagName === 'CODE') {
                    const text = sibling.textContent.trim();
                    if (text.length > 0) {
                        commandText += ' ' + text;
                        log(`[BannedCmd] Found <${sibling.tagName}> sibling at depth ${depth}: "${text.substring(0, 100)}..."`);
                    }
                }

                // Check children of sibling for PRE/CODE
                for (const selector of commandSelectors) {
                    const codeElements = sibling.querySelectorAll(selector);
                    for (const codeEl of codeElements) {
                        if (codeEl && codeEl.textContent) {
                            const text = codeEl.textContent.trim();
                            if (text.length > 0 && text.length < 5000) {
                                commandText += ' ' + text;
                                log(`[BannedCmd] Found <${selector}> in sibling at depth ${depth}: "${text.substring(0, 100)}..."`);
                            }
                        }
                    }
                }

                sibling = sibling.previousElementSibling;
                siblingCount++;
            }

            // If we found command text, we're done
            if (commandText.length > 10) {
                break;
            }

            container = container.parentElement;
            depth++;
        }

        // Strategy 2: Fallback - check immediate button siblings
        if (commandText.length === 0) {
            let btnSibling = el.previousElementSibling;
            let count = 0;
            while (btnSibling && count < 3) {
                for (const selector of commandSelectors) {
                    const codeElements = btnSibling.querySelectorAll ? btnSibling.querySelectorAll(selector) : [];
                    for (const codeEl of codeElements) {
                        if (codeEl && codeEl.textContent) {
                            commandText += ' ' + codeEl.textContent.trim();
                        }
                    }
                }
                btnSibling = btnSibling.previousElementSibling;
                count++;
            }
        }

        // Strategy 3: Check aria-label and title attributes
        if (el.getAttribute('aria-label')) {
            commandText += ' ' + el.getAttribute('aria-label');
        }
        if (el.getAttribute('title')) {
            commandText += ' ' + el.getAttribute('title');
        }

        const result = commandText.trim().toLowerCase();
        if (result.length > 0) {
            log(`[BannedCmd] Extracted command text (${result.length} chars): "${result.substring(0, 150)}..."`);
        }
        return result;
    }

    /**
     * Check if a command is banned based on user-defined patterns.
     * Supports both literal substring matching and regex patterns.
     * 
     * Pattern format (line by line in settings):
     *   - Plain text: matches as literal substring (case-insensitive)
     *   - /pattern/: treated as regex (e.g., /rm\s+-rf/ matches "rm -rf")
     * 
     * @param {string} commandText - The extracted command text to check
     * @returns {boolean} True if command matches any banned pattern
     */
    function isCommandBanned(commandText, element) {
        // If we already logged this element as blocked, return true to skip clicking,
        // but DO NOT track stats again to prevent infinite loop.
        if (element && element.dataset.autoAcceptBlocked) {
            return true;
        }

        const state = window.__autoAcceptState;
        const bannedList = state.bannedCommands || [];

        if (bannedList.length === 0) return false;
        if (!commandText || commandText.length === 0) return false;

        const lowerText = commandText.toLowerCase();

        for (const banned of bannedList) {
            const pattern = banned.trim();
            if (!pattern || pattern.length === 0) continue;

            try {
                // Check if pattern is a regex (starts and ends with /)
                let isMatch = false;
                if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
                    const lastSlash = pattern.lastIndexOf('/');
                    const regexPattern = pattern.substring(1, lastSlash);
                    const flags = pattern.substring(lastSlash + 1) || 'i';
                    const regex = new RegExp(regexPattern, flags);
                    if (regex.test(commandText)) {
                        log(`[BANNED] Command blocked by regex: /${regexPattern}/${flags}`);
                        isMatch = true;
                    }
                } else {
                    const lowerPattern = pattern.toLowerCase();
                    if (lowerText.includes(lowerPattern)) {
                        log(`[BANNED] Command blocked by pattern: "${pattern}"`);
                        isMatch = true;
                    }
                }

                if (isMatch) {
                    Analytics.trackBlocked(log);
                    // Mark element so we don't count it again
                    if (element) {
                        element.dataset.autoAcceptBlocked = 'true';
                    }
                    return true;
                }
            } catch (e) {
                // Fallback
                if (lowerText.includes(pattern.toLowerCase())) {
                    log(`[BANNED] Command blocked by pattern (fallback): "${pattern}"`);
                    Analytics.trackBlocked(log);
                    if (element) element.dataset.autoAcceptBlocked = 'true';
                    return true;
                }
            }
        }
        return false;
    }

    // --- 4. CLICKING LOGIC ---
    function isAcceptButton(el) {
        const text = (el.textContent || "").trim().toLowerCase();
        if (text.length === 0 || text.length > 50) return false;
        const patterns = ['accept', 'run', 'retry', 'apply', 'execute', 'confirm', 'allow once', 'allow'];
        const rejects = ['skip', 'reject', 'cancel', 'close', 'refine'];
        if (rejects.some(r => text.includes(r))) return false;
        if (!patterns.some(p => text.includes(p))) return false;

        // Check if this is a command execution button by looking for "run command" or similar
        const isCommandButton = text.includes('run command') || text.includes('execute') || text.includes('run');

        // If it's a command button, check if the command is banned
        if (isCommandButton) {
            const nearbyText = findNearbyCommandText(el);
            if (isCommandBanned(nearbyText, el)) {
                log(`[BANNED] Skipping button: "${text}" - command is banned`);
                return false;
            }
        }

        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && rect.width > 0 && style.pointerEvents !== 'none' && !el.disabled;
    }

    /**
     * Check if an element is still visible in the DOM.
     * @param {Element} el - Element to check
     * @returns {boolean} True if element is visible
     */
    function isElementVisible(el) {
        if (!el || !el.isConnected) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && rect.width > 0 && style.visibility !== 'hidden';
    }

    /**
     * Wait for an element to disappear (removed from DOM or hidden).
     * @param {Element} el - Element to watch
     * @param {number} timeout - Max time to wait in ms
     * @returns {Promise<boolean>} True if element disappeared
     */
    function waitForDisappear(el, timeout = 500) {
        return new Promise(resolve => {
            const startTime = Date.now();
            const check = () => {
                if (!isElementVisible(el)) {
                    resolve(true);
                } else if (Date.now() - startTime >= timeout) {
                    resolve(false);
                } else {
                    requestAnimationFrame(check);
                }
            };
            // Give a small initial delay for the click to register
            setTimeout(check, 50);
        });
    }

    async function performClick(selectors) {
        const found = [];
        selectors.forEach(s => queryAll(s).forEach(el => found.push(el)));
        let clicked = 0;
        let verified = 0;
        const uniqueFound = [...new Set(found)];

        for (const el of uniqueFound) {
            // Check if element is still valid (might have been removed by previous click in this loop)
            if (!el.isConnected) continue;

            if (isAcceptButton(el)) {
                const buttonText = (el.textContent || "").trim();
                log(`Clicking: "${buttonText}"`);

                // Dispatch click
                el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                clicked++;

                // Wait for button to disappear (verification)
                const disappeared = await waitForDisappear(el);

                if (disappeared) {
                    // Only count if button actually disappeared (action was successful)
                    Analytics.trackClick(buttonText, log);
                    verified++;
                    log(`[Stats] Click verified (button disappeared)`);
                } else {
                    log(`[Stats] Click not verified (button still visible after 500ms)`);
                }
            }
        }

        if (clicked > 0) {
            log(`[Click] Attempted: ${clicked}, Verified: ${verified}`);
        }
        return verified;
    }

    // --- 4. LIFECYCLE API ---
    // --- Update banned commands list ---
    window.__autoAcceptUpdateBannedCommands = function (bannedList) {
        const state = window.__autoAcceptState;
        state.bannedCommands = Array.isArray(bannedList) ? bannedList : [];
        log(`[Config] Updated banned commands list: ${state.bannedCommands.length} patterns`);
        if (state.bannedCommands.length > 0) {
            log(`[Config] Banned patterns: ${state.bannedCommands.join(', ')}`);
        }
    };

    // --- Get current stats for ROI notification ---
    window.__autoAcceptGetStats = function () {
        const stats = Analytics.getStats();
        return {
            clicks: stats.clicksThisSession || 0,
            blocked: stats.blockedThisSession || 0,
            sessionStart: stats.sessionStartTime,
            fileEdits: stats.fileEditsThisSession || 0,
            terminalCommands: stats.terminalCommandsThisSession || 0,
            actionsWhileAway: stats.actionsWhileAway || 0
        };
    };

    // --- Reset stats (called when extension wants to collect and reset) ---
    window.__autoAcceptResetStats = function () {
        return Analytics.collectROI(log);
    };

    // --- Get session summary for notifications ---
    window.__autoAcceptGetSessionSummary = function () {
        return Analytics.getSessionSummary();
    };

    // --- Get and reset away actions count ---
    window.__autoAcceptGetAwayActions = function () {
        return Analytics.consumeAwayActions(log);
    };

    // --- Set focus state (called from extension - authoritative source) ---
    window.__autoAcceptSetFocusState = function (isFocused) {
        Analytics.setFocusState(isFocused, log);
    };

    window.__autoAcceptStart = function (config) {
        try {
            const ide = (config.ide || 'antigravity').toLowerCase();

            // Update banned commands from config
            if (config.bannedCommands) {
                window.__autoAcceptUpdateBannedCommands(config.bannedCommands);
            }

            log(`__autoAcceptStart called: ide=${ide}`);

            const state = window.__autoAcceptState;

            // Skip restart only if EXACTLY the same config
            if (state.isRunning && state.currentMode === ide) {
                log(`Already running with same config, skipping`);
                return;
            }

            // Stop previous loop if switching
            if (state.isRunning) {
                log(`Stopping previous session...`);
                state.isRunning = false;
            }

            state.isRunning = true;
            state.currentMode = ide;
            state.sessionID++;
            const sid = state.sessionID;

            // Reset transient per-session state
            state.tabNames = [];

            // Initialize session start time if not set (for stats tracking)
            if (!state.stats.sessionStartTime) {
                state.stats.sessionStartTime = Date.now();
            }

            log(`Agent Loaded (IDE: ${ide})`, true);

            log(`Starting poll loop...`);
            (async function pollLoop() {
                while (state.isRunning && state.sessionID === sid) {
                    await performClick(['button', '[class*="button"]', '[class*="anysphere"]']);
                    await new Promise(r => setTimeout(r, config.pollInterval || 1000));
                }
            })();
        } catch (e) {
            log(`ERROR in __autoAcceptStart: ${e.message}`);
            console.error('[AutoAccept] Start error:', e);
        }
    };

    window.__autoAcceptStop = function () {
        const state = window.__autoAcceptState;
        if (state) {
            state.isRunning = false;
            state.currentMode = null;
            state.tabNames = [];
        }
        log("Agent Stopped.");
    };

    // Active conversation helper (used by the queue to target "Current (Active Tab)")
    window.__autoAcceptGetActiveTabName = function () {
        try {
            const tabs = queryAll('button.grow').filter(t => isElementVisible(t));
            if (!tabs || tabs.length === 0) return '';

            const active = tabs.find(t => t.getAttribute('aria-selected') === 'true')
                || tabs.find(t => t.getAttribute('aria-current') === 'true')
                || tabs.find(t => t.getAttribute('data-state') === 'active')
                || tabs.find(t => ((t.className || '').toLowerCase()).includes('active'))
                || tabs[0];

            const name = stripTimeSuffix(active?.textContent || '');
            return (name || '').trim();
        } catch (e) {
            return '';
        }
    };

    // --- Prompt Sending (CDP) ---

    function getInputValue(el) {
        try {
            if (!el) return '';
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
            return (el.innerText || el.textContent || '').trim();
        } catch (e) {
            return '';
        }
    }

    function getInputHint(el) {
        try {
            if (!el) return '';
            const attrs = [
                el.getAttribute('placeholder'),
                el.getAttribute('aria-label'),
                el.getAttribute('data-placeholder'),
                el.getAttribute('title')
            ].filter(Boolean);
            return attrs.join(' ').trim();
        } catch (e) {
            return '';
        }
    }

    function isProbablyIMEOverlay(className) {
        // Only exclude actual "ime" tokens to avoid false positives like "time"/"timestamp".
        const c = (className || '').toLowerCase();
        return /\bime\b/.test(c) || c.includes('ime-text-area');
    }

    function getAntigravityAgentPanelRoot() {
        try {
            // Use queryAll (iframe-aware) because the agent panel can live inside nested frames.
            const panels = queryAll('#antigravity\\.agentPanel');
            if (panels && panels.length > 0) {
                const visible = panels.find(p => {
                    try {
                        const rect = p.getBoundingClientRect();
                        return rect.width > 50 && rect.height > 50;
                    } catch (e) { return false; }
                });
                return visible || panels[0];
            }
            return document.getElementById('antigravity.agentPanel') || document.querySelector('#antigravity\\.agentPanel');
        } catch (e) {
            try { return document.getElementById('antigravity.agentPanel'); } catch (e2) { }
        }
        return null;
    }

    function queryAllWithin(root, selector) {
        try {
            const results = [];
            getDocuments(root).forEach(doc => {
                try { results.push(...Array.from(doc.querySelectorAll(selector))); } catch (e) { }
            });
            return results;
        } catch (e) {
            try { return Array.from((root || document).querySelectorAll(selector)); } catch (e2) { }
        }
        return [];
    }

    function findAntigravityChatInputContentEditable(root = document) {
        try {
            // Follow docs/SEND_MESSAGE_ANTIGRAVITY_TO_AGENT_CHAT.md:
            // prioritize a large contenteditable div with classes like cursor-text/overflow-y-auto,
            // and exclude IME overlay traps.
            const editables = queryAllWithin(root, '[contenteditable]');
            let candidate = null;

            for (const el of editables) {
                const attr = (el.getAttribute && el.getAttribute('contenteditable')) || '';
                if (String(attr).toLowerCase() === 'false') continue;

                const rect = el.getBoundingClientRect();
                const className = el.className || '';
                const c = String(className).toLowerCase();
                const doc = el.ownerDocument || document;
                const win = doc.defaultView || window;

                // Exclude non-visible elements
                try {
                    const style = win.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
                } catch (e) { }

                // Exclude IME overlay + tiny elements
                if (isProbablyIMEOverlay(className)) continue;
                if (rect.width < 100 || rect.height < 20) continue;

                // Prefer Antigravity chat composer pattern
                if (c.includes('cursor-text') || c.includes('overflow')) return el;

                // Fallback: keep first large-enough element
                if (!candidate && rect.width > 200) candidate = el;
            }

            return candidate;
        } catch (e) {
            return null;
        }
    }

    function scorePromptInputCandidate(el) {
        try {
            const rect = el.getBoundingClientRect();
            const visible = isElementVisible(el);
            if (!visible) return -1;
            if (rect.width < 120 || rect.height < 18) return -1;

            const className = el.className || '';
            if (isProbablyIMEOverlay(className)) return -1;

            const hint = (getInputHint(el) + ' ' + className).toLowerCase();
            const bottomDistance = Math.abs(window.innerHeight - rect.bottom);

            let score = 0;
            score += Math.min(rect.width, 1200) / 8;
            score += Math.min(rect.height, 200) / 4;
            score += Math.max(0, 400 - bottomDistance) / 4;

            if (el.contentEditable === 'true') score += 8;
            if (hint.includes('ask anything')) score += 80;
            if (hint.includes('ask') || hint.includes('message') || hint.includes('prompt') || hint.includes('chat')) score += 35;
            if (hint.includes('cursor') || hint.includes('composer')) score += 20;

            // Prefer inputs inside likely chat containers
            try {
                if (el.closest) {
                    if (el.closest('#antigravity\\.agentPanel')) score += 25;
                    if (el.closest('[class*="chat" i]')) score += 12;
                    if (el.closest('[data-testid*="chat" i]')) score += 12;
                }
            } catch (e) { }

            return score;
        } catch (e) {
            return -1;
        }
    }

    function findBestPromptInput() {
        const candidates = [];

        // Include role="textbox" to catch some custom editors.
        const selector = 'textarea, input[type="text"], [contenteditable="true"], [role="textbox"], .ProseMirror';
        const els = queryAll(selector);
        for (const el of els) {
            const score = scorePromptInputCandidate(el);
            if (score >= 0) {
                candidates.push({ el, score });
            }
        }

        candidates.sort((a, b) => b.score - a.score);
        return candidates.length > 0 ? candidates[0].el : null;
    }

    function isClickable(el) {
        try {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) return false;
            const win = el.ownerDocument?.defaultView || window;
            const style = win.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            if ('disabled' in el && el.disabled) return false;
            return true;
        } catch (e) {
            return false;
        }
    }

    function findSendButtonNearInput(inputBox) {
        const doc = inputBox?.ownerDocument || document;
        const roots = [];
        try {
            const form = inputBox?.closest ? inputBox.closest('form') : null;
            if (form) roots.push(form);
        } catch (e) { }

        try {
            if (inputBox?.parentElement) roots.push(inputBox.parentElement);
        } catch (e) { }

        roots.push(doc);

        const selectors = [
            'button[type="submit"]',
            'button[aria-label*="Send" i]',
            'button[title*="Send" i]',
            'button[data-testid*="send" i]',
            'button[data-testid*="submit" i]',
            '[role="button"][aria-label*="Send" i]',
            '[role="button"][title*="Send" i]'
        ];

        for (const root of roots) {
            for (const sel of selectors) {
                const btn = root.querySelector(sel);
                if (isClickable(btn)) return btn;
            }

            const candidates = root.querySelectorAll('button,[role="button"]');
            for (const btn of candidates) {
                const label = ((btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('title') || '') + ' ' + (btn.textContent || '')).trim().toLowerCase();
                if (!label) continue;
                if (label === 'send' || label.includes(' send') || label.includes('send ') || label.includes('send') || label.includes('submit')) {
                    if (isClickable(btn)) return btn;
                }
            }
        }

        // Heuristic fallback: find a clickable element adjacent to the input (icon-only "send" buttons often lack labels).
        try {
            const inputRect = inputBox.getBoundingClientRect();
            const searchRoot = roots[0] && roots[0] !== document ? roots[0] : (inputBox.parentElement || document);
            const near = searchRoot.querySelectorAll('button,[role="button"],div[tabindex],span[tabindex]');
            let best = null;
            let bestScore = -Infinity;

            for (const el of near) {
                if (!isClickable(el)) continue;
                if (el === inputBox) continue;
                if (el.contains && el.contains(inputBox)) continue;

                const r = el.getBoundingClientRect();
                const dx = r.left - inputRect.right;
                const dy = Math.abs(((r.top + r.bottom) / 2) - ((inputRect.top + inputRect.bottom) / 2));

                // Must be near the right edge of the composer, and roughly aligned vertically.
                if (dx < -20 || dx > 180) continue;
                if (dy > 70) continue;

                const hasSvg = !!el.querySelector('svg');
                let score = 0;
                score += hasSvg ? 30 : 0;
                score += (180 - dx);
                score += (70 - dy);

                // Prefer slightly larger targets (common for icon buttons).
                score += Math.min(60, r.width + r.height);

                if (score > bestScore) {
                    bestScore = score;
                    best = el;
                }
            }

            if (best) return best;
        } catch (e) { }
        return null;
    }

    function setPromptText(inputBox, text) {
        try {
            const doc = inputBox.ownerDocument || document;
            const win = doc.defaultView || window;
            inputBox.focus();

            if (inputBox.tagName === 'TEXTAREA' || inputBox.tagName === 'INPUT') {
                const proto = inputBox.tagName === 'TEXTAREA'
                    ? win.HTMLTextAreaElement.prototype
                    : win.HTMLInputElement.prototype;
                const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (nativeSetter) {
                    nativeSetter.call(inputBox, text);
                } else {
                    inputBox.value = text;
                }
                inputBox.dispatchEvent(new win.Event('input', { bubbles: true }));
                return true;
            }

            if (inputBox.contentEditable === 'true' || inputBox.classList?.contains('ProseMirror') || inputBox.getAttribute?.('role') === 'textbox') {
                try {
                    doc.execCommand('selectAll', false, null);
                    const ok = doc.execCommand('insertText', false, text);
                    if (!ok) {
                        inputBox.innerText = text;
                    }
                } catch (e) {
                    inputBox.innerText = text;
                }
                inputBox.dispatchEvent(new win.Event('input', { bubbles: true }));
                return true;
            }

            inputBox.innerText = text;
            inputBox.dispatchEvent(new win.Event('input', { bubbles: true }));
            return true;
        } catch (e) {
            return false;
        }
    }

    function dispatchKey(inputBox, opts) {
        try {
            const doc = inputBox.ownerDocument || document;
            const win = doc.defaultView || window;
            inputBox.focus();
            const down = new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...opts });
            const press = new win.KeyboardEvent('keypress', { bubbles: true, cancelable: true, ...opts });
            const up = new win.KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...opts });
            inputBox.dispatchEvent(down);
            inputBox.dispatchEvent(press);
            inputBox.dispatchEvent(up);
            return true;
        } catch (e) {
            return false;
        }
    }

    async function verifyPromptSent(inputBox, originalText, timeoutMs = 1200) {
        const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const wanted = normalize(originalText);
        const snippet = wanted.length > 64 ? wanted.slice(0, 64) : wanted;

        const elementContainsInput = (el) => {
            try {
                if (!el || !inputBox) return false;
                if (el === inputBox) return true;
                if (inputBox.contains && inputBox.contains(el)) return true;
                if (el.contains && el.contains(inputBox)) return true;
                return false;
            } catch (e) {
                return false;
            }
        };

        const transcriptHasSnippet = () => {
            try {
                if (!snippet) return false;
                const sn = snippet.toLowerCase();
                const candidates = queryAll('div,span,p,li,pre,code,blockquote');
                for (const el of candidates) {
                    if (!el || !isElementVisible(el)) continue;
                    if (elementContainsInput(el)) continue;
                    const t = normalize(el.textContent || '');
                    if (!t) continue;
                    if (t.toLowerCase().includes(sn)) return true;
                }
                return false;
            } catch (e) {
                return false;
            }
        };

        // Phase 1: wait briefly for the composer to clear (strong signal of a send)
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            await new Promise(r => setTimeout(r, 100));
            const current = getInputValue(inputBox);
            if (!current) return true;
        }

        // Phase 2: if the composer did not clear, only treat as sent if we can find the prompt in the visible transcript.
        // This avoids false positives when Enter inserts a newline instead of sending.
        return transcriptHasSnippet();
    }

    window.__autoAcceptProbePrompt = function () {
        try {
            const panel = getAntigravityAgentPanelRoot();
            const root = panel || document;
            let inputBox = findAntigravityChatInputContentEditable(root);
            if (!inputBox) {
                // Fallback to the broader heuristic selector (textarea/role=textbox/etc.)
                inputBox = findBestPromptInput();
            }
            if (!inputBox) {
                return {
                    hasInput: false,
                    score: 0,
                    hasAgentPanel: !!panel
                };
            }
            const rect = inputBox.getBoundingClientRect();
            const className = String(inputBox.className || '');
            const c = className.toLowerCase();

            let score = 0;
            if (panel) score += 1000;
            score += 200;
            if (c.includes('cursor-text') || c.includes('overflow')) score += 200;
            score += Math.min(rect.width, 1200) / 10;
            score += Math.min(rect.height, 300) / 10;

            const sendBtn = findSendButtonNearInput(inputBox);
            return {
                hasInput: true,
                score,
                hasAgentPanel: !!panel,
                inIframe: (inputBox.ownerDocument && inputBox.ownerDocument !== document),
                tagName: inputBox.tagName,
                hint: getInputHint(inputBox),
                className: className.substring(0, 120),
                rect: { w: Math.round(rect.width), h: Math.round(rect.height), x: Math.round(rect.x), y: Math.round(rect.y) },
                hasSendButton: !!sendBtn
            };
        } catch (e) {
            return { hasInput: false, score: 0, error: e?.message || String(e) };
        }
    };

    window.__autoAcceptSendPrompt = async function (text) {
        try {
            log(`[Prompt] Request to send: "${String(text).substring(0, 50)}..."`);

            // Use the documented winning approach for Antigravity chat.
            const panel = getAntigravityAgentPanelRoot();
            const root = panel || document;
            let inputBox = findAntigravityChatInputContentEditable(root);

            // Fallback if contenteditable isn't present (some builds render a textarea/ProseMirror).
            const isDocFirst = !!inputBox;
            if (!inputBox) inputBox = findBestPromptInput();
            if (!inputBox) {
                log('[Prompt] ERROR: No suitable input found!');
                return false;
            }

            const doc = inputBox.ownerDocument || document;
            const win = doc.defaultView || window;
            const cls = String(inputBox.className || '').substring(0, 80);
            log(`[Prompt] Using input: ${inputBox.tagName}, docFirst=${isDocFirst}, hasAgentPanel=${!!panel}, inIframe=${doc !== document}, class="${cls}"`);

            // Set text (preferred: execCommand on the element's owning document).
            inputBox.focus();
            try {
                if (doc.execCommand) {
                    doc.execCommand('selectAll', false, null);
                    const ok = doc.execCommand('insertText', false, String(text));
                    if (!ok) {
                        inputBox.innerText = String(text);
                    }
                } else {
                    inputBox.innerText = String(text);
                }
            } catch (e) {
                inputBox.innerText = String(text);
            }
            try { inputBox.dispatchEvent(new win.Event('input', { bubbles: true })); } catch (e) { inputBox.dispatchEvent(new Event('input', { bubbles: true })); }

            // 300ms delay is required for React/UI state to update before Enter is handled.
            await new Promise(r => setTimeout(r, 300));

            const dispatchEnter = (opts = {}) => {
                const params = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, ...opts };
                try {
                    inputBox.dispatchEvent(new win.KeyboardEvent('keydown', params));
                    inputBox.dispatchEvent(new win.KeyboardEvent('keypress', params));
                    inputBox.dispatchEvent(new win.KeyboardEvent('keyup', params));
                } catch (e) {
                    inputBox.dispatchEvent(new KeyboardEvent('keydown', params));
                    inputBox.dispatchEvent(new KeyboardEvent('keypress', params));
                    inputBox.dispatchEvent(new KeyboardEvent('keyup', params));
                }
            };

            inputBox.focus();
            dispatchEnter();

            // Verify send by waiting for the composer to clear.
            const waitForClear = async (timeoutMs) => {
                const start = Date.now();
                while (Date.now() - start < timeoutMs) {
                    await new Promise(r => setTimeout(r, 100));
                    const current = getInputValue(inputBox);
                    if (!current) return true;
                }
                return false;
            };

            if (await waitForClear(3500)) {
                log('[Prompt] Sent via Enter (composer cleared)');
                return true;
            }

            // Fallback: some chat UIs require Ctrl+Enter or a send button.
            log('[Prompt] Enter did not clear composer; trying Ctrl+Enter and send-button fallback...');

            setPromptText(inputBox, text);
            await new Promise(r => setTimeout(r, 150));
            dispatchEnter({ ctrlKey: true });
            if (await waitForClear(3500)) {
                log('[Prompt] Sent via Ctrl+Enter (composer cleared)');
                return true;
            }

            const sendBtn = findSendButtonNearInput(inputBox);
            if (sendBtn) {
                try { sendBtn.click(); } catch (e) { }
                if (await waitForClear(3500)) {
                    log('[Prompt] Sent via Send button (composer cleared)');
                    return true;
                }
            }

            log('[Prompt] ERROR: Prompt did not appear to send (composer not cleared)');
            return false;
        } catch (e) {
            log(`[Prompt] ERROR: ${e?.message || String(e)}`);
            return false;
        }
    };

    // Send prompt to specific conversation (click tab first)
    window.__autoAcceptSendPromptToConversation = async (text, targetConversation) => {
        log(`[Prompt] sendPromptToConversation: "${text.substring(0, 50)}..." target: "${targetConversation || 'current'}"`);

        // Click target tab if specified
        if (targetConversation && targetConversation !== 'current') {
            const tabs = queryAll('button.grow');
            const targetTab = Array.from(tabs).find(t => {
                const tabName = t.textContent.trim();
                return tabName.includes(targetConversation) ||
                    targetConversation.includes(tabName.split(' ')[0]);
            });

            if (targetTab) {
                log(`[Prompt] Clicking target tab: "${targetTab.textContent.trim()}"`);
                targetTab.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                // Wait for tab switch
                await new Promise(r => setTimeout(r, 500));
            } else {
                log(`[Prompt] Target tab "${targetConversation}" not found, using current`);
            }
        }

        // Now send to current input, and return success status
        if (window.__autoAcceptSendPrompt) {
            return !!(await window.__autoAcceptSendPrompt(text));
        }
        return false;
    };

    log("Core Bundle Initialized.", true);
})();
