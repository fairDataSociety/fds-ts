/**
 * @fairdrive/core
 *
 * Fairdrive core library - Pod management, file operations, sync engine.
 * FDS Layer 1 building block for data sovereignty.
 *
 * Usage:
 * ```typescript
 * import { createFairdrive, createLightFairdrive, createHiveFairdrive } from '@fairdrive/core';
 *
 * // Light mode (gateway)
 * const fd = createLightFairdrive();
 * await fd.login('username', 'password');
 *
 * // Hive mode (local Bee)
 * const fd = createHiveFairdrive('http://localhost:1633', 'your-batch-id');
 * await fd.login('username', 'password');
 *
 * // Custom configuration
 * const fd = createFairdrive({
 *   mode: 'cypherpunk',
 *   beeUrl: 'http://localhost:1633',
 *   batchId: 'your-batch-id',
 *   fuseMountPoint: '~/Fairdrive',
 * });
 * ```
 */

// Interfaces
export * from './interfaces/index.js';

// Adapters
export * from './adapters/index.js';

// Legacy exports (kept for backward compatibility during migration)
export { PodManager } from './pod/PodManager.js';
export type { Pod as CorePodType, PodManagerConfig } from './pod/PodManager.js';
export { FileManager } from './file/FileManager.js';
export type { Pod as FairdrivePod } from './pod/PodManager.js';
export type { FileInfo, FileIndex, FileManagerConfig, UploadOptions } from './file/FileManager.js';
export { SyncEngine } from './sync/SyncEngine.js';
export type {
  Change,
  Conflict,
  RemoteFileInfo,
  SyncStatus,
  SyncResult,
  PullResult,
  SyncEngineConfig,
  WatchEvent,
  WatchCallback,
  SyncProgress,
  SyncProgressCallback,
} from './sync/SyncEngine.js';
export { WalletManager } from './identity/WalletManager.js';

// Sync configuration
export * from './sync/config.js';

// Chunked file handling
export { ChunkManager, shouldChunk } from './file/ChunkManager.js';
export type { ChunkManifest, ChunkInfo, UploadProgress, DownloadProgress, ChunkManagerConfig } from './file/ChunkManager.js';

// Secure identity (recommended for production)
export { SecureWallet, zeroBuffer } from './identity/SecureWallet.js';
export type { SecureWalletData } from './identity/SecureWallet.js';
export { SecureStore, getSecureStore, resetSecureStore } from './identity/SecureStore.js';
export type { StoredWallet, SecureStoreConfig } from './identity/SecureStore.js';

// FDS Portable Account (Fairdrop keystore format, interoperable with fds-id-go)
export {
  createFairdropKeystore,
  parseFairdropKeystore,
  validateKeystoreFormat,
  getSubdomainFromAddress,
} from './identity/FairdropKeystore.js';
export type { FairdropKeystore, FairdropPayload } from './identity/FairdropKeystore.js';

// Access Control
export { ACT } from './access/ACT.js';
export type { ACTGrant, ACTMetadata, ACTConfig, EncryptResult } from './access/ACT.js';

// Stamper-based upload (client-side chunk signing for gateway-agnostic uploads)
export { StamperUploader, StamperManager, MemoryStamperStore, buildTree, CHUNK_PAYLOAD_SIZE } from './upload/index.js';
export type { WriteFeedOptions, StamperStore, StamperManagerConfig, StampableChunk, OnChunkCallback } from './upload/index.js';
