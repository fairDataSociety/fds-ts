/**
 * Config module exports
 *
 * Import specific implementations from:
 * - @fairdrop/core/config/browser
 * - @fairdrop/core/config/node
 */

export { BrowserConfigProvider } from './browser.js'
export { EnvConfigProvider, StaticConfigProvider } from './node.js'

// Contract addresses
export {
  DATA_ESCROW_ADDRESSES,
  getDataEscrowAddress,
  isEscrowSupported,
} from './contracts.js'
