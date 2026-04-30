/**
 * @fairdatasociety/fds/fairdrive — Browser-safe Fairdrive primitives.
 *
 * Drop-in for @fairdrive/core. Pure crypto + bee-js — no fs/path/os imports,
 * works in browser and Node.
 *
 * For Node-only primitives (SecureStore, SyncEngine), import from
 * `@fairdatasociety/fds/fairdrive/node` instead.
 */

export { PodManager } from './fairdrive/pod/PodManager.js'
export type { Pod, PodManagerConfig } from './fairdrive/pod/PodManager.js'
export type { Pod as CorePodType } from './fairdrive/pod/PodManager.js'

export { FileManager } from './fairdrive/file/FileManager.js'
export type {
  FileInfo,
  FileIndex,
  FileManagerConfig,
  UploadOptions,
} from './fairdrive/file/FileManager.js'
export { ChunkManager, shouldChunk } from './fairdrive/file/ChunkManager.js'
export type {
  ChunkManifest,
  ChunkInfo,
  UploadProgress,
  DownloadProgress,
  ChunkManagerConfig,
} from './fairdrive/file/ChunkManager.js'

export { ACT } from './fairdrive/access/ACT.js'
export type { ACTMetadata, ACTGrant } from './fairdrive/access/ACT.js'

export { WalletManager } from './fairdrive/identity/WalletManager.js'
export type { Wallet as FairdriveWallet, WalletManagerConfig } from './fairdrive/identity/WalletManager.js'

export { SecureWallet, zeroBuffer } from './fairdrive/identity/SecureWallet.js'
export type { SecureWalletData } from './fairdrive/identity/SecureWallet.js'

export {
  createFairdropKeystore,
  parseFairdropKeystore,
  validateKeystoreFormat,
  getSubdomainFromAddress,
} from './fairdrive/identity/FairdropKeystore.js'
export type { FairdropKeystore, FairdropPayload } from './fairdrive/identity/FairdropKeystore.js'

// Re-export type interfaces (no runtime code, browser-safe)
export type {
  Change,
  Conflict,
  RemoteFileInfo,
  SyncStatus,
  SyncResult,
  PullResult,
  WatchEvent,
  WatchCallback,
  SyncProgress,
  SyncProgressCallback,
  SyncEngineConfig,
} from './fairdrive/sync/SyncEngine.js'
export type { StoredWallet, SecureStoreConfig } from './fairdrive/identity/SecureStore.js'
