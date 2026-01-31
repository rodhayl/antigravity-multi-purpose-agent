/**
 * Process Finder for Antigravity Language Server
 * 
 * Ported from AntigravityQuota/src/core/process_finder.ts
 */

'use strict';

const { exec } = require('child_process');
const { promisify } = require('util');
const https = require('https');
const { WindowsStrategy, UnixStrategy } = require('./strategies');

const execAsync = promisify(exec);

/**
 * @typedef {Object} ProcessInfo
 * @property {number} extensionPort - The extension server port from args
 * @property {number} connectPort - The validated port to connect to
 * @property {string} csrfToken - The CSRF token for authentication
 */

class ProcessFinder {
    constructor(log = console.log) {
        this.log = log;
        this.strategy = null;
        this.processName = '';

        // Determine platform and set strategy
        const platform = process.platform;

        if (platform === 'win32') {
            this.strategy = new WindowsStrategy();
            this.processName = 'language_server_windows_x64.exe';
        } else if (platform === 'darwin') {
            this.strategy = new UnixStrategy('darwin');
            this.processName = process.arch === 'arm64'
                ? 'language_server_macos_arm'
                : 'language_server_macos';
        } else {
            this.strategy = new UnixStrategy('linux');
            this.processName = process.arch === 'arm64'
                ? 'language_server_linux_arm'
                : 'language_server_linux_x64';
        }

        this.log(`[ProcessFinder] Initialized for ${platform}, target: ${this.processName}`);
    }

    /**
     * Detect the Antigravity process and return connection info
     * @param {number} maxRetries - Maximum number of retry attempts
     * @returns {Promise<ProcessInfo|null>}
     */
    async detectProcessInfo(maxRetries = 1) {
        this.log(`[ProcessFinder] Starting detection (maxRetries: ${maxRetries})`);

        for (let i = 0; i < maxRetries; i++) {
            this.log(`[ProcessFinder] Attempt ${i + 1}/${maxRetries}`);

            try {
                const cmd = this.strategy.getProcessListCommand(this.processName);
                this.log(`[ProcessFinder] Executing: ${cmd.substring(0, 100)}...`);

                const { stdout, stderr } = await execAsync(cmd);

                if (stderr) {
                    this.log(`[ProcessFinder] stderr: ${stderr}`);
                }

                const info = this.strategy.parseProcessInfo(stdout);

                if (info) {
                    this.log(`[ProcessFinder] Found process: PID=${info.pid}, port=${info.extensionPort}`);

                    // Get listening ports for this PID
                    const ports = await this.getListeningPorts(info.pid);
                    this.log(`[ProcessFinder] Listening ports: [${ports.join(', ')}]`);

                    if (ports.length > 0) {
                        // Find a working port
                        const validPort = await this.findWorkingPort(ports, info.csrfToken);

                        if (validPort) {
                            this.log(`[ProcessFinder] SUCCESS: Valid port found: ${validPort}`);
                            return {
                                extensionPort: info.extensionPort,
                                connectPort: validPort,
                                csrfToken: info.csrfToken
                            };
                        } else {
                            this.log(`[ProcessFinder] No ports responded to health check`);
                        }
                    } else {
                        this.log(`[ProcessFinder] No listening ports found for PID ${info.pid}`);
                    }
                } else {
                    this.log(`[ProcessFinder] Failed to parse process info`);
                }
            } catch (e) {
                this.log(`[ProcessFinder] Attempt ${i + 1} failed: ${e.message}`);
            }

            if (i < maxRetries - 1) {
                this.log(`[ProcessFinder] Waiting 100ms before retry...`);
                await new Promise(r => setTimeout(r, 100));
            }
        }

        this.log(`[ProcessFinder] Detection failed after ${maxRetries} attempts`);
        return null;
    }

    /**
     * Get listening ports for a process
     * @param {number} pid - Process ID
     * @returns {Promise<number[]>}
     */
    async getListeningPorts(pid) {
        try {
            const cmd = this.strategy.getPortListCommand(pid);
            this.log(`[ProcessFinder] Getting ports for PID ${pid}`);

            const { stdout, stderr } = await execAsync(cmd);

            if (stderr) {
                this.log(`[ProcessFinder] Port list stderr: ${stderr}`);
            }

            return this.strategy.parseListeningPorts(stdout, pid);
        } catch (e) {
            this.log(`[ProcessFinder] Failed to get ports: ${e.message}`);
            return [];
        }
    }

    /**
     * Find a working port from the list
     * @param {number[]} ports - List of ports to test
     * @param {string} csrfToken - CSRF token for authentication
     * @returns {Promise<number|null>}
     */
    async findWorkingPort(ports, csrfToken) {
        for (const port of ports) {
            this.log(`[ProcessFinder] Testing port ${port}...`);
            const isWorking = await this.testPort(port, csrfToken);

            if (isWorking) {
                this.log(`[ProcessFinder] Port ${port} is working`);
                return port;
            } else {
                this.log(`[ProcessFinder] Port ${port} did not respond`);
            }
        }
        return null;
    }

    /**
     * Test if a port is responding correctly
     * @param {number} port - Port to test
     * @param {string} csrfToken - CSRF token
     * @returns {Promise<boolean>}
     */
    testPort(port, csrfToken) {
        return new Promise(resolve => {
            const options = {
                hostname: '127.0.0.1',
                port,
                path: '/exa.language_server_pb.LanguageServerService/GetUnleashData',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Codeium-Csrf-Token': csrfToken,
                    'Connect-Protocol-Version': '1'
                },
                rejectUnauthorized: false,
                timeout: 5000
            };

            this.log(`[ProcessFinder] HTTP request to https://127.0.0.1:${port}${options.path}`);

            const req = https.request(options, res => {
                this.log(`[ProcessFinder] Response from port ${port}: status=${res.statusCode}`);

                let body = '';
                res.on('data', chunk => (body += chunk));
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            JSON.parse(body);
                            resolve(true);
                        } catch {
                            this.log(`[ProcessFinder] Port ${port} responded 200 but body is not valid JSON`);
                            resolve(false);
                        }
                    } else {
                        resolve(false);
                    }
                });
            });

            req.on('error', err => {
                this.log(`[ProcessFinder] Port ${port} error: ${err.code || err.message}`);
                resolve(false);
            });

            req.on('timeout', () => {
                this.log(`[ProcessFinder] Port ${port} timeout`);
                req.destroy();
                resolve(false);
            });

            req.write(JSON.stringify({ wrapper_data: {} }));
            req.end();
        });
    }

    /**
     * Convenience method to find the process
     * @returns {Promise<ProcessInfo|null>}
     */
    async find() {
        return this.detectProcessInfo(3);
    }
}

module.exports = { ProcessFinder };
