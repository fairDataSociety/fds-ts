/**
 * Storage module exports
 *
 * Import specific implementations from:
 * - @fairdrop/core/storage/browser
 * - @fairdrop/core/storage/node
 */

export { BrowserStorageAdapter } from './browser.js'
export { FileStorageAdapter, MemoryStorageAdapter } from './node.js'

// Isomorphic account storage
export { AccountStorage, STORAGE_KEYS } from './account-storage.js'
export type {
  StoredAccount,
  StoredMailboxes,
  StoredMessage,
  StoredHonestInbox,
  StoredInboxes,
  FairdropSettings,
  MessageType,
} from './account-storage.js'
