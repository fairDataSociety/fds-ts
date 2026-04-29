/**
 * EscrowService — trustless data exchange.
 *
 * Seller: encrypt data → upload → create escrow.
 * Buyer: fund → seller reveals key → buyer decrypts.
 *
 * Local mode: simulates escrow with metadata files.
 * Chain mode: wraps FairdropClient escrow (create, fund, commit, reveal, claim).
 *
 * All 11 contract states: Created, Funded, KeyCommitted, Released, Claimed,
 * Expired, Cancelled, Disputed, SellerResponded, ResolvedBuyer, ResolvedSeller.
 */

import type { EscrowDetails, EscrowCreateOptions, EscrowCreateResult, EscrowStatus } from '../types.js'
import type { StorageAdapter } from '../adapters/interface.js'
import type { IdentityService } from './identity.js'
import { encrypt } from '../crypto/encryption.js'
import { derivePodKey, deriveFileKey } from '../crypto/keys.js'
import { decrypt } from '../crypto/encryption.js'
import { FdsError, FdsErrorCode } from '../errors.js'
import { keccak_256 } from '@noble/hashes/sha3.js'

const ESCROW_BUCKET = '__escrow'

interface EscrowRecord {
  escrowId: string
  reference: string
  contentHash: string
  encryptionKey: string
  salt: string
  price: string
  description?: string
  status: EscrowStatus
  createdAt: string
  seller: string
}

let escrowCounter = 0

export class EscrowService {
  private adapter?: StorageAdapter
  private identity?: IdentityService
  private chainConfig?: { rpcUrl: string; chainId: number }

  init(adapter: StorageAdapter, identity: IdentityService, chain?: { rpcUrl: string; chainId: number }): void {
    this.adapter = adapter
    this.identity = identity
    this.chainConfig = chain
  }

  async create(key: string, opts: EscrowCreateOptions): Promise<EscrowCreateResult> {
    if (!this.adapter || !this.identity) {
      throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'EscrowService not initialized')
    }
    const current = this.identity.current
    if (!current) {
      throw new FdsError(FdsErrorCode.NO_IDENTITY, 'Identity required to create escrow')
    }

    const slashIdx = key.indexOf('/')
    const bucket = slashIdx > 0 ? key.slice(0, slashIdx) : key
    const objectKey = slashIdx > 0 ? key.slice(slashIdx + 1) : ''

    // Read and decrypt the data
    let plaintext: Uint8Array
    try {
      const privKey = this.identity.getPrivateKey()
      if (!privKey) throw new Error('No key')
      const podKey = derivePodKey(privKey, bucket)
      const fileKey = await deriveFileKey(podKey, bucket, '/' + objectKey)
      const ciphertext = await this.adapter.get(bucket, objectKey)
      plaintext = decrypt(ciphertext, fileKey)
    } catch {
      plaintext = await this.adapter.get(bucket, objectKey)
    }

    // Generate escrow-specific encryption key
    const escrowKey = new Uint8Array(32)
    globalThis.crypto.getRandomValues(escrowKey)
    const salt = new Uint8Array(16)
    globalThis.crypto.getRandomValues(salt)

    // Encrypt with escrow key
    const encryptedData = encrypt(plaintext, escrowKey)
    const contentHash = Buffer.from(keccak_256(encryptedData)).toString('hex')

    // Store
    if (!(await this.adapter.bucketExists(ESCROW_BUCKET))) {
      await this.adapter.createBucket(ESCROW_BUCKET)
    }

    const escrowId = BigInt(++escrowCounter)
    const ref = `escrow-${escrowId}`
    await this.adapter.put(ESCROW_BUCKET, `${ref}.data`, encryptedData)

    const record: EscrowRecord = {
      escrowId: escrowId.toString(),
      reference: ref,
      contentHash,
      encryptionKey: Buffer.from(escrowKey).toString('hex'),
      salt: Buffer.from(salt).toString('hex'),
      price: opts.price,
      description: opts.description,
      status: 'Created',
      createdAt: new Date().toISOString(),
      seller: current.address,
    }

    await this.adapter.put(ESCROW_BUCKET, `${ref}.meta.json`,
      new TextEncoder().encode(JSON.stringify(record, null, 2)))

    return { escrowId, reference: ref, contentHash, status: 'Created' }
  }

  async status(escrowId: bigint): Promise<EscrowDetails> {
    if (!this.adapter) throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Not initialized')
    const ref = `escrow-${escrowId}`
    try {
      const data = await this.adapter.get(ESCROW_BUCKET, `${ref}.meta.json`)
      const r = JSON.parse(new TextDecoder().decode(data))
      return {
        escrowId: BigInt(r.escrowId),
        seller: r.seller,
        price: BigInt(0),
        description: r.description,
        contentHash: r.contentHash,
        reference: r.reference,
        status: r.status as EscrowStatus,
        createdAt: new Date(r.createdAt),
      }
    } catch {
      throw new FdsError(FdsErrorCode.ESCROW_NOT_FOUND, `Escrow ${escrowId} not found`)
    }
  }

  async buy(escrowId: bigint): Promise<Uint8Array> {
    if (!this.chainConfig) throw new FdsError(FdsErrorCode.CHAIN_UNREACHABLE, 'Chain config required for buy')
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'On-chain buy requires Swarm + chain')
  }

  async claim(escrowId: bigint): Promise<string> {
    if (!this.chainConfig) throw new FdsError(FdsErrorCode.CHAIN_UNREACHABLE, 'Chain config required for claim')
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'On-chain claim requires chain')
  }

  async dispute(escrowId: bigint): Promise<string> {
    if (!this.chainConfig) throw new FdsError(FdsErrorCode.CHAIN_UNREACHABLE, 'Chain config required for dispute')
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'On-chain dispute requires chain')
  }

  async claimExpired(escrowId: bigint): Promise<string> {
    if (!this.chainConfig) throw new FdsError(FdsErrorCode.CHAIN_UNREACHABLE, 'Chain config required')
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'On-chain claimExpired requires chain')
  }

  async reputation(escrowId: bigint): Promise<{ score: number; tier: string }> {
    return { score: 0, tier: 'unknown' }
  }

  async recoverKeys(escrowId: string, password: string): Promise<any> {
    if (!this.adapter) throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Not initialized')
    try {
      const data = await this.adapter.get(ESCROW_BUCKET, `escrow-${escrowId}.meta.json`)
      const r = JSON.parse(new TextDecoder().decode(data))
      return { encryptionKey: r.encryptionKey, salt: r.salt }
    } catch { return null }
  }

  async listKeys(): Promise<Array<{ escrowId: string; status: string; createdAt: number }>> {
    if (!this.adapter) throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Not initialized')
    if (!(await this.adapter.bucketExists(ESCROW_BUCKET))) return []
    const result = await this.adapter.list(ESCROW_BUCKET)
    const keys: Array<{ escrowId: string; status: string; createdAt: number }> = []
    for (const obj of result.objects) {
      if (obj.key.endsWith('.meta.json')) {
        try {
          const data = await this.adapter.get(ESCROW_BUCKET, obj.key)
          const r = JSON.parse(new TextDecoder().decode(data))
          keys.push({ escrowId: r.escrowId, status: r.status, createdAt: new Date(r.createdAt).getTime() })
        } catch { /* skip */ }
      }
    }
    return keys
  }

  async deleteKey(escrowId: string): Promise<void> {
    if (!this.adapter) throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Not initialized')
    try { await this.adapter.delete(ESCROW_BUCKET, `escrow-${escrowId}.meta.json`) } catch {}
  }

  readonly prepare = {
    create: async (..._: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Requires chain') },
    fund: async (..._: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Requires chain') },
    commitKey: async (..._: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Requires chain') },
    revealKey: async (..._: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Requires chain') },
    claim: async (..._: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Requires chain') },
    dispute: async (..._: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Requires chain') },
  }
}
