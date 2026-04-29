/**
 * File operations for Fairdrive
 *
 * Handles upload, download, listing, and deletion of files within pods.
 * Files are encrypted with AES-256-GCM before upload to Swarm (privacy-by-default).
 *
 * Security features:
 * - Privacy-by-default: All files encrypted unless explicitly disabled
 * - AES-256-GCM: Authenticated encryption with AEAD
 * - PBKDF2-SHA256: 100,000+ iterations for key derivation
 * - Encrypted file indexes: Pod structure not visible to observers
 * - Per-file encryption keys derived from pod key + pod name + file path
 * - Authentication tags verify data integrity
 */

import { Bee, Reference } from '@ethersphere/bee-js';
import { keccak256, toUtf8Bytes, hexlify } from 'ethers';
import * as crypto from 'crypto';
import { getCryptoProvider, type CryptoProvider } from '../crypto/CryptoProvider.js';
import { ACT } from '../access/ACT.js';
import type { ACTConfig, EncryptResult } from '../access/ACT.js';
import type { StamperUploader } from '../upload/StamperUploader.js';

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  contentType: string;
  swarmRef?: string;
  encrypted: boolean;
  encryptionVersion?: number; // 1 = AES-256-GCM + PBKDF2, undefined = legacy/unencrypted
  encryptionKeyHash?: string; // Hash of key for verification, NOT the key itself
  iv?: string; // Hex encoded IV (12 bytes for GCM, 16 for legacy CTR)
  authTag?: string; // Hex encoded auth tag (16 bytes, GCM only)
  createdAt: string;
  modifiedAt: string;
}

/**
 * File index structure - uses Record (JSON-serializable) not Map
 */
export interface FileIndex {
  version: number;
  files: Record<string, FileInfo>; // path -> FileInfo
  lastModified: string;
  indexHash?: string; // For integrity verification
}

export interface FileManagerConfig {
  beeUrl: string;
  postageBatchId?: string;
  /** Optional Bee instance for dependency injection (testing) */
  bee?: Bee;
  /** Optional StamperUploader for client-side chunk stamping (gateway-agnostic uploads) */
  stamperUploader?: StamperUploader;
  /** Owner address for feed operations (enables feed-based index persistence) */
  ownerAddress?: string;
  /** Private key (hex string without 0x prefix) for signing feed updates */
  privateKey?: string;
}

export interface UploadOptions {
  contentType?: string;
  /** Set to true to skip encryption (NOT recommended) */
  unencrypted?: boolean;
  /** Conflict resolution strategy (default: newer_wins) */
  conflictStrategy?: 'newer_wins' | 'overwrite' | 'skip' | 'rename';
}

export class FileManager {
  private config: FileManagerConfig;
  private bee: Bee;
  private crypto: CryptoProvider;

  // In-memory cache of file indexes per pod
  private indexCache: Map<string, FileIndex> = new Map();

  constructor(config: FileManagerConfig) {
    this.config = config;
    this.bee = config.bee ?? new Bee(config.beeUrl);
    this.crypto = getCryptoProvider(); // Isomorphic: Node.js or Web Crypto
  }

  /**
   * Upload file to pod with encryption (privacy-by-default)
   */
  async upload(
    podName: string,
    path: string,
    content: Buffer | Uint8Array,
    encryptionKey: Uint8Array,
    options: UploadOptions = {}
  ): Promise<FileInfo> {
    const now = new Date().toISOString();
    const fileName = path.split('/').pop() || path;
    const contentType = options.contentType ?? 'application/octet-stream';

    // Normalize path
    const normalizedPath = path.startsWith('/') ? path : '/' + path;

    // Conflict resolution: check existing file before uploading to Swarm
    const strategy = options.conflictStrategy ?? 'newer_wins';
    if (strategy !== 'overwrite') {
      const existingIndex = await this.loadFileIndex(podName, encryptionKey);
      const existingFile = existingIndex.files[normalizedPath];
      if (existingFile) {
        const existingModified = new Date(existingFile.modifiedAt).getTime();
        const currentModified = Date.now();

        switch (strategy) {
          case 'skip':
            // Always keep existing
            return existingFile;
          case 'newer_wins':
            // Skip if existing is newer or equal
            if (existingModified >= currentModified) {
              return existingFile;
            }
            // Current is newer, proceed with upload
            break;
          case 'rename': {
            // Upload with conflict suffix
            const ext = normalizedPath.lastIndexOf('.');
            const conflictSuffix = `${Math.floor(Date.now() / 1000)}_${crypto.randomBytes(3).toString('hex')}`;
            const conflictPath = ext > 0
              ? `${normalizedPath.slice(0, ext)}_conflict_${conflictSuffix}${normalizedPath.slice(ext)}`
              : `${normalizedPath}_conflict_${conflictSuffix}`;
            return this.upload(podName, conflictPath, content, encryptionKey, {
              ...options,
              conflictStrategy: 'overwrite', // Don't recurse conflict checks
            });
          }
        }
      }
    }

    // PRIVACY-BY-DEFAULT: Encrypt unless explicitly disabled
    let dataToUpload: Uint8Array = content instanceof Buffer ? new Uint8Array(content) : content;
    let iv: Uint8Array | undefined;
    let authTag: Uint8Array | undefined;
    let encryptionKeyHash: string | undefined;
    let encrypted = true;
    let encryptionVersion: number | undefined = 1; // AES-256-GCM + PBKDF2

    if (!options.unencrypted) {
      // Derive file-specific key from pod key + path (using PBKDF2)
      const fileKey = await this.deriveFileKey(encryptionKey, podName, normalizedPath);

      try {
        const encryptResult = await this.encrypt(dataToUpload, fileKey);
        dataToUpload = encryptResult.ciphertext;
        iv = encryptResult.iv;
        authTag = encryptResult.authTag;

        // Store hash of key for verification (NOT the key itself)
        encryptionKeyHash = keccak256(fileKey).slice(0, 18); // First 8 bytes as hex
      } finally {
        // Zero the file key
        fileKey.fill(0);
      }
    } else {
      encrypted = false;
      encryptionVersion = undefined;
    }

    // Upload to Swarm via StamperUploader (client-side stamping) or legacy path
    let swarmRef: string | undefined;
    if (this.config.stamperUploader) {
      const ref = await this.config.stamperUploader.upload(dataToUpload);
      swarmRef = ref.toHex();
    } else if (this.config.postageBatchId) {
      const result = await this.bee.uploadData(
        this.config.postageBatchId,
        dataToUpload
      );
      swarmRef = typeof result.reference === 'string'
        ? result.reference
        : result.reference.toString();
    }

    const fileInfo: FileInfo = {
      name: fileName,
      path: normalizedPath,
      size: content.length,
      contentType,
      swarmRef,
      encrypted,
      encryptionVersion,
      encryptionKeyHash,
      iv: iv ? Buffer.from(iv).toString('hex') : undefined,
      authTag: authTag ? Buffer.from(authTag).toString('hex') : undefined,
      createdAt: now,
      modifiedAt: now,
    };

    // Update file index
    await this.updateFileIndex(podName, fileInfo, encryptionKey);

    return fileInfo;
  }

  /**
   * Download file from pod with decryption
   */
  async download(
    podName: string,
    path: string,
    encryptionKey: Uint8Array
  ): Promise<Buffer> {
    // Get file info from index
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    const index = await this.loadFileIndex(podName, encryptionKey);
    const fileInfo = index.files[normalizedPath];

    if (!fileInfo) {
      throw new Error(`File not found: ${normalizedPath}`);
    }

    if (!fileInfo.swarmRef) {
      throw new Error(`File has no Swarm reference: ${normalizedPath}`);
    }

    // Download from Swarm
    // bee-js v10 returns Bytes object, convert to Uint8Array
    const downloadedBytes = await this.bee.downloadData(fileInfo.swarmRef);
    const data = downloadedBytes.toUint8Array();

    // Decrypt if encrypted
    if (fileInfo.encrypted && fileInfo.iv) {
      // Version 1: AES-256-GCM + PBKDF2
      if (fileInfo.encryptionVersion === 1 && fileInfo.authTag) {
        const fileKey = await this.deriveFileKey(encryptionKey, podName, normalizedPath);
        const iv = Buffer.from(fileInfo.iv, 'hex');
        const authTag = Buffer.from(fileInfo.authTag, 'hex');

        try {
          const decrypted = await this.decrypt(
            new Uint8Array(data),
            fileKey,
            new Uint8Array(iv),
            new Uint8Array(authTag)
          );
          return Buffer.from(decrypted);
        } finally {
          fileKey.fill(0);
        }
      }

      // Legacy: unencrypted or old AES-CTR (no authTag)
      console.warn(`File ${normalizedPath} uses legacy encryption or is unencrypted`);
      // For legacy files, we could implement backward compatibility here if needed
      throw new Error(`Legacy encryption not yet supported. File: ${normalizedPath}`);
    }

    return Buffer.from(data);
  }

  /**
   * Download file by reference only (for unencrypted or externally encrypted files)
   */
  async downloadByRef(swarmRef: string): Promise<Buffer> {
    const downloadedBytes = await this.bee.downloadData(swarmRef);
    return Buffer.from(downloadedBytes.toUint8Array());
  }

  /**
   * List files in pod/path
   */
  async list(podName: string, path: string = '/', encryptionKey: Uint8Array): Promise<FileInfo[]> {
    const index = await this.loadFileIndex(podName, encryptionKey);
    const normalizedPath = path.endsWith('/') ? path : path + '/';

    // Filter files by path prefix
    return Object.values(index.files).filter(f => {
      // Direct match
      if (f.path === path) return true;

      // Files in directory (but not subdirectories for shallow listing)
      if (path === '/') {
        // Root level: count slashes to determine depth
        const pathParts = f.path.split('/').filter(p => p);
        return pathParts.length === 1;
      }

      // Check if file is directly in the specified path
      const parentPath = f.path.substring(0, f.path.lastIndexOf('/') + 1);
      return parentPath === normalizedPath;
    });
  }

  /**
   * List all files in pod (recursive)
   */
  async listAll(podName: string, encryptionKey: Uint8Array): Promise<FileInfo[]> {
    const index = await this.loadFileIndex(podName, encryptionKey);
    return Object.values(index.files);
  }

  /**
   * Delete file from pod (marks as deleted in index)
   */
  async delete(podName: string, path: string, encryptionKey: Uint8Array): Promise<boolean> {
    const normalizedPath = path.startsWith('/') ? path : '/' + path;

    // Load current index
    const index = await this.loadFileIndex(podName, encryptionKey);

    // Check if file exists
    if (!index.files[normalizedPath]) {
      return false;
    }

    // Remove from index
    delete index.files[normalizedPath];
    index.lastModified = new Date().toISOString();

    // Persist updated index
    await this.persistFileIndex(podName, index, encryptionKey);

    // Update cache
    this.indexCache.set(podName, index);

    // Note: Data persists on Swarm (immutable) but is no longer indexed
    return true;
  }

  /**
   * Check if file exists
   */
  async exists(podName: string, path: string, encryptionKey: Uint8Array): Promise<boolean> {
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    const index = await this.loadFileIndex(podName, encryptionKey);
    return normalizedPath in index.files;
  }

  /**
   * Get file info without downloading
   */
  async getInfo(podName: string, path: string, encryptionKey: Uint8Array): Promise<FileInfo | null> {
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    const index = await this.loadFileIndex(podName, encryptionKey);
    return index.files[normalizedPath] || null;
  }

  // ============ Sharing Methods ============

  /**
   * Share a file with a recipient using ACT encryption.
   *
   * Downloads the file, encrypts with a random DEK via ACT, grants access
   * to the recipient, and returns the ACT reference for the recipient to use.
   *
   * @param podName - Pod containing the file
   * @param path - File path within the pod
   * @param encryptionKey - Pod encryption key (to decrypt the file)
   * @param ownerAddress - Owner's Ethereum address
   * @param ownerPublicKey - Owner's public key (hex, for self-decryption)
   * @param ownerPrivateKey - Owner's private key (for signing)
   * @param recipientAddress - Recipient's Ethereum address
   * @param recipientPublicKey - Recipient's public key (hex, for ECIES encryption)
   * @returns ACT reference and content reference
   */
  async shareFile(
    podName: string,
    path: string,
    encryptionKey: Uint8Array,
    ownerAddress: string,
    ownerPublicKey: string,
    ownerPrivateKey: Uint8Array,
    recipientAddress: string,
    recipientPublicKey: string
  ): Promise<{ actRef: string; contentRef: string }> {
    if (!this.config.postageBatchId) {
      throw new Error('No postage batch ID configured');
    }

    // Download and decrypt the file
    const content = await this.download(podName, path, encryptionKey);

    // Create ACT instance
    const act = new ACT({
      beeUrl: this.config.beeUrl,
      postageBatchId: this.config.postageBatchId,
      bee: this.bee,
    });

    // Encrypt with ACT and grant to recipient
    const result = await act.encrypt(
      content,
      ownerAddress,
      ownerPublicKey,
      ownerPrivateKey,
      [{ address: recipientAddress, publicKey: recipientPublicKey }]
    );

    return { actRef: result.actRef, contentRef: result.contentRef };
  }

  /**
   * Receive a shared file and save it to a pod.
   *
   * Decrypts the shared file using ACT, then re-encrypts and uploads
   * to the recipient's pod.
   *
   * @param actRef - ACT reference from the sharer
   * @param callerAddress - Recipient's Ethereum address
   * @param callerPrivateKey - Recipient's private key (for ACT decryption)
   * @param targetPodName - Pod to save the file to
   * @param targetPath - Path within the pod
   * @param targetEncryptionKey - Target pod's encryption key
   * @returns FileInfo of the saved file
   */
  async receiveSharedFile(
    actRef: string,
    callerAddress: string,
    callerPrivateKey: Uint8Array,
    targetPodName: string,
    targetPath: string,
    targetEncryptionKey: Uint8Array
  ): Promise<FileInfo> {
    // Create ACT instance
    const act = new ACT({
      beeUrl: this.config.beeUrl,
      postageBatchId: this.config.postageBatchId,
      bee: this.bee,
    });

    // Decrypt the shared content
    const content = await act.decrypt(actRef, callerAddress, callerPrivateKey);

    // Upload to recipient's pod (re-encrypted with pod key)
    return this.upload(targetPodName, targetPath, content, targetEncryptionKey, {
      conflictStrategy: 'rename',
    });
  }

  // ============ Private Methods ============

  /**
   * Derive file-specific encryption key using PBKDF2
   */
  private async deriveFileKey(podKey: Uint8Array, podName: string, filePath: string): Promise<Uint8Array> {
    // Include pod name in salt for uniqueness across pods
    const salt = new TextEncoder().encode(`fairdrive:v1:${podName}:${filePath}`);

    // PBKDF2 with 100,000 iterations (OWASP minimum for 2023+)
    const fileKey = await this.crypto.deriveKey(podKey, salt, 100000);
    return fileKey;
  }

  /**
   * Load file index from pod
   *
   * Workflow:
   * 1. Check cache first (performance optimization)
   * 2. Try desktop format feed first (fairdrive:pod:{podName}, unencrypted)
   * 3. Fall back to v1 encrypted format (fairdrive:v1:{podName}:file-index)
   * 4. Return parsed FileIndex
   */
  private async loadFileIndex(podName: string, encryptionKey: Uint8Array): Promise<FileIndex> {
    // Check cache first
    const cached = this.indexCache.get(podName);
    if (cached) {
      return cached;
    }

    // Try to load from Swarm feed if owner address available
    if (this.config.ownerAddress) {
      // First, try desktop format (unencrypted PodIndex at fairdrive:pod:{podName})
      try {
        const desktopTopic = this.getDesktopFeedTopic(podName);
        const feedReader = this.bee.makeFeedReader(desktopTopic, this.config.ownerAddress);
        const result = await feedReader.downloadPayload();
        const data = result.payload.toUint8Array();
        const jsonData = JSON.parse(new TextDecoder().decode(data));

        // Parse desktop PodIndex format
        if (jsonData.version !== undefined && Array.isArray(jsonData.files)) {
          console.log(`Loaded desktop format index for pod ${podName}: ${jsonData.files.length} files`);
          const index = this.convertDesktopPodIndex(jsonData);
          this.indexCache.set(podName, index);
          return index;
        }
      } catch (e) {
        // Desktop feed doesn't exist, try v1 encrypted format
        console.log(`No desktop index for pod ${podName}, trying v1 format...`);
      }

      // Try v1 encrypted format
      try {
        const topic = this.getFeedTopic(podName, 'file-index');
        const feedReader = this.bee.makeFeedReader(topic, this.config.ownerAddress);
        const result = await feedReader.downloadPayload();
        const encryptedData: Uint8Array = result.payload.toUint8Array();

        // Derive index encryption key
        const indexKey = await this.deriveIndexKey(encryptionKey, podName);

        try {
          // Parse encrypted data: IV (12 bytes) || authTag (16 bytes) || ciphertext
          const iv = encryptedData.subarray(0, 12);
          const authTag = encryptedData.subarray(12, 28);
          const ciphertext = encryptedData.subarray(28);

          // Decrypt
          const plaintext = await this.crypto.decrypt(ciphertext, indexKey, iv, authTag);

          // Parse JSON
          const index = JSON.parse(new TextDecoder().decode(plaintext)) as FileIndex;

          // Cache and return
          this.indexCache.set(podName, index);
          return index;
        } finally {
          // Zero the index key
          indexKey.fill(0);
        }
      } catch (e) {
        // Feed doesn't exist yet or error reading - return empty index
        // This is normal on first use
        console.log(`Could not load index for pod ${podName}, starting fresh:`, (e as Error).message);
      }
    }

    // No feed or error loading - return empty index (will be populated by uploads)
    const emptyIndex: FileIndex = {
      version: 1,
      files: {},
      lastModified: new Date().toISOString(),
    };

    this.indexCache.set(podName, emptyIndex);
    return emptyIndex;
  }

  /**
   * Generate desktop feed topic (fairdrive:pod:{podName})
   */
  private getDesktopFeedTopic(podName: string): string {
    const topicString = `fairdrive:pod:${podName}`;
    const hash = keccak256(toUtf8Bytes(topicString));
    return hash.slice(2, 66);
  }

  /**
   * Convert desktop PodIndex format to web FileIndex format
   */
  private convertDesktopPodIndex(podIndex: {
    version: number;
    name: string;
    createdAt: number;
    updatedAt: number;
    files: Array<{
      path: string;
      name: string;
      size: number;
      reference: string;
      contentType: string;
      hash?: string;
      modifiedAt: number;
      mode?: number;
      encrypted: boolean;
      encryptionVersion?: number;
      iv?: number[];
      authTag?: number[];
    }>;
    dirs?: Array<{
      path: string;
      name: string;
      createdAt: number;
      modifiedAt: number;
      mode?: number;
    }>;
  }): FileIndex {
    const files: Record<string, FileInfo> = {};

    for (const file of podIndex.files) {
      const normalizedPath = file.path.startsWith('/') ? file.path : '/' + file.path;
      files[normalizedPath] = {
        name: file.name,
        path: normalizedPath,
        size: file.size,
        contentType: file.contentType || 'application/octet-stream',
        swarmRef: file.reference,
        encrypted: file.encrypted,
        encryptionVersion: file.encryptionVersion,
        // Convert byte arrays to hex strings
        iv: file.iv ? Buffer.from(file.iv).toString('hex') : undefined,
        authTag: file.authTag ? Buffer.from(file.authTag).toString('hex') : undefined,
        createdAt: new Date(podIndex.createdAt * 1000).toISOString(),
        modifiedAt: new Date(file.modifiedAt * 1000).toISOString(),
      };
    }

    return {
      version: podIndex.version,
      files,
      lastModified: new Date(podIndex.updatedAt * 1000).toISOString(),
    };
  }

  /**
   * Update file index with new/modified file
   */
  private async updateFileIndex(
    podName: string,
    fileInfo: FileInfo,
    encryptionKey: Uint8Array
  ): Promise<void> {
    const index = await this.loadFileIndex(podName, encryptionKey);

    // Add/update file entry
    index.files[fileInfo.path] = fileInfo;
    index.lastModified = new Date().toISOString();

    // Persist to Swarm
    await this.persistFileIndex(podName, index, encryptionKey);

    // Update cache
    this.indexCache.set(podName, index);
  }

  /**
   * Persist file index to Swarm (encrypted)
   *
   * TODO (Phase 4): Update to use feeds for proper index persistence.
   * Required changes:
   * 1. Add privateKey parameter (from wallet/key management)
   * 2. After uploading encrypted data, create feed writer
   * 3. Update feed with: writer.upload(batchId, reference)
   * This enables loadFileIndex to retrieve the latest index from the feed
   */
  private async persistFileIndex(
    podName: string,
    index: FileIndex,
    encryptionKey: Uint8Array
  ): Promise<string | null> {
    if (!this.config.postageBatchId) {
      return null;
    }

    // Serialize index
    const plaintext = JSON.stringify(index);

    // Derive index encryption key from pod key
    const indexKey = await this.deriveIndexKey(encryptionKey, podName);

    try {
      // Encrypt index with GCM
      const encrypted = await this.encrypt(
        Buffer.from(plaintext, 'utf8'),
        indexKey
      );

      // Combine IV + authTag + ciphertext
      const encryptedData = Buffer.concat([
        Buffer.from(encrypted.iv),
        Buffer.from(encrypted.authTag),
        Buffer.from(encrypted.ciphertext),
      ]);

      // Upload encrypted index via StamperUploader or legacy path
      let indexRef: Reference | string;
      if (this.config.stamperUploader) {
        indexRef = await this.config.stamperUploader.upload(new Uint8Array(encryptedData));
      } else {
        const result = await this.bee.uploadData(
          this.config.postageBatchId,
          new Uint8Array(encryptedData)
        );
        indexRef = result.reference;
      }

      // Update feed with reference if private key available
      if (this.config.privateKey) {
        const topic = this.getFeedTopic(podName, 'file-index');

        if (this.config.stamperUploader) {
          // Client-side SOC stamping for feed write
          // indexRef is a Reference from stamperUploader.upload()
          await this.config.stamperUploader.writeFeedReference(
            topic,
            indexRef as Reference,
            this.config.privateKey,
          );
        } else {
          // Legacy: server-side stamping via feedWriter
          // indexRef is result.reference from bee.uploadData()
          const writer = this.bee.makeFeedWriter(topic, this.config.privateKey);
          try {
            await writer.uploadReference(this.config.postageBatchId, indexRef as Reference);
          } catch (e: unknown) {
            if (e instanceof Error && e.message.includes('404')) {
              await writer.uploadReference(this.config.postageBatchId, indexRef as Reference, {
                index: 0,
              });
            } else {
              throw e;
            }
          }
        }
      }

      // Convert reference to string
      return indexRef instanceof Reference
        ? indexRef.toHex()
        : String(indexRef);
    } finally {
      indexKey.fill(0);
    }
  }

  /**
   * Generate deterministic feed topic for pod resources
   *
   * @param podName Pod name
   * @param resourceType Resource type (e.g., 'file-index', 'metadata')
   * @returns Topic hash (first 32 bytes of keccak256 hash)
   */
  private getFeedTopic(podName: string, resourceType: string): string {
    const topicString = `fairdrive:v1:${podName}:${resourceType}`;
    const hash = keccak256(toUtf8Bytes(topicString));
    // Return first 32 bytes (64 hex chars) as Topic
    return hash.slice(2, 66);
  }

  /**
   * Derive index encryption key using PBKDF2
   */
  private async deriveIndexKey(podKey: Uint8Array, podName: string): Promise<Uint8Array> {
    // Use a different salt format for index vs files
    const salt = new TextEncoder().encode(`fairdrive:v1:${podName}:index`);

    // PBKDF2 with 100,000 iterations (OWASP minimum for 2023+)
    const indexKey = await this.crypto.deriveKey(podKey, salt, 100000);
    return indexKey;
  }

  /**
   * Encrypt data with AES-256-GCM (authenticated encryption)
   */
  private async encrypt(
    data: Uint8Array,
    key: Uint8Array
  ): Promise<{ ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }> {
    return this.crypto.encrypt(data, key);
  }

  /**
   * Decrypt data with AES-256-GCM (authenticated decryption)
   */
  private async decrypt(
    ciphertext: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array,
    authTag: Uint8Array
  ): Promise<Uint8Array> {
    return this.crypto.decrypt(ciphertext, key, iv, authTag);
  }

  /**
   * Clear index cache for a pod
   */
  clearCache(podName?: string): void {
    if (podName) {
      this.indexCache.delete(podName);
    } else {
      this.indexCache.clear();
    }
  }

  // ============ Static Methods ============

  /**
   * Generate encryption key from password/seed
   */
  static async deriveKey(seed: string): Promise<Uint8Array> {
    const hash = keccak256(toUtf8Bytes(seed));
    return new Uint8Array(Buffer.from(hash.slice(2), 'hex'));
  }

  /**
   * Calculate content hash (for verification)
   */
  static contentHash(data: Uint8Array): string {
    return keccak256(data);
  }
}
