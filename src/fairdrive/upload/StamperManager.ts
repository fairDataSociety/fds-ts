/**
 * Stamper Lifecycle Manager
 *
 * Handles creation, persistence, and recovery of Stamper instances.
 * The Stamper maintains bucket state (which postage slots have been used),
 * so it must be persisted across sessions to avoid stamp collisions.
 *
 * Storage is pluggable via the StamperStore interface:
 * - Web: IndexedDB adapter
 * - Desktop/MCP: Filesystem adapter
 * - Testing: In-memory adapter (default)
 */

import { Stamper, Bee, PrivateKey, BatchId } from '@ethersphere/bee-js';

/**
 * Pluggable storage interface for Stamper bucket state.
 * Implementations should be platform-specific (IndexedDB, filesystem, etc.)
 */
export interface StamperStore {
  save(key: string, state: Uint32Array): Promise<void>;
  load(key: string): Promise<Uint32Array | null>;
  delete(key: string): Promise<void>;
}

/**
 * In-memory store for testing and ephemeral usage
 */
export class MemoryStamperStore implements StamperStore {
  private store = new Map<string, Uint32Array>();

  async save(key: string, state: Uint32Array): Promise<void> {
    // Clone to prevent mutation
    this.store.set(key, new Uint32Array(state));
  }

  async load(key: string): Promise<Uint32Array | null> {
    const state = this.store.get(key);
    return state ? new Uint32Array(state) : null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/** Derive a storage key from batch ID and signer address */
function deriveStoreKey(batchId: string, signerAddress: string): string {
  return `stamper:${batchId}:${signerAddress}`;
}

export interface StamperManagerConfig {
  /** Storage backend for bucket state persistence */
  store?: StamperStore;
  /** Optional Bee instance for querying batch depth from chain */
  bee?: Bee;
}

export class StamperManager {
  private store: StamperStore;
  private bee?: Bee;

  constructor(config?: StamperManagerConfig) {
    this.store = config?.store ?? new MemoryStamperStore();
    this.bee = config?.bee;
  }

  /**
   * Create a new Stamper from scratch (blank bucket state).
   *
   * @param signer  Private key (hex string or PrivateKey instance)
   * @param batchId Postage batch ID (64 hex chars)
   * @param depth   Stamp depth (determines bucket capacity)
   * @returns A fresh Stamper with empty buckets
   */
  create(
    signer: string | PrivateKey,
    batchId: string | BatchId,
    depth: number,
  ): Stamper {
    return Stamper.fromBlank(signer, batchId, depth);
  }

  /**
   * Create a Stamper, auto-detecting depth from the postage batch on chain.
   *
   * Requires a Bee instance connected to a node with debug API access.
   *
   * @param signer  Private key
   * @param batchId Postage batch ID
   * @returns A fresh Stamper with depth fetched from chain
   */
  async createWithAutoDepth(
    signer: string | PrivateKey,
    batchId: string | BatchId,
  ): Promise<Stamper> {
    if (!this.bee) {
      throw new Error('Bee instance required for auto-depth detection. Provide bee in config or use create() with explicit depth.');
    }
    const batchIdStr = typeof batchId === 'string' ? batchId : batchId.toHex();
    const batch = await this.bee.getPostageBatch(batchIdStr);
    return Stamper.fromBlank(signer, batchId, batch.depth);
  }

  /**
   * Save a Stamper's bucket state for later recovery.
   *
   * Call this after uploads to persist which postage slots have been used.
   * Without persistence, restarting would reuse slots and cause collisions.
   *
   * @param stamper The Stamper instance to save
   */
  async save(stamper: Stamper): Promise<void> {
    const signerAddress = stamper.signer.publicKey().address().toHex();
    const batchId = stamper.batchId.toHex();
    const key = deriveStoreKey(batchId, signerAddress);
    await this.store.save(key, stamper.getState());
  }

  /**
   * Restore a previously saved Stamper with its bucket state.
   *
   * @param signer  Same private key used when the Stamper was created
   * @param batchId Same batch ID
   * @param depth   Same depth
   * @returns The Stamper with restored bucket state, or null if no saved state
   */
  async restore(
    signer: string | PrivateKey,
    batchId: string | BatchId,
    depth: number,
  ): Promise<Stamper | null> {
    const signerKey = typeof signer === 'string' ? new PrivateKey(signer) : signer;
    const signerAddress = signerKey.publicKey().address().toHex();
    const batchIdStr = typeof batchId === 'string' ? batchId : batchId.toHex();
    const key = deriveStoreKey(batchIdStr, signerAddress);

    const state = await this.store.load(key);
    if (!state) return null;

    return Stamper.fromState(signer, batchId, state, depth);
  }

  /**
   * Restore a Stamper if saved state exists, otherwise create a fresh one.
   *
   * This is the recommended entry point for most use cases.
   *
   * @param signer  Private key
   * @param batchId Postage batch ID
   * @param depth   Stamp depth
   * @returns Stamper (restored or fresh)
   */
  async getOrCreate(
    signer: string | PrivateKey,
    batchId: string | BatchId,
    depth: number,
  ): Promise<Stamper> {
    const restored = await this.restore(signer, batchId, depth);
    if (restored) return restored;
    return this.create(signer, batchId, depth);
  }

  /**
   * Delete saved state for a Stamper.
   *
   * @param signer  Private key
   * @param batchId Postage batch ID
   */
  async clear(
    signer: string | PrivateKey,
    batchId: string | BatchId,
  ): Promise<void> {
    const signerKey = typeof signer === 'string' ? new PrivateKey(signer) : signer;
    const signerAddress = signerKey.publicKey().address().toHex();
    const batchIdStr = typeof batchId === 'string' ? batchId : batchId.toHex();
    const key = deriveStoreKey(batchIdStr, signerAddress);
    await this.store.delete(key);
  }
}
