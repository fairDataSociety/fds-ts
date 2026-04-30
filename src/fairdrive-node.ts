/**
 * @fairdatasociety/fds/fairdrive/node — Node-only Fairdrive primitives.
 *
 * Use this in Node.js / Electron / Wails desktop / MCP servers — anywhere
 * filesystem access is available. Bundlers WILL fail in browser builds if
 * you import from here, by design.
 *
 * For browser-safe Fairdrive primitives (PodManager, FileManager, ACT,
 * WalletManager, etc.), use `@fairdatasociety/fds/fairdrive`.
 */

// Re-export everything browser-safe — desktop apps want one import
export * from './fairdrive-exports.js'

// Add Node-only primitives
export { SecureStore, getSecureStore, resetSecureStore } from './fairdrive/identity/SecureStore.js'
export { SyncEngine } from './fairdrive/sync/SyncEngine.js'
