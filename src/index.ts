/**
 * @fairdatasociety/fds
 *
 * Sovereign data SDK. One import for identity, storage, messaging,
 * sharing, publishing, and trustless exchange.
 *
 * ```typescript
 * import { FdsClient } from '@fairdatasociety/fds'
 *
 * const fds = new FdsClient({
 *   storage: { type: 'swarm', beeUrl: 'http://localhost:1633', batchId: '...' }
 * })
 *
 * await fds.identity.create()
 * await fds.put('documents/hello.txt', 'hello world')
 * const data = await fds.get('documents/hello.txt')
 * ```
 */

// Client
export { FdsClient } from './client.js'

// Types
export * from './types.js'

// Errors
export { FdsError, FdsErrorCode, fdsError } from './errors.js'

// Adapters
export type { StorageAdapter, AdapterCapabilities } from './adapters/interface.js'
export { LocalAdapter } from './adapters/local.js'
// SwarmAdapter requires @fairdrive/core (optional peer dep)
// Use: const fds = new FdsClient({ storage: { type: 'swarm', beeUrl: '...' } })
