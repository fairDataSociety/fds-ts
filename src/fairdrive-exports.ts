/**
 * @fairdatasociety/fds/fairdrive — Fairdrive primitives (drop-in for @fairdrive/core).
 *
 * For UI/MCP consumers that previously imported PodManager, FileManager, ACT,
 * WalletManager, SyncEngine etc. from @fairdrive/core. Use FdsClient for the
 * high-level S3-like API.
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

export { SyncEngine } from './fairdrive/sync/SyncEngine.js'
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
