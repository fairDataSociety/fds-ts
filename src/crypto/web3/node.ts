/**
 * Node.js-specific crypto utilities
 *
 * Uses the same @noble libraries as browser for consistency.
 * Can be extended to use Node.js crypto module for performance-critical ops.
 */

// Re-export browser implementation - works identically in Node.js
export { BrowserCrypto as NodeCrypto } from './browser.js'
