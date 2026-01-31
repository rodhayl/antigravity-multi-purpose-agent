/**
 * Antigravity Module - Barrel Export
 * 
 * Centralized export for all Antigravity integration components.
 */

'use strict';

const { AntigravityClient } = require('./client');
const { ProcessFinder } = require('./process-finder');
const { WindowsStrategy, UnixStrategy } = require('./strategies');

module.exports = {
    AntigravityClient,
    ProcessFinder,
    WindowsStrategy,
    UnixStrategy
};
