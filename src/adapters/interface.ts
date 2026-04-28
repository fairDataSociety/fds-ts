/**
 * StorageAdapter — the pluggable boundary.
 *
 * Every storage backend (Swarm, S3, IPFS, local filesystem) implements this interface.
 * Encryption happens ABOVE this layer in the SDK — all adapters get client-side
 * encryption for free.
 *
 * Design informed by:
 * - AWS S3 (bucket/key model, ListObjectsV2-style listing)
 * - Helia blockstore (pluggable storage backends)
 * - remoteStorage (GET/PUT/DELETE simplicity)
 *
 * The adapter operates on RAW bytes. It does not know about encryption, identity,
 * or access control. Those are SDK-layer concerns.
 */

import type { ObjectMeta, ListResult, BucketInfo, PutOptions, PutResult } from '../types.js'

// ─── Capabilities ───────────────────────────────────────

export interface AdapterCapabilities {
  /** Backend provides its own encryption (Swarm pods = true, S3 SSE = optional) */
  nativeEncryption: boolean
  /** Backend supports ACT-style granular sharing (Swarm = true) */
  nativeSharing: boolean
  /** Backend supports object versioning */
  versioning: boolean
  /** Backend supports streaming upload/download */
  streaming: boolean
  /** Backend can generate public URLs for objects */
  publicUrls: boolean
  /** Backend supports content-addressed references */
  contentAddressed: boolean
  /** Maximum object size (undefined = unlimited) */
  maxObjectSize?: number
}

// ─── Storage Adapter Interface ──────────────────────────

export interface StorageAdapter {
  /** Human-readable adapter name (e.g., 'swarm', 's3', 'local') */
  readonly name: string

  /** What this backend supports natively */
  readonly capabilities: AdapterCapabilities

  // ── Lifecycle ──────────────────────────────────────────

  /** Connect to the backend. Called once during FdsClient initialization. */
  connect(): Promise<void>

  /** Disconnect and release resources. */
  disconnect(): Promise<void>

  /** Check if the backend is reachable. */
  isConnected(): Promise<boolean>

  // ── Object Operations ─────────────────────────────────

  /**
   * Store an object.
   *
   * @param bucket - Bucket (pod) name
   * @param key - Object key (path within bucket, e.g., 'docs/report.pdf')
   * @param data - Raw bytes to store
   * @param opts - Optional: content type, conflict strategy
   * @returns Reference and metadata for the stored object
   */
  put(bucket: string, key: string, data: Uint8Array, opts?: PutOptions): Promise<PutResult>

  /**
   * Retrieve an object.
   *
   * @param bucket - Bucket name
   * @param key - Object key
   * @returns Raw bytes
   * @throws OBJECT_NOT_FOUND if key doesn't exist
   */
  get(bucket: string, key: string): Promise<Uint8Array>

  /**
   * Get object metadata without downloading content.
   *
   * @param bucket - Bucket name
   * @param key - Object key
   * @returns Metadata, or null if not found
   */
  head(bucket: string, key: string): Promise<ObjectMeta | null>

  /**
   * Delete an object.
   *
   * @param bucket - Bucket name
   * @param key - Object key
   * @throws OBJECT_NOT_FOUND if key doesn't exist
   */
  delete(bucket: string, key: string): Promise<void>

  /**
   * List objects in a bucket with optional prefix filter.
   * Follows S3 ListObjectsV2 semantics: returns objects AND common prefixes
   * (subdirectories).
   *
   * @param bucket - Bucket name
   * @param prefix - Optional key prefix (e.g., 'docs/' to list the docs directory)
   * @returns Objects matching the prefix + subdirectory prefixes
   */
  list(bucket: string, prefix?: string): Promise<ListResult>

  /**
   * Check if an object exists.
   *
   * @param bucket - Bucket name
   * @param key - Object key
   */
  exists(bucket: string, key: string): Promise<boolean>

  /**
   * Move/rename an object within a bucket.
   *
   * @param bucket - Bucket name
   * @param fromKey - Current key
   * @param toKey - New key
   */
  move(bucket: string, fromKey: string, toKey: string): Promise<void>

  // ── Bucket Operations ─────────────────────────────────

  /**
   * Create a new bucket.
   *
   * @param name - Bucket name
   * @throws if bucket already exists (adapter-dependent)
   */
  createBucket(name: string): Promise<void>

  /**
   * List all buckets.
   */
  listBuckets(): Promise<BucketInfo[]>

  /**
   * Delete a bucket.
   *
   * @param name - Bucket name
   * @throws if bucket is not empty (adapter-dependent)
   */
  deleteBucket(name: string): Promise<void>

  /**
   * Check if a bucket exists.
   */
  bucketExists(name: string): Promise<boolean>
}
