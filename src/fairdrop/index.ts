/**
 * @fairdrop/core
 *
 * Isomorphic core library for Fairdrop - no browser dependencies.
 * Provides adapters, crypto, storage, and error handling.
 */

// Adapter interfaces
export * from './adapters/index.js'

// Error taxonomy
export * from './errors/index.js'

// Contract provider (viem-based)
export * from './contract/index.js'

// Implementations are exported from subpaths:
// - @fairdrop/core/crypto/browser or @fairdrop/core/crypto/node
// - @fairdrop/core/storage/browser or @fairdrop/core/storage/node
// - etc.
