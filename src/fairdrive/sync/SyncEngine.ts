/**
 * Local-first sync engine for Fairdrive
 *
 * Implements eventual consistency between local storage and Swarm.
 * Changes are applied locally first, then synced in background.
 *
 * Security features:
 * - Encrypted sync metadata
 * - Mutex protection for concurrent operations
 * - Retry logic with exponential backoff
 */

import { Bee, Reference, Topic, FeedWriter, FeedReader } from '@ethersphere/bee-js';
import { keccak256, toUtf8Bytes } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/** Convert bee-js v10 Reference (Bytes subclass) to hex string */
function refToString(ref: Reference | string): string {
  if (typeof ref === 'string') return ref;
  return ref.toHex();
}
import { Mutex } from 'async-mutex';
// Chokidar types - using generic interface to avoid import issues in browser
interface FSWatcher {
  close(): Promise<void>;
  on(event: string, callback: (...args: unknown[]) => void): this;
}
import { ChunkManager, UploadProgress, DownloadProgress } from '../file/ChunkManager.js';
import type { StamperUploader } from '../upload/StamperUploader.js';

export interface Change {
  id: string;
  type: 'create' | 'update' | 'delete';
  podName: string;
  path: string;
  timestamp: string;
  localRef?: string;
  swarmRef?: string;
  contentHash?: string;
  /** True if file was uploaded via ChunkManager (> 4MB) */
  isChunked?: boolean;
}

export interface Conflict extends Change {
  remote: RemoteFileInfo;
  resolution?: 'local' | 'remote' | 'manual';
  detectedAt: string;
}

export interface RemoteFileInfo {
  path: string;
  swarmRef: string;
  contentHash: string;
  modifiedAt: string;
  /** True if file was uploaded via ChunkManager (> 4MB) */
  isChunked?: boolean;
}

export interface SyncStatus {
  lastSync: string | null;
  pendingChanges: number;
  conflicts: number;
  isOnline: boolean;
  isSyncing: boolean;
}

export interface SyncResult {
  pushed: number;
  failed: number;
  errors: string[];
  /** Whether the index was successfully published to the feed */
  indexPublished?: boolean;
}

export interface PullResult {
  pulled: number;
  conflicts: number;
  errors: string[];
}

export interface WatchEvent {
  type: 'create' | 'update' | 'delete';
  podName: string;
  path: string;
  localPath: string;
}

export type WatchCallback = (event: WatchEvent) => void;

export interface SyncProgress {
  phase: 'upload' | 'download';
  file: string;
  progress: UploadProgress | DownloadProgress;
}

export type SyncProgressCallback = (progress: SyncProgress) => void;

export interface SyncEngineConfig {
  beeUrl: string;
  localStoragePath: string;
  postageBatchId?: string;
  syncIntervalMs?: number;
  maxRetries?: number;
  /** Private key for signing feed updates (hex string with 0x prefix) */
  privateKey?: string;
  /** Owner address for reading feeds */
  ownerAddress?: string;
  /** Optional Bee instance for dependency injection (testing) */
  bee?: Bee;
  /** Debounce delay for file watching in milliseconds (default: 300ms) */
  watchDebounceMs?: number;
  /** Optional ChunkManager for large file handling (> 4MB) */
  chunkManager?: ChunkManager;
  /** Callback for upload/download progress (for large files) */
  onProgress?: SyncProgressCallback;
  /** Optional StamperUploader for client-side chunk stamping */
  stamperUploader?: StamperUploader;
}

// Topic prefix for sync index feeds
const SYNC_INDEX_TOPIC_PREFIX = 'fairdrive:sync:index:';

export class SyncEngine {
  private config: SyncEngineConfig;
  private bee: Bee;
  private pendingChanges: Change[] = [];
  private conflicts: Conflict[] = [];
  private lastSync: string | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private isOnline: boolean = true;
  private isSyncing: boolean = false;

  // Mutex for thread-safe operations
  private readonly pushMutex = new Mutex();
  private readonly pullMutex = new Mutex();

  // Encryption key for metadata (set via initSync)
  private metadataKey: Uint8Array | null = null;

  // Feed-related properties (set via initFeed)
  private feedTopic: Topic | null = null;
  private feedWriter: FeedWriter | null = null;
  private feedInitialized: boolean = false;
  private currentPodName: string | null = null;

  // Cache of last known remote index (used to preserve swarmRefs for unchanged files)
  private lastRemoteIndex: Record<string, RemoteFileInfo & { podName: string }> | null = null;

  // Retry configuration
  private readonly maxRetries: number;
  private readonly baseDelayMs: number = 1000;

  // File watching properties
  private watchers: Map<string, FSWatcher> = new Map();
  private watchCallbacks: Map<string, WatchCallback> = new Map();
  private watchDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly watchDebounceMs: number;

  // Large file handling
  private readonly chunkManager: ChunkManager | null;
  private readonly onProgress: SyncProgressCallback | null;
  private readonly stamperUploader: StamperUploader | null;

  constructor(config: SyncEngineConfig) {
    this.config = config;
    this.bee = config.bee ?? new Bee(config.beeUrl);
    this.maxRetries = config.maxRetries ?? 3;
    this.watchDebounceMs = config.watchDebounceMs ?? 300;
    this.chunkManager = config.chunkManager ?? null;
    this.onProgress = config.onProgress ?? null;
    this.stamperUploader = config.stamperUploader ?? null;

    // Ensure local storage directory exists
    this.ensureLocalStorage();

    // Load pending changes from disk (unencrypted for now, will use key when set)
    this.loadPendingChanges();
  }

  /**
   * Initialize sync with encryption key
   * Must be called before push/pull operations
   */
  async initSync(encryptionKey: Uint8Array): Promise<void> {
    // Derive metadata key from encryption key
    this.metadataKey = await this.deriveMetadataKey(encryptionKey);

    // Re-load pending changes with decryption
    await this.loadPendingChangesEncrypted();
  }

  /**
   * Initialize feed for a pod
   * Must be called to enable remote sync (push/pull via Swarm feeds)
   * @param podName Pod name to derive feed topic from
   * @param privateKey Private key for signing feed updates (hex string with 0x prefix)
   */
  async initFeed(podName: string, privateKey: string): Promise<void> {
    // Clear cached remote index when switching pods
    if (this.currentPodName !== podName) {
      this.lastRemoteIndex = null;
    }

    // Derive feed topic from pod name
    this.feedTopic = this.getTopicHash(SYNC_INDEX_TOPIC_PREFIX + podName);
    this.currentPodName = podName;

    // Create feed writer (bee-js v10: topic, signer)
    this.feedWriter = this.bee.makeFeedWriter(this.feedTopic, privateKey);

    // Store private key and derive owner address for reading
    this.config.privateKey = privateKey;

    this.feedInitialized = true;
  }

  /**
   * Check if feed is initialized
   */
  isFeedInitialized(): boolean {
    return this.feedInitialized;
  }

  /**
   * Start background sync
   */
  start(): void {
    if (this.syncInterval) return;

    const interval = this.config.syncIntervalMs || 30000; // Default 30s
    this.syncInterval = setInterval(() => {
      this.syncAll().catch(console.error);
    }, interval);

    // Initial sync
    this.syncAll().catch(console.error);
  }

  /**
   * Stop background sync and all file watchers
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    // Stop all file watchers synchronously (best effort)
    for (const watcher of this.watchers.values()) {
      watcher.close().catch(() => {}); // Ignore errors during cleanup
    }
    this.watchers.clear();
    this.watchCallbacks.clear();

    // Clear all debounce timers
    for (const timer of this.watchDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.watchDebounceTimers.clear();
  }

  /**
   * Start watching a pod directory for file changes
   * @param podName Pod name to watch
   * @param callback Function called when files change
   * @returns Promise that resolves to true if watching started, false if already watching
   */
  async watch(podName: string, callback: WatchCallback): Promise<boolean> {
    // Already watching this pod
    if (this.watchers.has(podName)) {
      return false;
    }

    const podPath = this.getLocalPath(podName, '');

    // Ensure pod directory exists
    if (!fs.existsSync(podPath)) {
      fs.mkdirSync(podPath, { recursive: true });
    }

    // File watching only works in Node.js - check environment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (globalThis as any).window !== 'undefined') {
      console.warn('File watching is not supported in browser. Use desktop file watcher instead.');
      return false;
    }

    // Dynamically import chokidar (Node.js only)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const chokidar = require('chokidar');
    const watcher = chokidar.watch(podPath, {
      persistent: true,
      ignoreInitial: true,
      ignored: [
        /(^|[\/\\])\../, // Ignore dotfiles
        /node_modules/,
        /\.sync-metadata\.json/,
      ],
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
      usePolling: process.platform !== 'darwin', // Use polling on non-macOS for reliability
    });

    // Store callback
    this.watchCallbacks.set(podName, callback);

    // Handle file events with debouncing
    const handleEvent = (eventType: 'create' | 'update' | 'delete', filePath: string) => {
      const relativePath = '/' + path.relative(podPath, filePath).replace(/\\/g, '/');
      const debounceKey = `${podName}:${relativePath}`;

      // Clear existing debounce timer
      const existingTimer = this.watchDebounceTimers.get(debounceKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Set new debounce timer
      const timer = setTimeout(() => {
        this.watchDebounceTimers.delete(debounceKey);

        // Track the change
        this.trackChange({
          type: eventType,
          podName,
          path: relativePath,
          localRef: filePath,
        });

        // Call the callback
        const cb = this.watchCallbacks.get(podName);
        if (cb) {
          cb({
            type: eventType,
            podName,
            path: relativePath,
            localPath: filePath,
          });
        }
      }, this.watchDebounceMs);

      this.watchDebounceTimers.set(debounceKey, timer);
    };

    watcher
      .on('add', (filePath: string) => handleEvent('create', filePath))
      .on('change', (filePath: string) => handleEvent('update', filePath))
      .on('unlink', (filePath: string) => handleEvent('delete', filePath));

    this.watchers.set(podName, watcher);

    // Wait for watcher to be ready
    return new Promise((resolve) => {
      watcher.on('ready', () => resolve(true));
    });
  }

  /**
   * Stop watching a pod directory
   * @param podName Pod name to stop watching
   * @returns true if watcher was stopped, false if not watching
   */
  async unwatch(podName: string): Promise<boolean> {
    const watcher = this.watchers.get(podName);
    if (!watcher) {
      return false;
    }

    // Close the watcher
    await watcher.close();
    this.watchers.delete(podName);
    this.watchCallbacks.delete(podName);

    // Clear any pending debounce timers for this pod
    for (const [key, timer] of this.watchDebounceTimers.entries()) {
      if (key.startsWith(podName + ':')) {
        clearTimeout(timer);
        this.watchDebounceTimers.delete(key);
      }
    }

    return true;
  }

  /**
   * Stop all file watchers
   */
  async unwatchAll(): Promise<void> {
    const podNames = Array.from(this.watchers.keys());
    for (const podName of podNames) {
      await this.unwatch(podName);
    }
  }

  /**
   * Check if a pod is being watched
   */
  isWatching(podName: string): boolean {
    return this.watchers.has(podName);
  }

  /**
   * Push local changes to Swarm - MUTEX PROTECTED
   */
  async push(): Promise<SyncResult> {
    const release = await this.pushMutex.acquire();
    try {
      return await this.pushInternal();
    } finally {
      release();
    }
  }

  private async pushInternal(): Promise<SyncResult> {
    if (!this.config.postageBatchId) {
      return {
        pushed: 0,
        failed: this.pendingChanges.length,
        errors: ['No postage batch ID configured'],
      };
    }

    let pushed = 0;
    let failed = 0;
    const errors: string[] = [];
    const remaining: Change[] = [];
    const pushedChanges: Change[] = []; // Track pushed changes for index publishing

    for (const change of this.pendingChanges) {
      try {
        if (change.type === 'create' || change.type === 'update') {
          // Read local file
          const localPath = this.getLocalPath(change.podName, change.path);
          if (fs.existsSync(localPath)) {
            const data = fs.readFileSync(localPath);
            const fileSize = data.length;

            // Check if we should use ChunkManager for large files
            if (this.chunkManager && this.chunkManager.needsChunking(fileSize)) {
              // Upload via ChunkManager with progress callback
              const result = await this.chunkManager.uploadLargeFile(
                data,
                this.onProgress
                  ? (progress: UploadProgress) => this.onProgress!({
                      phase: 'upload',
                      file: change.path,
                      progress,
                    })
                  : undefined
              );
              change.swarmRef = result.manifestRef;
              change.isChunked = true;
            } else {
              // Upload directly to Swarm with retry
              const result = await this.uploadWithRetry(new Uint8Array(data));
              change.swarmRef = result;
              change.isChunked = false;
            }
            pushedChanges.push(change); // Save pushed change with swarmRef
            pushed++;
          } else {
            errors.push(`Local file not found: ${change.path}`);
            remaining.push(change);
            failed++;
          }
        } else if (change.type === 'delete') {
          // Deletions don't upload anything, just mark as synced
          pushed++;
        }
      } catch (e) {
        const errorMsg = `Failed to push ${change.path}: ${e instanceof Error ? e.message : String(e)}`;
        console.error(errorMsg);
        errors.push(errorMsg);
        remaining.push(change);
        failed++;
      }
    }

    // Publish updated index to feed if any files were pushed
    // Do this BEFORE clearing pending changes so we have the swarmRefs
    let indexPublished = false;
    if (pushed > 0) {
      // Temporarily set pending changes to pushed changes for index building
      const savedPending = this.pendingChanges;
      this.pendingChanges = pushedChanges;
      indexPublished = await this.publishIndexToFeed();
      this.pendingChanges = savedPending;
    }

    this.pendingChanges = remaining;
    this.lastSync = new Date().toISOString();
    await this.savePendingChanges();

    return { pushed, failed, errors, indexPublished };
  }

  /**
   * Pull remote changes from Swarm - MUTEX PROTECTED
   */
  async pull(): Promise<PullResult> {
    const release = await this.pullMutex.acquire();
    try {
      return await this.pullInternal();
    } finally {
      release();
    }
  }

  private async pullInternal(): Promise<PullResult> {
    let pulled = 0;
    let conflicts = 0;
    const errors: string[] = [];

    try {
      // Fetch remote index from Swarm feed
      const remoteIndex = await this.fetchRemoteIndexWithRetry();

      if (!remoteIndex) {
        // No remote index yet, nothing to pull
        return { pulled: 0, conflicts: 0, errors: [] };
      }

      // Get local index (from pending changes and local files)
      const localFiles = this.buildLocalIndex();

      // Compare and sync
      for (const [filePath, remoteFile] of Object.entries(remoteIndex)) {
        const localFile = localFiles.get(filePath);
        const pendingChange = this.pendingChanges.find(
          c => c.podName === remoteFile.podName && c.path === filePath
        );

        try {
          if (!localFile) {
            // New remote file - download
            await this.downloadFileWithRetry(remoteFile);
            pulled++;
          } else if (remoteFile.contentHash !== localFile.contentHash) {
            if (pendingChange) {
              // CONFLICT: both changed
              const conflict: Conflict = {
                ...pendingChange,
                remote: remoteFile,
                detectedAt: new Date().toISOString(),
              };
              this.conflicts.push(conflict);
              conflicts++;
            } else {
              // Remote updated, no local changes - download
              await this.downloadFileWithRetry(remoteFile);
              pulled++;
            }
          }
          // If hashes match, file is in sync - no action needed
        } catch (e) {
          const errorMsg = `Failed to pull ${filePath}: ${e instanceof Error ? e.message : String(e)}`;
          errors.push(errorMsg);
        }
      }

      this.lastSync = new Date().toISOString();
      await this.savePendingChanges();

    } catch (e) {
      errors.push(`Failed to fetch remote index: ${e instanceof Error ? e.message : String(e)}`);
    }

    return { pulled, conflicts, errors };
  }

  /**
   * Sync all (push then pull)
   */
  async syncAll(): Promise<void> {
    if (this.isSyncing) return;

    this.isSyncing = true;
    try {
      // Check if Bee is reachable
      await this.bee.checkConnection();
      this.isOnline = true;

      // Push local changes first
      await this.push();

      // Then pull remote changes
      await this.pull();
    } catch (e) {
      this.isOnline = false;
      console.error('Sync failed:', e);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Get current sync status
   */
  status(): SyncStatus {
    return {
      lastSync: this.lastSync,
      pendingChanges: this.pendingChanges.length,
      conflicts: this.conflicts.length,
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
    };
  }

  /**
   * Get pending changes
   */
  getPendingChanges(): Change[] {
    return [...this.pendingChanges];
  }

  /**
   * Get conflicts
   */
  getConflicts(): Conflict[] {
    return [...this.conflicts];
  }

  /**
   * Track a local change for sync
   */
  trackChange(change: Omit<Change, 'id' | 'timestamp'>): void {
    const fullChange: Change = {
      ...change,
      id: this.generateChangeId(),
      timestamp: new Date().toISOString(),
    };

    // Check if there's already a pending change for this path
    const existingIndex = this.pendingChanges.findIndex(
      c => c.podName === change.podName && c.path === change.path
    );

    if (existingIndex >= 0) {
      // Replace existing change
      this.pendingChanges[existingIndex] = fullChange;
    } else {
      this.pendingChanges.push(fullChange);
    }

    this.savePendingChanges();
  }

  /**
   * Scan local files and track as pending changes for initial sync.
   * Compares with remote index to avoid re-uploading files already on Swarm.
   * @param podName Pod name to use for tracking. If empty, extracts from path (multi-pod mode).
   *                If provided, assigns ALL files to this pod (single-pod mode).
   * @returns Number of files tracked for sync
   */
  async scanAndTrackLocal(podName: string): Promise<number> {
    // Build local index
    const localIndex = this.buildLocalIndex();

    // Try to get remote index for comparison (may be null on first sync)
    const remoteIndex = await this.fetchRemoteIndexWithRetry();

    let tracked = 0;

    // Single-pod mode: assign all files to one pod (e.g., "Fairdrive")
    // Multi-pod mode (legacy): extract pod from first directory component
    const singlePodMode = podName !== '';

    for (const [filePath, localFile] of localIndex.entries()) {
      // Extract potential pod name from path (e.g., /Documents/file.txt -> Documents)
      const pathParts = filePath.split('/').filter(Boolean);

      // Determine pod name and file path based on mode
      let usePodName: string;
      let useFilePath: string;

      if (singlePodMode) {
        // Single-pod mode: use provided podName for ALL files
        // Keep the full path including subdirectories
        usePodName = podName;
        useFilePath = filePath; // e.g., /Documents/file.txt
      } else {
        // Multi-pod mode (legacy): first directory is pod name
        usePodName = pathParts[0] || 'default';
        useFilePath = '/' + pathParts.slice(1).join('/'); // e.g., /file.txt
      }

      // Check if file exists in remote index with same hash
      // Remote key uses the full path with pod prefix
      const remoteKey = singlePodMode ? `/${usePodName}${useFilePath}` : filePath;
      const remoteFile = remoteIndex?.[remoteKey];

      if (remoteFile && remoteFile.contentHash === localFile.contentHash) {
        // Already synced with same content, skip
        continue;
      }

      // Check if already in pending changes
      const alreadyPending = this.pendingChanges.some(
        c => c.podName === usePodName && c.path === useFilePath
      );

      if (alreadyPending) continue;

      // Track as create (or update if remote exists but different)
      this.trackChange({
        type: remoteFile ? 'update' : 'create',
        podName: usePodName,
        path: useFilePath,
        localRef: this.getLocalPathForScan(usePodName, useFilePath, singlePodMode),
      });

      tracked++;
    }

    return tracked;
  }

  /**
   * Get local file path for scanning
   * In single-pod mode, path already includes subdirectories
   * In multi-pod mode, need to construct path with pod as subdirectory
   */
  private getLocalPathForScan(podName: string, filePath: string, singlePodMode: boolean): string {
    const storagePath = this.config.localStoragePath.replace(
      /^~/,
      process.env.HOME || ''
    );
    if (singlePodMode) {
      // In single-pod mode, filePath already has the full structure (e.g., /Documents/file.txt)
      // Don't add podName as prefix
      return path.join(storagePath, filePath);
    } else {
      // In multi-pod mode, construct path: storage/podName/filePath
      return path.join(storagePath, podName, filePath);
    }
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(changeId: string, resolution: 'local' | 'remote'): Promise<boolean> {
    const conflictIndex = this.conflicts.findIndex(c => c.id === changeId);
    if (conflictIndex < 0) return false;

    const conflict = this.conflicts[conflictIndex];

    if (resolution === 'local') {
      // Keep local version, mark for push
      this.pendingChanges.push({
        ...conflict,
        type: 'update',
      });
    } else {
      // Keep remote version, download it
      try {
        await this.downloadFileWithRetry(conflict.remote);
      } catch (e) {
        console.error('Failed to download remote version during conflict resolution:', e);
        return false;
      }
    }

    this.conflicts.splice(conflictIndex, 1);
    await this.savePendingChanges();
    return true;
  }

  /**
   * Write file locally and track change
   */
  async writeLocal(podName: string, filePath: string, data: Buffer): Promise<void> {
    const localPath = this.getLocalPath(podName, filePath);

    // Ensure directory exists
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Check if file exists for type determination
    const exists = fs.existsSync(localPath);

    // Write file
    fs.writeFileSync(localPath, data);

    // Calculate content hash
    const contentHash = keccak256(new Uint8Array(data));

    // Track change
    this.trackChange({
      type: exists ? 'update' : 'create',
      podName,
      path: filePath,
      localRef: localPath,
      contentHash,
    });
  }

  /**
   * Read file from local storage
   */
  readLocal(podName: string, filePath: string): Buffer | null {
    const localPath = this.getLocalPath(podName, filePath);
    if (fs.existsSync(localPath)) {
      return fs.readFileSync(localPath);
    }
    return null;
  }

  /**
   * Delete file locally and track change
   */
  deleteLocal(podName: string, filePath: string): void {
    const localPath = this.getLocalPath(podName, filePath);

    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }

    this.trackChange({
      type: 'delete',
      podName,
      path: filePath,
    });
  }

  // ============ Private Methods ============

  /**
   * Upload data to Swarm with retry
   */
  private async uploadWithRetry(data: Uint8Array): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        if (this.stamperUploader) {
          const ref = await this.stamperUploader.upload(data);
          return ref.toHex();
        } else {
          const result = await this.bee.uploadData(
            this.config.postageBatchId!,
            data
          );
          return refToString(result.reference);
        }
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < this.maxRetries) {
          await this.delay(this.baseDelayMs * Math.pow(2, attempt - 1));
        }
      }
    }

    throw lastError || new Error('Upload failed');
  }

  /**
   * Fetch remote index with retry
   */
  private async fetchRemoteIndexWithRetry(): Promise<Record<string, RemoteFileInfo & { podName: string }> | null> {
    if (!this.feedInitialized || !this.feedTopic || !this.config.ownerAddress) {
      // Feed not initialized - cannot fetch remote index
      return null;
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Create feed reader for the current pod's sync index (bee-js v10: topic, owner)
        const feedReader = this.bee.makeFeedReader(
          this.feedTopic,
          this.config.ownerAddress
        );

        // Download latest feed payload (bee-js v10: downloadPayload dereferences the feed
        // and returns the actual data in .payload, not a reference)
        const feedResult = await feedReader.downloadPayload();
        const rawData = feedResult.payload.toUint8Array();

        // Decrypt if we have a metadata key
        let indexJson: string;
        if (this.metadataKey) {
          indexJson = this.decryptIndexData(Buffer.from(rawData));
        } else {
          indexJson = new TextDecoder().decode(rawData);
        }

        // Parse and cache the index
        const index = JSON.parse(indexJson) as Record<string, RemoteFileInfo & { podName: string }>;
        this.lastRemoteIndex = index;
        return index;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));

        // 404 means no feed exists yet (first sync) - not an error
        if (lastError.message.includes('404')) {
          return null;
        }

        if (attempt < this.maxRetries) {
          await this.delay(this.baseDelayMs * Math.pow(2, attempt - 1));
        }
      }
    }

    // Log error but don't throw - return null to indicate no remote index
    console.error('Failed to fetch remote index after retries:', lastError);
    return null;
  }

  /**
   * Decrypt index data (supports both legacy AES-CTR and new AES-GCM format)
   */
  private decryptIndexData(encrypted: Buffer): string {
    if (!this.metadataKey) {
      throw new Error('Metadata key not set');
    }

    // Detect format: GCM uses 12-byte IV, legacy CTR uses 16-byte IV
    // GCM format: IV(12) || authTag(16) || ciphertext
    // Legacy CTR format: IV(16) || ciphertext
    const key = Buffer.from(this.metadataKey);

    if (encrypted.length > 28 && this.isGCMFormat(encrypted)) {
      // New AES-GCM format
      const iv = encrypted.subarray(0, 12);
      const authTag = encrypted.subarray(12, 28);
      const ciphertext = encrypted.subarray(28);

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      return decrypted.toString('utf-8');
    } else {
      // Legacy AES-CTR format (migration path)
      const iv = encrypted.subarray(0, 16);
      const ciphertext = encrypted.subarray(16);

      const decipher = crypto.createDecipheriv('aes-256-ctr', key, iv);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      return decrypted.toString('utf-8');
    }
  }

  /**
   * Check if data uses GCM format (heuristic: try GCM first)
   */
  private isGCMFormat(data: Buffer): boolean {
    // GCM format minimum: 12 (IV) + 16 (authTag) + 1 (ciphertext) = 29 bytes
    // CTR format minimum: 16 (IV) + 1 (ciphertext) = 17 bytes
    // We try GCM first; if it fails auth, fall back to CTR in decryptIndexData
    try {
      const iv = data.subarray(0, 12);
      const authTag = data.subarray(12, 28);
      const ciphertext = data.subarray(28);
      const key = Buffer.from(this.metadataKey!);

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      decipher.update(ciphertext);
      decipher.final();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Encrypt index data (always uses AES-GCM)
   */
  private encryptIndexData(data: string): Buffer {
    if (!this.metadataKey) {
      throw new Error('Metadata key not set');
    }

    const iv = crypto.randomBytes(12); // 12 bytes for GCM
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      Buffer.from(this.metadataKey),
      iv
    );

    const ciphertext = Buffer.concat([
      cipher.update(data, 'utf-8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Format: IV(12) || authTag(16) || ciphertext
    return Buffer.concat([iv, authTag, ciphertext]);
  }

  /**
   * Publish sync index to Swarm feed
   * Called after successful push to update remote index
   * @returns true if index was successfully published, false otherwise
   */
  private async publishIndexToFeed(): Promise<boolean> {
    if (!this.feedInitialized || !this.feedWriter || !this.config.postageBatchId) {
      return false;
    }

    try {
      // Build index from local files
      const localIndex = this.buildLocalIndex();

      // Convert to remote index format
      const remoteIndex: Record<string, RemoteFileInfo & { podName: string }> = {};
      const podName = this.currentPodName || 'default';

      for (const [filePath, fileInfo] of localIndex.entries()) {
        // Find the corresponding swarm ref from:
        // 1. Pending changes (newly pushed files)
        // 2. Last known remote index (unchanged files)
        // Note: filePath from buildLocalIndex is like /pod-name/file.txt
        // but pending changes have paths like /file.txt
        // Extract the file portion by removing pod prefix
        const podPrefix = '/' + podName;
        const changeFilePath = filePath.startsWith(podPrefix)
          ? filePath.slice(podPrefix.length)
          : filePath;
        const change = this.pendingChanges.find(c => c.path === changeFilePath && c.swarmRef);
        const existingRemote = this.lastRemoteIndex?.[filePath];

        remoteIndex[filePath] = {
          path: filePath,
          swarmRef: change?.swarmRef || existingRemote?.swarmRef || '',
          contentHash: fileInfo.contentHash,
          modifiedAt: new Date().toISOString(),
          podName,
          isChunked: change?.isChunked || existingRemote?.isChunked,
        };
      }

      // Serialize index
      const indexJson = JSON.stringify(remoteIndex);

      // Encrypt if we have a metadata key
      let indexData: Uint8Array;
      if (this.metadataKey) {
        indexData = this.encryptIndexData(indexJson);
      } else {
        indexData = new TextEncoder().encode(indexJson);
      }

      // Upload index data to Swarm and update feed
      if (this.stamperUploader && this.feedTopic && this.config.privateKey) {
        // Client-side stamping path
        const ref = await this.stamperUploader.upload(indexData);
        await this.stamperUploader.writeFeedReference(
          this.feedTopic,
          ref,
          this.config.privateKey,
        );
      } else {
        // Legacy server-side stamping path
        const uploadResult = await this.bee.uploadData(
          this.config.postageBatchId!,
          indexData
        );

        // Update feed to point to new index (bee-js v10: uploadReference)
        try {
          await this.feedWriter!.uploadReference(this.config.postageBatchId!, uploadResult.reference);
        } catch (e: unknown) {
          // Handle first write case - feed doesn't exist yet
          if (e instanceof Error && e.message.includes('404')) {
            await this.feedWriter!.uploadReference(this.config.postageBatchId!, uploadResult.reference, {
              index: 0,
            });
          } else {
            throw e;
          }
        }
      }

      // Update cached remote index after successful publish
      this.lastRemoteIndex = remoteIndex;
      return true;
    } catch (e) {
      console.error('Failed to publish index to feed:', e);
      return false;
    }
  }

  /**
   * Download file with retry
   * Uses ChunkManager for chunked files (> 4MB)
   */
  private async downloadFileWithRetry(remoteFile: RemoteFileInfo & { podName?: string }): Promise<void> {
    let lastError: Error | null = null;

    // Get destination path info
    const podName = remoteFile.podName || 'default';
    // Remote file path may include pod prefix (e.g., /pod-name/file.txt)
    // Strip it to avoid double-nesting when calling getLocalPath
    const podPrefix = '/' + podName;
    const filePath = remoteFile.path.startsWith(podPrefix)
      ? remoteFile.path.slice(podPrefix.length)
      : remoteFile.path;
    const localPath = this.getLocalPath(podName, filePath);

    // Ensure directory exists
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        let data: Buffer;

        // Use ChunkManager for chunked files
        if (remoteFile.isChunked && this.chunkManager) {
          data = await this.chunkManager.downloadLargeFile(
            remoteFile.swarmRef,
            this.onProgress
              ? (progress: DownloadProgress) => this.onProgress!({
                  phase: 'download',
                  file: remoteFile.path,
                  progress,
                })
              : undefined
          );
        } else {
          // Download directly from Swarm
          const rawData = await this.bee.downloadData(remoteFile.swarmRef as unknown as Reference);
          data = Buffer.from(rawData.toUint8Array());
        }

        // Write to local storage
        fs.writeFileSync(localPath, data);
        return;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < this.maxRetries) {
          await this.delay(this.baseDelayMs * Math.pow(2, attempt - 1));
        }
      }
    }

    throw lastError || new Error('Download failed');
  }

  /**
   * Build local file index from filesystem
   */
  private buildLocalIndex(): Map<string, { contentHash: string; path: string }> {
    const index = new Map<string, { contentHash: string; path: string }>();

    // Scan local storage
    const storagePath = this.config.localStoragePath.replace(/^~/, process.env.HOME || '');
    if (fs.existsSync(storagePath)) {
      this.scanDirectory(storagePath, '', index);
    }

    return index;
  }

  /**
   * Recursively scan directory for files
   */
  private scanDirectory(
    basePath: string,
    relativePath: string,
    index: Map<string, { contentHash: string; path: string }>
  ): void {
    const fullPath = path.join(basePath, relativePath);
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // Skip hidden files

      const entryRelativePath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        this.scanDirectory(basePath, entryRelativePath, index);
      } else if (entry.isFile()) {
        const filePath = path.join(fullPath, entry.name);
        const data = fs.readFileSync(filePath);
        const contentHash = keccak256(new Uint8Array(data));
        index.set('/' + entryRelativePath.replace(/\\/g, '/'), {
          contentHash,
          path: '/' + entryRelativePath.replace(/\\/g, '/'),
        });
      }
    }
  }

  /**
   * Derive metadata encryption key
   */
  private async deriveMetadataKey(encryptionKey: Uint8Array): Promise<Uint8Array> {
    const derivationInput = Buffer.concat([
      Buffer.from(encryptionKey),
      Buffer.from(':sync_metadata'),
    ]);
    const hash = keccak256(derivationInput);
    return new Uint8Array(Buffer.from(hash.slice(2), 'hex'));
  }

  /**
   * Get local file path
   */
  private getLocalPath(podName: string, filePath: string): string {
    // Validate inputs to prevent path traversal
    if (podName.includes('..') || podName.includes('/') || podName.includes('\\')) {
      throw new Error('Invalid pod name: contains path traversal characters');
    }
    if (filePath.includes('..')) {
      throw new Error('Invalid file path: contains path traversal characters');
    }

    // Expand ~ to home directory
    const storagePath = this.config.localStoragePath.replace(
      /^~/,
      process.env.HOME || ''
    );
    const result = path.join(storagePath, podName, filePath);

    // Verify result is within storage path
    const resolved = path.resolve(result);
    const resolvedBase = path.resolve(storagePath);
    if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
      throw new Error('Path traversal detected');
    }

    // L2: Check symlinks don't escape storage directory
    if (fs.existsSync(resolved)) {
      const realResolved = fs.realpathSync(resolved);
      const realBase = fs.realpathSync(resolvedBase);
      if (!realResolved.startsWith(realBase + path.sep) && realResolved !== realBase) {
        throw new Error('Symlink target outside storage directory');
      }
    }

    return result;
  }

  /**
   * Ensure local storage directory exists
   */
  private ensureLocalStorage(): void {
    const storagePath = this.config.localStoragePath.replace(
      /^~/,
      process.env.HOME || ''
    );
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }
  }

  /**
   * Generate unique change ID
   */
  private generateChangeId(): string {
    return `change_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate topic hash from string
   */
  private getTopicHash(topic: string): Topic {
    const hash = keccak256(toUtf8Bytes(topic));
    // Return first 32 bytes as Topic (without 0x prefix)
    return hash.slice(2, 66) as unknown as Topic;
  }

  /**
   * Load pending changes from disk (unencrypted)
   */
  private loadPendingChanges(): void {
    const metaPath = path.join(
      this.config.localStoragePath.replace(/^~/, process.env.HOME || ''),
      '.sync_meta.json'
    );

    if (fs.existsSync(metaPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        this.pendingChanges = data.pendingChanges || [];
        this.conflicts = data.conflicts || [];
        this.lastSync = data.lastSync || null;
      } catch (e) {
        // Failed to parse sync metadata - start fresh
      }
    }
  }

  /**
   * Load pending changes from encrypted storage
   */
  private async loadPendingChangesEncrypted(): Promise<void> {
    if (!this.metadataKey) return;

    const metaPath = path.join(
      this.config.localStoragePath.replace(/^~/, process.env.HOME || ''),
      '.sync_meta.enc'
    );

    if (fs.existsSync(metaPath)) {
      try {
        const encrypted = fs.readFileSync(metaPath);

        // Format: IV (16) || ciphertext
        const iv = encrypted.subarray(0, 16);
        const ciphertext = encrypted.subarray(16);

        const decipher = crypto.createDecipheriv(
          'aes-256-ctr',
          Buffer.from(this.metadataKey),
          iv
        );
        const decrypted = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);

        const data = JSON.parse(decrypted.toString('utf-8'));
        this.pendingChanges = data.pendingChanges || [];
        this.conflicts = data.conflicts || [];
        this.lastSync = data.lastSync || null;
      } catch (e) {
        // Failed to decrypt sync metadata - key may have changed
      }
    }
  }

  /**
   * Save pending changes to disk (encrypted if key available)
   */
  private async savePendingChanges(): Promise<void> {
    const storagePath = this.config.localStoragePath.replace(
      /^~/,
      process.env.HOME || ''
    );

    const data = JSON.stringify({
      pendingChanges: this.pendingChanges,
      conflicts: this.conflicts,
      lastSync: this.lastSync,
    });

    if (this.metadataKey) {
      // Save encrypted
      const metaPath = path.join(storagePath, '.sync_meta.enc');

      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(
        'aes-256-ctr',
        Buffer.from(this.metadataKey),
        iv
      );
      const ciphertext = Buffer.concat([
        cipher.update(data, 'utf-8'),
        cipher.final(),
      ]);

      // Format: IV (16) || ciphertext
      const encrypted = Buffer.concat([iv, ciphertext]);

      try {
        fs.writeFileSync(metaPath, encrypted);
      } catch (e) {
        console.error('Failed to save encrypted sync metadata:', e);
      }

      // Remove old unencrypted file if it exists
      const oldPath = path.join(storagePath, '.sync_meta.json');
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    } else {
      // Save unencrypted (fallback)
      const metaPath = path.join(storagePath, '.sync_meta.json');
      try {
        fs.writeFileSync(metaPath, data);
      } catch (e) {
        console.error('Failed to save sync metadata:', e);
      }
    }
  }
}
