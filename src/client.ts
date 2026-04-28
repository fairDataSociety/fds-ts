/**
 * FdsClient — the entry point.
 *
 * Namespaced services:
 *   fds.identity   — wallet, keys, ENS, signing, backup
 *   fds.storage    — put, get, list, delete (S3-like)
 *   fds.transfer   — send, receive, subscribe
 *   fds.sharing    — share, revoke, grantees
 *   fds.escrow     — sell, buy, claim, dispute
 *   fds.publish    — public data on Swarm
 *   fds.stamps     — postage management
 *
 * Flat shortcuts:
 *   fds.put()      → fds.storage.put()
 *   fds.get()      → fds.storage.get()
 *   fds.send()     → fds.transfer.send()
 *   fds.publish()  → fds.publish.upload()
 */

import type {
  FdsConfig,
  StorageConfig,
  FdsStatus,
  PutOptions,
  PutResult,
  SendOptions,
  SendResult,
} from './types.js'
import type { StorageAdapter } from './adapters/interface.js'
import { LocalAdapter } from './adapters/local.js'
import { IdentityService } from './services/identity.js'
import { TransferService } from './services/transfer.js'
import { SharingService } from './services/sharing.js'
import { EscrowService } from './services/escrow.js'
import { PublishService } from './services/publish.js'
import type { PublishOptions, PublishResult } from './services/publish.js'
import { StampService } from './services/stamps.js'
import { FdsError, FdsErrorCode } from './errors.js'

// Service stubs — each will be a full class wrapping underlying libraries
// For now, the StorageService delegates to the adapter directly

class StorageService {
  constructor(private adapter: StorageAdapter) {}

  async put(key: string, data: string | Buffer | Uint8Array, opts?: PutOptions): Promise<PutResult> {
    const { bucket, objectKey } = this.parseKey(key)
    const bytes = this.coerce(data)

    // Auto-create bucket if needed
    if (!(await this.adapter.bucketExists(bucket))) {
      await this.adapter.createBucket(bucket)
    }

    return this.adapter.put(bucket, objectKey, bytes, opts)
  }

  async get(key: string): Promise<Uint8Array> {
    const { bucket, objectKey } = this.parseKey(key)
    return this.adapter.get(bucket, objectKey)
  }

  async list(prefix?: string) {
    if (!prefix) {
      // No prefix = list buckets
      return { buckets: await this.adapter.listBuckets(), objects: [], prefixes: [] }
    }
    const { bucket, objectKey } = this.parseKey(prefix)
    return this.adapter.list(bucket, objectKey || undefined)
  }

  async delete(key: string): Promise<void> {
    const { bucket, objectKey } = this.parseKey(key)
    if (!objectKey) {
      return this.adapter.deleteBucket(bucket)
    }
    return this.adapter.delete(bucket, objectKey)
  }

  async head(key: string) {
    const { bucket, objectKey } = this.parseKey(key)
    return this.adapter.head(bucket, objectKey)
  }

  async exists(key: string): Promise<boolean> {
    const { bucket, objectKey } = this.parseKey(key)
    return this.adapter.exists(bucket, objectKey)
  }

  async move(from: string, to: string): Promise<void> {
    const f = this.parseKey(from)
    const t = this.parseKey(to)
    if (f.bucket !== t.bucket) {
      // Cross-bucket move: get + put + delete
      const data = await this.adapter.get(f.bucket, f.objectKey)
      await this.adapter.put(t.bucket, t.objectKey, data)
      await this.adapter.delete(f.bucket, f.objectKey)
    } else {
      await this.adapter.move(f.bucket, f.objectKey, t.objectKey)
    }
  }

  async copy(from: string, to: string): Promise<void> {
    const f = this.parseKey(from)
    const t = this.parseKey(to)
    const data = await this.adapter.get(f.bucket, f.objectKey)
    await this.adapter.put(t.bucket, t.objectKey, data)
  }

  async mkdir(key: string): Promise<void> {
    // For local adapter, create the directory
    // For Swarm, directories are implicit in the pod index
    const { bucket, objectKey } = this.parseKey(key)
    if (!(await this.adapter.bucketExists(bucket))) {
      await this.adapter.createBucket(bucket)
    }
  }

  async createBucket(name: string): Promise<void> {
    return this.adapter.createBucket(name)
  }

  async listBuckets() {
    return this.adapter.listBuckets()
  }

  async deleteBucket(name: string): Promise<void> {
    return this.adapter.deleteBucket(name)
  }

  /** Parse 'bucket/path/to/file' into { bucket, objectKey } */
  private parseKey(key: string): { bucket: string; objectKey: string } {
    const slashIndex = key.indexOf('/')
    if (slashIndex === -1) {
      return { bucket: key, objectKey: '' }
    }
    return {
      bucket: key.slice(0, slashIndex),
      objectKey: key.slice(slashIndex + 1),
    }
  }

  /** Coerce string | Buffer | Uint8Array to Uint8Array */
  private coerce(data: string | Buffer | Uint8Array): Uint8Array {
    if (typeof data === 'string') {
      return new TextEncoder().encode(data)
    }
    if (data instanceof Uint8Array) {
      return data
    }
    return new Uint8Array(data)
  }
}

export class FdsClient {
  /** Identity management — wallet, keys, ENS, signing, backup */
  readonly identity: IdentityService

  /** S3-like object storage */
  readonly storage: StorageService

  /** Encrypted messaging — send, receive, subscribe */
  readonly transfer: TransferService

  /** Collaborative pod access — share, revoke, grantees */
  readonly sharing: SharingService

  /** Trustless data exchange — sell, buy, claim, dispute */
  readonly escrow: EscrowService

  /** Public data on Swarm — publish without encryption */
  readonly publish: PublishService & ((data: string | Buffer | Uint8Array, opts?: PublishOptions) => Promise<PublishResult>)

  /** Postage stamp management */
  readonly stamps: StampService

  private adapter: StorageAdapter
  private config: FdsConfig

  constructor(config: FdsConfig) {
    this.config = config
    this.adapter = this.createAdapter(config.storage)
    this.storage = new StorageService(this.adapter)
    this.identity = new IdentityService()
    this.transfer = new TransferService()
    this.sharing = new SharingService()
    this.escrow = new EscrowService()
    this.stamps = new StampService()

    // publish is both a service and a callable shortcut
    const publishService = new PublishService()
    const publishFn = (data: string | Buffer | Uint8Array, opts?: PublishOptions) => publishService.upload(data, opts)
    Object.assign(publishFn, publishService)
    this.publish = publishFn as any

    // Identity auto-propagates to SwarmAdapter (if available)
    this.identity.onChange(async (id) => {
      if (id && id.mnemonic && 'setWallet' in this.adapter) {
        await (this.adapter as any).setWallet(id.mnemonic)
      }
    })
  }

  /** Initialize the client (connect adapter, set up default buckets) */
  async init(): Promise<void> {
    await this.adapter.connect()
  }

  /** Disconnect and release resources */
  async destroy(): Promise<void> {
    await this.adapter.disconnect()
  }

  // ── Flat shortcuts ─────────────────────────────────────

  /** Shorthand for fds.storage.put() */
  put(key: string, data: string | Buffer | Uint8Array, opts?: PutOptions) {
    return this.storage.put(key, data, opts)
  }

  /** Shorthand for fds.storage.get() */
  get(key: string) {
    return this.storage.get(key)
  }

  /** Shorthand for fds.storage.list() */
  list(prefix?: string) {
    return this.storage.list(prefix)
  }

  /** Shorthand for fds.storage.delete() */
  delete(key: string) {
    return this.storage.delete(key)
  }

  /** Shorthand for fds.transfer.send() */
  send(recipient: string, data: string | Buffer | Uint8Array, opts?: SendOptions) {
    return this.transfer.send(recipient, data, opts)
  }

  /** Aggregated status check */
  async status(): Promise<FdsStatus> {
    const connected = await this.adapter.isConnected()
    const current = this.identity.current
    return {
      identity: {
        address: current?.address,
        ensName: current?.ensName,
        locked: this.identity.isLocked,
        connected: !!current,
      },
      storage: { type: this.adapter.name, connected },
      stamps: { available: false, canUpload: false },
      inbox: { unread: 0 },
    }
  }

  // ── Private ────────────────────────────────────────────

  private createAdapter(config: StorageConfig | StorageAdapter): StorageAdapter {
    // If it's already an adapter instance, use it directly
    if (typeof config === 'object' && 'name' in config && 'put' in config) {
      return config as StorageAdapter
    }

    const storageConfig = config as StorageConfig
    switch (storageConfig.type) {
      case 'local':
        return new LocalAdapter({ path: storageConfig.path })
      case 'swarm': {
        if ('gateway' in storageConfig) {
          throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Gateway mode not yet implemented. Use beeUrl for local Bee node.')
        }
        if (!('beeUrl' in storageConfig)) {
          throw new FdsError(FdsErrorCode.INVALID_INPUT, 'Swarm storage requires beeUrl or gateway')
        }
        // SwarmAdapter requires @fairdrive/core (optional peer dep)
        try {
          const { SwarmAdapter } = require('./adapters/swarm.js')
          return new SwarmAdapter({
            beeUrl: storageConfig.beeUrl,
            batchId: storageConfig.batchId,
          })
        } catch {
          throw new FdsError(
            FdsErrorCode.ADAPTER_UNSUPPORTED,
            'Swarm adapter requires @fairdrive/core. Install: npm install @fairdrive/core'
          )
        }
      }
      default:
        throw new FdsError(FdsErrorCode.INVALID_INPUT, `Unknown storage type: ${(storageConfig as any).type}`)
    }
  }
}
