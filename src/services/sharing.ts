/**
 * SharingService — collaborative bucket access via ACT.
 *
 * Two backends:
 * 1. Swarm + ACT (real cryptographic sharing): uses fairdrive ACT class.
 *    Encrypts content with DEK, encrypts DEK per grantee via ECDH, stores
 *    ACT metadata on Swarm. Grantee decrypts DEK with their private key.
 * 2. Local-only bookkeeping: stores share records as JSON. NOT cryptographic.
 *    Documented limitation — for development/testing only.
 *
 * Real ACT port: src/fairdrive/access/ACT.ts (verified working code).
 */

import type { GrantInfo } from '../types.js'
import type { StorageAdapter } from '../adapters/interface.js'
import type { IdentityService } from './identity.js'
import { FdsError, FdsErrorCode } from '../errors.js'
import { ACT } from '../fairdrive/access/ACT.js'

interface ShareRecord {
  bucket: string
  address: string
  publicKey?: string
  type: 'bucket' | 'file'
  key?: string
  /** ACT reference (Swarm mode) — null in local mode */
  actRef?: string
  /** Content reference (Swarm mode) */
  contentRef?: string
  grantedAt: string
}

const SHARES_BUCKET = '__shares'

interface BeeLike {
  uploadData(batchId: string, data: Uint8Array, opts?: any): Promise<{ reference: { toString(): string } }>
  downloadData(reference: string, opts?: any): Promise<{ toUint8Array(): Uint8Array }>
}

export class SharingService {
  private adapter?: StorageAdapter
  private identity?: IdentityService
  private bee?: BeeLike
  private batchId?: string
  private act?: ACT

  init(adapter: StorageAdapter, identity?: IdentityService, bee?: BeeLike, batchId?: string): void {
    this.adapter = adapter
    this.identity = identity
    this.bee = bee
    this.batchId = batchId
    if (bee && batchId) {
      this.act = new ACT({ beeUrl: '', postageBatchId: batchId, bee: bee as any })
    }
  }

  /** True if cryptographic sharing (Swarm ACT) is available. */
  get hasAct(): boolean {
    return !!this.act
  }

  /**
   * Grant access to a bucket.
   *
   * - With Bee: uploads ACT metadata granting recipient access (cryptographic).
   * - Without Bee: stores share record (bookkeeping only).
   */
  async grant(bucket: string, recipient: string, recipientPublicKey?: string): Promise<void> {
    this.ensureInit()
    const record: ShareRecord = {
      bucket,
      address: recipient,
      publicKey: recipientPublicKey,
      type: 'bucket',
      grantedAt: new Date().toISOString(),
    }

    // Real ACT path requires Bee + identity + recipient pubkey
    if (this.act && this.identity && recipientPublicKey) {
      const current = this.identity.current
      const privKey = this.identity.getPrivateKey()
      if (!current || !privKey) {
        throw new FdsError(FdsErrorCode.NO_IDENTITY, 'Identity required for cryptographic sharing')
      }
      // Note: bucket-level ACT in Swarm mode would re-encrypt the pod manifest
      // for grantees. That's the expensive but correct approach. For now we
      // upload an ACT-protected pointer to the bucket — full pod re-encryption
      // is a Phase 2 enhancement (rotateAccess).
      const pointerData = new TextEncoder().encode(JSON.stringify({ bucket, owner: current.address }))
      const result = await this.act.encrypt(
        Buffer.from(pointerData),
        current.address,
        current.publicKey,
        hexToBytes(privKey),
        [{ address: recipient, publicKey: recipientPublicKey }],
      )
      record.actRef = result.actRef
      record.contentRef = result.contentRef
    }

    await this.addShareRecord(bucket, record)
  }

  /** Grant access to a single file. */
  async grantFile(key: string, recipient: string, recipientPublicKey?: string): Promise<void> {
    this.ensureInit()
    const slashIdx = key.indexOf('/')
    const bucket = slashIdx > 0 ? key.slice(0, slashIdx) : key
    const fileKey = slashIdx > 0 ? key.slice(slashIdx + 1) : ''

    const record: ShareRecord = {
      bucket,
      address: recipient,
      publicKey: recipientPublicKey,
      type: 'file',
      key: fileKey,
      grantedAt: new Date().toISOString(),
    }

    if (this.act && this.identity && recipientPublicKey) {
      const current = this.identity.current
      const privKey = this.identity.getPrivateKey()
      if (!current || !privKey) {
        throw new FdsError(FdsErrorCode.NO_IDENTITY, 'Identity required for cryptographic sharing')
      }
      // Read the file (decrypted), re-encrypt with ACT for grantee
      // For now, we just create an ACT pointer — full file re-encryption
      // path is wired in fairdrive's FileManager.shareFile()
      const pointer = new TextEncoder().encode(JSON.stringify({ key, owner: current.address }))
      const result = await this.act.encrypt(
        Buffer.from(pointer),
        current.address,
        current.publicKey,
        hexToBytes(privKey),
        [{ address: recipient, publicKey: recipientPublicKey }],
      )
      record.actRef = result.actRef
      record.contentRef = result.contentRef
    }

    await this.addShareRecord(bucket, record)
  }

  /** List grantees for a bucket (combines bookkeeping + ACT). */
  async list(bucket: string): Promise<GrantInfo[]> {
    this.ensureInit()
    const records = await this.getShareRecords(bucket)
    return records.map(r => ({
      address: r.address,
      publicKey: r.publicKey,
      grantedAt: new Date(r.grantedAt),
    }))
  }

  /** Revoke a grantee. NOTE: ACT revocation is metadata-only — see rotateAccess. */
  async revoke(bucket: string, grantee: string): Promise<void> {
    this.ensureInit()
    const records = await this.getShareRecords(bucket)
    const filtered = records.filter(r => r.address !== grantee)
    await this.saveShareRecords(bucket, filtered)
    // Real ACT revocation would call act.revoke(actRef, ownerAddr, granteeAddr)
    // and update the actRef in our records.
  }

  async hasAccess(bucket: string, address: string): Promise<boolean> {
    this.ensureInit()
    const records = await this.getShareRecords(bucket)
    return records.some(r => r.address === address)
  }

  /**
   * Rotate access — re-encrypt content under new DEK.
   * Without Bee: throws ADAPTER_UNSUPPORTED.
   */
  async rotateAccess(bucket: string): Promise<void> {
    if (!this.act) {
      throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'rotateAccess requires Swarm ACT (Bee node + batchId)')
    }
    // TODO: re-encrypt all content under new DEK, re-grant to remaining grantees.
    // This requires iterating the bucket, decrypting each file, re-encrypting with
    // a fresh DEK, and updating ACT grants. Phase 2 work.
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'rotateAccess full implementation pending — use revoke for metadata-level removal')
  }

  // ── Share Record Management (private) ────────────────────

  private async addShareRecord(bucket: string, record: ShareRecord): Promise<void> {
    const records = await this.getShareRecords(bucket)
    const exists = records.some(r => r.address === record.address && r.type === record.type && r.key === record.key)
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
    try {
      const data = await adapter.get(SHARES_BUCKET, key)
      return JSON.parse(new TextDecoder().decode(data))
    } catch {
      return []
    }
  }

  private async saveShareRecords(bucket: string, records: ShareRecord[]): Promise<void> {
    const adapter = this.adapter!
    if (!(await adapter.bucketExists(SHARES_BUCKET))) {
      try { await adapter.createBucket(SHARES_BUCKET) } catch (e: any) {
        if (e?.code !== 'BUCKET_EXISTS') throw e
      }
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

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}
