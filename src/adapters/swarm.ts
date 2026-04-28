/**
 * SwarmAdapter — Fairdrive-backed StorageAdapter.
 *
 * Buckets = Fairdrive pods (encrypted containers on Swarm feeds).
 * Objects = encrypted files within pods.
 * Encryption is handled by FileManager (AES-256-GCM, privacy-by-default).
 *
 * This adapter wraps PodManager + FileManager from @fairdrive/core.
 * The encryption key is derived from the user's wallet via WalletManager.deriveKey().
 */

import { PodManager } from '@fairdrive/core'
import type { PodManagerConfig, Pod } from '@fairdrive/core'
import { FileManager } from '@fairdrive/core'
import type { FileManagerConfig, UploadOptions as CoreUploadOptions } from '@fairdrive/core'
import { WalletManager } from '@fairdrive/core'
import type { StorageAdapter, AdapterCapabilities } from './interface.js'
import type { ObjectMeta, ListResult, BucketInfo, PutOptions, PutResult } from '../types.js'
import { FdsError, FdsErrorCode } from '../errors.js'

export interface SwarmAdapterConfig {
  beeUrl: string
  batchId?: string
  /** Private key (hex, no 0x prefix) for feed signing */
  privateKey?: string
  /** Owner address (derived from privateKey if not provided) */
  ownerAddress?: string
}

export class SwarmAdapter implements StorageAdapter {
  readonly name = 'swarm'
  readonly capabilities: AdapterCapabilities = {
    nativeEncryption: true,
    nativeSharing: true,
    versioning: false,
    streaming: false,
    publicUrls: true,
    contentAddressed: true,
  }

  private config: SwarmAdapterConfig
  private podManager!: PodManager
  private fileManager!: FileManager
  private walletManager!: WalletManager
  private connected = false
  private ownerAddress?: string

  /** Encryption keys per pod, derived from wallet */
  private podKeys: Map<string, Uint8Array> = new Map()

  constructor(config: SwarmAdapterConfig) {
    this.config = config
  }

  async connect(): Promise<void> {
    const pmConfig: PodManagerConfig = {
      beeUrl: this.config.beeUrl,
      postageBatchId: this.config.batchId,
      privateKey: this.config.privateKey,
    }
    this.podManager = new PodManager(pmConfig)

    const fmConfig: FileManagerConfig = {
      beeUrl: this.config.beeUrl,
      postageBatchId: this.config.batchId,
      ownerAddress: this.config.ownerAddress,
      privateKey: this.config.privateKey,
    }
    this.fileManager = new FileManager(fmConfig)

    this.walletManager = new WalletManager()

    // Initialize pod manager (load existing pods from Swarm feed)
    if (this.config.ownerAddress) {
      this.ownerAddress = this.config.ownerAddress
      try {
        await this.podManager.initialize(this.ownerAddress)
      } catch {
        // No existing pods — fresh account
      }
    }

    this.connected = true
  }

  async disconnect(): Promise<void> {
    // Clear cached encryption keys
    for (const key of this.podKeys.values()) {
      key.fill(0) // best-effort zeroization
    }
    this.podKeys.clear()
    this.connected = false
  }

  async isConnected(): Promise<boolean> {
    if (!this.connected) return false
    // Could also ping the Bee node here
    return true
  }

  // ── Objects ────────────────────────────────────────────

  async put(bucket: string, key: string, data: Uint8Array, opts?: PutOptions): Promise<PutResult> {
    this.ensureConnected()

    // Auto-create pod if needed
    if (!(await this.bucketExists(bucket))) {
      await this.createBucket(bucket)
    }

    const encKey = await this.getPodKey(bucket)
    const path = key.startsWith('/') ? key : '/' + key

    const coreOpts: CoreUploadOptions = {
      contentType: opts?.contentType,
      unencrypted: opts?.unencrypted,
      conflictStrategy: opts?.onConflict === 'rename' ? 'rename'
        : opts?.onConflict === 'skip' ? 'skip'
        : 'overwrite',
    }

    const info = await this.fileManager.upload(bucket, path, data, encKey, coreOpts)

    return {
      key,
      bucket,
      reference: info.swarmRef,
      size: info.size,
    }
  }

  async get(bucket: string, key: string): Promise<Uint8Array> {
    this.ensureConnected()
    const encKey = await this.getPodKey(bucket)
    const path = key.startsWith('/') ? key : '/' + key

    try {
      return await this.fileManager.download(bucket, path, encKey)
    } catch (err: any) {
      if (err.message?.includes('not found') || err.message?.includes('Not found')) {
        throw new FdsError(FdsErrorCode.OBJECT_NOT_FOUND, `Object not found: ${bucket}/${key}`, err)
      }
      throw err
    }
  }

  async head(bucket: string, key: string): Promise<ObjectMeta | null> {
    this.ensureConnected()
    const encKey = await this.getPodKey(bucket)
    const path = key.startsWith('/') ? key : '/' + key

    const info = await this.fileManager.getInfo(bucket, path, encKey)
    if (!info) return null

    return {
      key,
      size: info.size,
      contentType: info.contentType,
      createdAt: new Date(info.createdAt),
      modifiedAt: new Date(info.modifiedAt),
      encrypted: info.encrypted,
      reference: info.swarmRef,
    }
  }

  async delete(bucket: string, key: string): Promise<void> {
    this.ensureConnected()
    const encKey = await this.getPodKey(bucket)
    const path = key.startsWith('/') ? key : '/' + key

    const deleted = await this.fileManager.delete(bucket, path, encKey)
    if (!deleted) {
      throw new FdsError(FdsErrorCode.OBJECT_NOT_FOUND, `Object not found: ${bucket}/${key}`)
    }
  }

  async list(bucket: string, prefix?: string): Promise<ListResult> {
    this.ensureConnected()
    const encKey = await this.getPodKey(bucket)
    const path = prefix ? (prefix.startsWith('/') ? prefix : '/' + prefix) : '/'

    const files = await this.fileManager.list(bucket, path, encKey)

    const objects = files.map(f => ({
      key: f.path.startsWith('/') ? f.path.slice(1) : f.path,
      size: f.size,
      contentType: f.contentType,
      lastModified: new Date(f.modifiedAt),
    }))

    // Detect prefixes (subdirectories) from file paths
    const prefixSet = new Set<string>()
    for (const f of files) {
      const relPath = f.path.startsWith('/') ? f.path.slice(1) : f.path
      const slashIdx = relPath.indexOf('/')
      if (slashIdx !== -1) {
        prefixSet.add(relPath.slice(0, slashIdx + 1))
      }
    }

    return {
      objects,
      prefixes: Array.from(prefixSet),
    }
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    this.ensureConnected()
    const encKey = await this.getPodKey(bucket)
    const path = key.startsWith('/') ? key : '/' + key
    return this.fileManager.exists(bucket, path, encKey)
  }

  async move(bucket: string, fromKey: string, toKey: string): Promise<void> {
    // Swarm has no native move — download + upload + delete
    const data = await this.get(bucket, fromKey)
    await this.put(bucket, toKey, data)
    await this.delete(bucket, fromKey)
  }

  // ── Buckets (Pods) ────────────────────────────────────

  async createBucket(name: string): Promise<void> {
    this.ensureConnected()
    try {
      await this.podManager.create(name)
    } catch (err: any) {
      if (err.message?.includes('already exists')) {
        throw new FdsError(FdsErrorCode.BUCKET_EXISTS, `Bucket already exists: ${name}`, err)
      }
      throw err
    }
  }

  async listBuckets(): Promise<BucketInfo[]> {
    this.ensureConnected()
    const pods = await this.podManager.list()
    return pods.map((p: Pod) => ({
      name: p.name,
      createdAt: p.createdAt,
      isShared: p.isShared ?? false,
    }))
  }

  async deleteBucket(name: string): Promise<void> {
    this.ensureConnected()
    const deleted = await this.podManager.delete(name)
    if (!deleted) {
      throw new FdsError(FdsErrorCode.BUCKET_NOT_FOUND, `Bucket not found: ${name}`)
    }
    // Clear cached key
    const key = this.podKeys.get(name)
    if (key) {
      key.fill(0)
      this.podKeys.delete(name)
    }
  }

  async bucketExists(name: string): Promise<boolean> {
    this.ensureConnected()
    const pod = await this.podManager.get(name)
    return pod !== undefined
  }

  // ── Identity integration ──────────────────────────────

  /**
   * Set the wallet for encryption key derivation.
   * Called by IdentityService after create/import.
   */
  async setWallet(mnemonic: string): Promise<void> {
    await this.walletManager.import(mnemonic)
    const wallet = this.walletManager.getWallet()
    if (wallet) {
      this.ownerAddress = wallet.address
      // Re-initialize pod manager with the new address
      try {
        await this.podManager.initialize(wallet.address)
      } catch {
        // Fresh account
      }
    }
  }

  // ── Private ────────────────────────────────────────────

  /** Get or derive encryption key for a pod */
  private async getPodKey(podName: string): Promise<Uint8Array> {
    let key = this.podKeys.get(podName)
    if (key) return key

    // Derive key from wallet
    key = await this.walletManager.deriveKey(podName)
    this.podKeys.set(podName, key)
    return key
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new FdsError(FdsErrorCode.NO_STORAGE, 'Swarm adapter not connected. Call connect() first.')
    }
  }
}
