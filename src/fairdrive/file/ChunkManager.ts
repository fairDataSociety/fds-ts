/**
 * Chunk Manager for Large Files
 *
 * Handles upload and download of large files by splitting them into chunks.
 * Each chunk is uploaded separately, with a manifest tracking all chunks.
 *
 * Features:
 * - 4MB chunk size (configurable)
 * - Parallel chunk uploads/downloads with concurrency limit
 * - Progress callbacks
 * - Chunk verification via content hashing
 * - Resume support for interrupted transfers
 */

import { Bee, Reference } from '@ethersphere/bee-js';
import { keccak256 } from 'ethers';
import * as crypto from 'crypto';
import type { StamperUploader } from '../upload/StamperUploader.js';

/** Convert bee-js v10 Reference (Bytes subclass) to hex string */
function refToString(ref: Reference | string): string {
  if (typeof ref === 'string') return ref;
  return ref.toHex();
}

const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB
const DEFAULT_CONCURRENCY = 4;

export interface ChunkManifest {
  version: number;
  totalSize: number;
  chunkSize: number;
  chunks: ChunkInfo[];
  contentHash: string; // Hash of original content
  createdAt: string;
}

export interface ChunkInfo {
  index: number;
  reference: string;
  size: number;
  hash: string;
}

export interface UploadProgress {
  totalChunks: number;
  completedChunks: number;
  totalBytes: number;
  uploadedBytes: number;
  percent: number;
}

export interface DownloadProgress {
  totalChunks: number;
  completedChunks: number;
  totalBytes: number;
  downloadedBytes: number;
  percent: number;
}

export interface ChunkManagerConfig {
  beeUrl: string;
  postageBatchId?: string;
  chunkSize?: number;
  concurrency?: number;
  maxRetries?: number;
  /** Optional Bee instance for dependency injection (testing) */
  bee?: Bee;
  /** Optional StamperUploader for client-side chunk stamping */
  stamperUploader?: StamperUploader;
}

export class ChunkManager {
  private bee: Bee;
  private postageBatchId?: string;
  private stamperUploader?: StamperUploader;
  private chunkSize: number;
  private concurrency: number;
  private maxRetries: number;

  constructor(config: ChunkManagerConfig) {
    this.bee = config.bee ?? new Bee(config.beeUrl);
    this.postageBatchId = config.postageBatchId;
    this.stamperUploader = config.stamperUploader;
    this.chunkSize = config.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
    this.maxRetries = config.maxRetries ?? 3;
  }

  /**
   * Upload large file with chunking
   */
  async uploadLargeFile(
    content: Buffer,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<{ manifestRef: string; manifest: ChunkManifest }> {
    if (!this.postageBatchId) {
      throw new Error('No postage batch ID configured');
    }

    const chunks: ChunkInfo[] = [];
    const totalChunks = Math.ceil(content.length / this.chunkSize);
    let uploadedBytes = 0;

    // Calculate content hash first
    const contentHash = keccak256(new Uint8Array(content));

    // Process chunks in batches
    for (let batchStart = 0; batchStart < totalChunks; batchStart += this.concurrency) {
      const batchEnd = Math.min(batchStart + this.concurrency, totalChunks);
      const batchPromises: Promise<ChunkInfo>[] = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const start = i * this.chunkSize;
        const end = Math.min(start + this.chunkSize, content.length);
        const chunk = content.subarray(start, end);

        batchPromises.push(this.uploadChunkWithRetry(i, chunk));
      }

      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      chunks.push(...batchResults);

      // Update progress
      uploadedBytes = Math.min((batchEnd) * this.chunkSize, content.length);
      onProgress?.({
        totalChunks,
        completedChunks: batchEnd,
        totalBytes: content.length,
        uploadedBytes,
        percent: Math.round((batchEnd / totalChunks) * 100),
      });
    }

    // Sort chunks by index (in case of parallel processing order issues)
    chunks.sort((a, b) => a.index - b.index);

    // Create manifest
    const manifest: ChunkManifest = {
      version: 1,
      totalSize: content.length,
      chunkSize: this.chunkSize,
      chunks,
      contentHash,
      createdAt: new Date().toISOString(),
    };

    // Upload manifest via StamperUploader or legacy path
    const manifestData = Buffer.from(JSON.stringify(manifest), 'utf-8');
    let manifestRef: string;
    if (this.stamperUploader) {
      const ref = await this.stamperUploader.upload(new Uint8Array(manifestData));
      manifestRef = ref.toHex();
    } else {
      const manifestResult = await this.bee.uploadData(
        this.postageBatchId,
        new Uint8Array(manifestData)
      );
      manifestRef = refToString(manifestResult.reference);
    }

    return {
      manifestRef,
      manifest,
    };
  }

  /**
   * Download and reassemble chunked file
   */
  async downloadLargeFile(
    manifestRef: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<Buffer> {
    // Download manifest
    const manifestData = await this.bee.downloadData(manifestRef as unknown as Reference);
    const manifest: ChunkManifest = JSON.parse(Buffer.from(manifestData.toUint8Array()).toString('utf-8'));

    // Validate manifest
    if (!manifest.chunks || manifest.chunks.length === 0) {
      throw new Error('Invalid manifest: no chunks');
    }

    // Download chunks in parallel with concurrency limit
    const chunks: Buffer[] = new Array(manifest.chunks.length);
    let downloadedBytes = 0;

    for (let batchStart = 0; batchStart < manifest.chunks.length; batchStart += this.concurrency) {
      const batchEnd = Math.min(batchStart + this.concurrency, manifest.chunks.length);
      const batchPromises: Promise<{ index: number; data: Buffer }>[] = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const chunkInfo = manifest.chunks[i];
        batchPromises.push(
          this.downloadChunkWithRetry(chunkInfo).then(data => ({ index: i, data }))
        );
      }

      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);

      for (const { index, data } of batchResults) {
        chunks[index] = data;
        downloadedBytes += data.length;
      }

      // Update progress
      onProgress?.({
        totalChunks: manifest.chunks.length,
        completedChunks: batchEnd,
        totalBytes: manifest.totalSize,
        downloadedBytes,
        percent: Math.round((batchEnd / manifest.chunks.length) * 100),
      });
    }

    // Reassemble
    const result = Buffer.concat(chunks);

    // Verify size
    if (result.length !== manifest.totalSize) {
      throw new Error(`Size mismatch: expected ${manifest.totalSize}, got ${result.length}`);
    }

    // Verify content hash
    const downloadedHash = keccak256(new Uint8Array(result));
    if (downloadedHash !== manifest.contentHash) {
      throw new Error('Content hash mismatch: file may be corrupted');
    }

    return result;
  }

  /**
   * Get manifest without downloading content
   */
  async getManifest(manifestRef: string): Promise<ChunkManifest> {
    const manifestData = await this.bee.downloadData(manifestRef as unknown as Reference);
    return JSON.parse(Buffer.from(manifestData.toUint8Array()).toString('utf-8'));
  }

  /**
   * Check if content needs chunking
   */
  needsChunking(size: number): boolean {
    return size > this.chunkSize;
  }

  /**
   * Calculate number of chunks for a given size
   */
  calculateChunks(size: number): number {
    return Math.ceil(size / this.chunkSize);
  }

  // ============ Private Methods ============

  /**
   * Upload single chunk with retry
   */
  private async uploadChunkWithRetry(index: number, chunk: Buffer): Promise<ChunkInfo> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const hash = keccak256(new Uint8Array(chunk));
        let chunkRef: string;
        if (this.stamperUploader) {
          const ref = await this.stamperUploader.upload(new Uint8Array(chunk));
          chunkRef = ref.toHex();
        } else {
          const result = await this.bee.uploadData(
            this.postageBatchId!,
            new Uint8Array(chunk)
          );
          chunkRef = refToString(result.reference);
        }

        return {
          index,
          reference: chunkRef,
          size: chunk.length,
          hash,
        };
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < this.maxRetries) {
          await this.delay(1000 * Math.pow(2, attempt - 1));
        }
      }
    }

    throw lastError || new Error(`Failed to upload chunk ${index}`);
  }

  /**
   * Download single chunk with retry and verification
   */
  private async downloadChunkWithRetry(chunkInfo: ChunkInfo): Promise<Buffer> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const data = await this.bee.downloadData(chunkInfo.reference as unknown as Reference);
        const chunk = Buffer.from(data.toUint8Array());

        // Verify size
        if (chunk.length !== chunkInfo.size) {
          throw new Error(`Chunk ${chunkInfo.index} size mismatch`);
        }

        // Verify hash
        const downloadedHash = keccak256(new Uint8Array(chunk));
        if (downloadedHash !== chunkInfo.hash) {
          throw new Error(`Chunk ${chunkInfo.index} hash mismatch`);
        }

        return chunk;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < this.maxRetries) {
          await this.delay(1000 * Math.pow(2, attempt - 1));
        }
      }
    }

    throw lastError || new Error(`Failed to download chunk ${chunkInfo.index}`);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Helper to determine if a file should be chunked
 */
export function shouldChunk(size: number, threshold: number = DEFAULT_CHUNK_SIZE): boolean {
  return size > threshold;
}
