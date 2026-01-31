/**
 * Antigravity Client - HTTP Client for Language Server API
 * 
 * Ported from AntigravityQuota/src/core/quota_manager.ts
 */

'use strict';

const https = require('https');
const { ProcessFinder } = require('./process-finder');

/**
 * @typedef {Object} UserStatus
 * @property {string} name - User name
 * @property {string} email - User email
 * @property {Object} planStatus - Plan information
 */

/**
 * @typedef {Object} QuotaSnapshot
 * @property {Date} timestamp - When the snapshot was taken
 * @property {Object} promptCredits - Prompt credits info
 * @property {Array} models - Model quota information
 */

class AntigravityClient {
    constructor(log = console.log) {
        this.log = log;
        this.port = 0;
        this.csrfToken = '';
        this.connected = false;
        this.processFinder = new ProcessFinder(log);
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;

        this.updateCallback = null;
        this.errorCallback = null;
        this.pollingTimer = null;
    }

    /**
     * Initialize the client with connection details
     * @param {number} port - Server port
     * @param {string} csrfToken - CSRF token
     */
    init(port, csrfToken) {
        this.port = port;
        this.csrfToken = csrfToken;
        this.connected = true;
        this.log(`[AntigravityClient] Initialized with port ${port}`);
    }

    /**
     * Connect to the Antigravity language server
     * @returns {Promise<boolean>}
     */
    async connect() {
        this.log('[AntigravityClient] Attempting to connect...');

        try {
            const processInfo = await this.processFinder.find();

            if (processInfo) {
                this.init(processInfo.connectPort, processInfo.csrfToken);
                this.log('[AntigravityClient] Connected successfully');
                this.reconnectAttempts = 0;
                return true;
            } else {
                this.log('[AntigravityClient] Failed to find Antigravity process');
                return false;
            }
        } catch (e) {
            this.log(`[AntigravityClient] Connection error: ${e.message}`);
            return false;
        }
    }

    /**
     * Disconnect from the language server
     */
    disconnect() {
        this.stopPolling();
        this.connected = false;
        this.port = 0;
        this.csrfToken = '';
        this.log('[AntigravityClient] Disconnected');
    }

    /**
     * Attempt to reconnect if connection was lost
     * @returns {Promise<boolean>}
     */
    async reconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.log(`[AntigravityClient] Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
            return false;
        }

        this.reconnectAttempts++;
        this.log(`[AntigravityClient] Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

        this.disconnect();
        await new Promise(r => setTimeout(r, 500)); // Brief delay before reconnect
        return this.connect();
    }

    /**
     * Make an HTTP request to the language server
     * @param {string} path - API path
     * @param {Object} body - Request body
     * @returns {Promise<Object>}
     */
    request(path, body) {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                reject(new Error('Client not connected'));
                return;
            }

            const data = JSON.stringify(body);
            const options = {
                hostname: '127.0.0.1',
                port: this.port,
                path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'Connect-Protocol-Version': '1',
                    'X-Codeium-Csrf-Token': this.csrfToken
                },
                rejectUnauthorized: false,
                timeout: 5000
            };

            const req = https.request(options, res => {
                let body = '';
                res.on('data', chunk => (body += chunk));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch {
                        reject(new Error('Invalid JSON response'));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.write(data);
            req.end();
        });
    }

    /**
     * Get user status from the language server
     * @returns {Promise<Object>}
     */
    async getUserStatus() {
        this.log('[AntigravityClient] Fetching user status...');

        try {
            const data = await this.request(
                '/exa.language_server_pb.LanguageServerService/GetUserStatus',
                {
                    metadata: {
                        ideName: 'antigravity',
                        extensionName: 'antigravity',
                        locale: 'en'
                    }
                }
            );

            const snapshot = this.parseResponse(data);

            if (this.updateCallback) {
                this.updateCallback(snapshot);
            }

            return snapshot;
        } catch (error) {
            this.log(`[AntigravityClient] Error fetching status: ${error.message}`);

            // Attempt reconnection if this looks like a connection error
            if (error.message.includes('ECONNREFUSED') ||
                error.message.includes('timeout') ||
                error.message.includes('not connected')) {

                this.log('[AntigravityClient] Connection error detected, attempting reconnect...');
                const reconnected = await this.reconnect();

                if (reconnected) {
                    this.log('[AntigravityClient] Reconnected, retrying getUserStatus...');
                    return this.getUserStatus(); // Retry after reconnect
                }
            }

            if (this.errorCallback) {
                this.errorCallback(error);
            }

            throw error;
        }
    }

    /**
     * Parse the server response into a quota snapshot
     * @param {Object} data - Server response
     * @returns {QuotaSnapshot}
     */
    parseResponse(data) {
        const userStatus = data.userStatus || {};
        const planInfo = userStatus.planStatus?.planInfo;
        const availableCredits = userStatus.planStatus?.availablePromptCredits;

        let promptCredits = null;

        if (planInfo && availableCredits !== undefined) {
            const monthly = Number(planInfo.monthlyPromptCredits);
            const available = Number(availableCredits);
            if (monthly > 0) {
                promptCredits = {
                    available,
                    monthly,
                    usedPercentage: ((monthly - available) / monthly) * 100,
                    remainingPercentage: (available / monthly) * 100
                };
            }
        }

        const rawModels = userStatus.cascadeModelConfigData?.clientModelConfigs || [];
        const models = rawModels
            .map(m => {
                let resetTime = null;
                let diff = 0;
                let isExhausted = true; // Default to exhausted if no quota info
                let remainingPercentage = 0;
                let remainingFraction = 0;
                let timeUntilResetFormatted = '';

                if (m.quotaInfo) {
                    resetTime = new Date(m.quotaInfo.resetTime);
                    const now = new Date();
                    diff = resetTime.getTime() - now.getTime();

                    remainingFraction = m.quotaInfo.remainingFraction;
                    remainingPercentage = m.quotaInfo.remainingFraction !== undefined
                        ? m.quotaInfo.remainingFraction * 100
                        : 0;
                    isExhausted = m.quotaInfo.remainingFraction === 0;
                    timeUntilResetFormatted = this.formatTime(diff, resetTime);
                }

                return {
                    label: m.label,
                    modelId: m.modelOrAlias?.model || 'unknown',
                    remainingFraction: remainingFraction,
                    remainingPercentage: remainingPercentage,
                    isExhausted: isExhausted,
                    resetTime: resetTime,
                    timeUntilReset: diff,
                    timeUntilResetFormatted: timeUntilResetFormatted
                };
            });

        return {
            timestamp: new Date(),
            promptCredits,
            models,
            user: {
                name: userStatus.name || '',
                email: userStatus.email || '',
                plan: planInfo?.planName || 'Unknown'
            }
        };
    }

    /**
     * Format time until reset
     * @param {number} ms - Milliseconds
     * @param {Date} resetTime - Reset time
     * @returns {string}
     */
    formatTime(ms, resetTime) {
        if (ms <= 0) return 'Ready';

        const mins = Math.ceil(ms / 60000);
        let duration = '';

        if (mins < 60) {
            duration = `${mins}m`;
        } else {
            const hours = Math.floor(mins / 60);
            duration = `${hours}h ${mins % 60}m`;
        }

        const dateStr = resetTime.toLocaleDateString(undefined, {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        const timeStr = resetTime.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

        return `${duration} (${dateStr} ${timeStr})`;
    }

    /**
     * Register update callback
     * @param {Function} callback - Callback function
     */
    onUpdate(callback) {
        this.updateCallback = callback;
    }

    /**
     * Register error callback
     * @param {Function} callback - Callback function
     */
    onError(callback) {
        this.errorCallback = callback;
    }

    /**
     * Start polling for updates
     * @param {number} intervalMs - Polling interval in milliseconds
     */
    startPolling(intervalMs = 120000) {
        this.stopPolling();
        this.getUserStatus().catch(() => { });
        this.pollingTimer = setInterval(() => this.getUserStatus().catch(() => { }), intervalMs);
        this.log(`[AntigravityClient] Started polling every ${intervalMs}ms`);
    }

    /**
     * Stop polling
     */
    stopPolling() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
            this.log('[AntigravityClient] Stopped polling');
        }
    }

    /**
     * Check if client is connected
     * @returns {boolean}
     */
    isConnected() {
        return this.connected;
    }

    /**
     * Get connection status string
     * @returns {string}
     */
    getStatus() {
        if (!this.connected) {
            return 'Disconnected';
        }
        return `Connected (port ${this.port})`;
    }
}

module.exports = { AntigravityClient };
