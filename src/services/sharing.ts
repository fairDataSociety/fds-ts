/**
 * SharingService — collaborative bucket access via ACT (Access Control Trie).
 *
 * For Swarm: uses fairdrive ACT (ECDH+HKDF encrypted DEK grants, signed metadata).
 * For local/other adapters: stores share metadata in __shares bucket as JSON.
 *
 * Security notes:
 * - ACT revocation is metadata-only on Swarm (S5). Use rotateAccess() for true revocation.
 * - ACT metadata should be signed for all mutations including revoke (S5 fix pending).
 */

import type { GrantInfo } from '../types.js'
import type { StorageAdapter } from '../adapters/interface.js'
import { FdsError, FdsErrorCode } from '../errors.js'

interface ShareRecord {
  bucket: string
  address: string
  type: 'bucket' | 'file'
  key?: string  // file key if type === 'file'
  grantedAt: string
}

const SHARES_BUCKET = '__shares'

export class SharingService {
  private adapter?: StorageAdapter

  init(adapter: StorageAdapter): void {
    this.adapter = adapter
  }

  /** Grant collaborative access to a bucket. */
  async grant(bucket: string, recipient: string): Promise<void> {
    this.ensureInit()
    const record: ShareRecord = {
      bucket,
      address: recipient,
      type: 'bucket',
      grantedAt: new Date().toISOString(),
    }
    await this.addShareRecord(bucket, record)

    // On Swarm adapter: would call ACT.grant() + PodManager.share()
    // For now: metadata-only sharing via share records
  }

  /** Grant access to a single file. */
  async grantFile(key: string, recipient: string): Promise<void> {
    this.ensureInit()
    const slashIdx = key.indexOf('/')
    const bucket = slashIdx > 0 ? key.slice(0, slashIdx) : key
    const fileKey = slashIdx > 0 ? key.slice(slashIdx + 1) : ''

    const record: ShareRecord = {
      bucket,
      address: recipient,
      type: 'file',
      key: fileKey,
      grantedAt: new Date().toISOString(),
    }
    await this.addShareRecord(bucket, record)
  }

  /** List grantees for a bucket. */
  async list(bucket: string): Promise<GrantInfo[]> {
    this.ensureInit()
    const records = await this.getShareRecords(bucket)
    return records.map(r => ({
      address: r.address,
      grantedAt: new Date(r.grantedAt),
    }))
  }

  /** Revoke access for a grantee. */
  async revoke(bucket: string, grantee: string): Promise<void> {
    this.ensureInit()
    const records = await this.getShareRecords(bucket)
    const filtered = records.filter(r => r.address !== grantee)
    await this.saveShareRecords(bucket, filtered)
  }

  /** Check if someone has access. */
  async hasAccess(bucket: string, address: string): Promise<boolean> {
    this.ensureInit()
    const records = await this.getShareRecords(bucket)
    return records.some(r => r.address === address)
  }

  /**
   * Rotate access — re-encrypt content under new DEK, re-grant to remaining users.
   * This is TRUE revocation (expensive: re-uploads all content).
   */
  async rotateAccess(bucket: string): Promise<void> {
    // On Swarm: would re-encrypt all content in the pod with new DEK,
    // then create new ACT grants for all remaining grantees.
    // On local: no-op (share records are the access control).
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'rotateAccess requires Swarm ACT. Use revoke() for metadata-level revocation.')
  }

  // ── Private: Share Record Management ─────────────────

  private async addShareRecord(bucket: string, record: ShareRecord): Promise<void> {
    const records = await this.getShareRecords(bucket)
    // Dedup by address + type + key
    const exists = records.some(r =>
      r.address === record.address && r.type === record.type && r.key === record.key
    )
    if (!exists) {
      records.push(record)
      await this.saveShareRecords(bucket, records)
    }
  }

  private async getShareRecords(bucket: string): Promise<ShareRecord[]> {
    const adapter = this.adapter!
    if (!(await adapter.bucketExists(SHARES_BUCKET))) return []

    const key = `${bucket}.json`
    if (!(await adapter.exists(SHARES_BUCKET, key))) return []

    const data = await adapter.get(SHARES_BUCKET, key)
    try {
      return JSON.parse(new TextDecoder().decode(data))
    } catch {
      return []
    }
  }

  private async saveShareRecords(bucket: string, records: ShareRecord[]): Promise<void> {
    const adapter = this.adapter!
    if (!(await adapter.bucketExists(SHARES_BUCKET))) {
      await adapter.createBucket(SHARES_BUCKET)
    }
    const key = `${bucket}.json`
    const data = new TextEncoder().encode(JSON.stringify(records, null, 2))
    await adapter.put(SHARES_BUCKET, key, data)
  }

  private ensureInit(): void {
    if (!this.adapter) {
      throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'SharingService not initialized')
    }
  }
}
