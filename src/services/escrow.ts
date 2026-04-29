/**
 * EscrowService — trustless data exchange via DataEscrow contract.
 *
 * Two backends:
 * 1. Chain mode (real): bee + viem + DataEscrow contract. Encrypts content with
 *    a fresh DEK, uploads to Swarm, creates escrow with content hash + key
 *    commitment. Buyer funds → seller commits encrypted key → seller reveals →
 *    buyer claims and decrypts. Maps directly to FairdropClient's escrow flow.
 * 2. Local mode (simulation): metadata-only bookkeeping in __escrow bucket.
 *    For tests and offline development. NO real on-chain escrow.
 *
 * Real source of truth: src/fairdrop/client.ts (createEscrow, fundEscrow,
 * commitKeyRelease, revealKey, claimPayment, claimExpired, disputeEscrow).
 *
 * All 11 contract states: Created, Funded, KeyCommitted, Released, Claimed,
 * Expired, Cancelled, Disputed, SellerResponded, ResolvedBuyer, ResolvedSeller.
 */

import type { EscrowDetails, EscrowCreateOptions, EscrowCreateResult, EscrowStatus } from '../types.js'
import type { StorageAdapter } from '../adapters/interface.js'
import type { IdentityService } from './identity.js'
import { encrypt, decrypt } from '../crypto/encryption.js'
import { derivePodKey, deriveFileKey } from '../crypto/keys.js'
import { FdsError, FdsErrorCode } from '../errors.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { DataEscrowABI } from '../fairdrop/abi/DataEscrow.js'
import {
  createKeyCommitment,
  encryptKeyForBuyer,
  decryptKeyAsBuyer,
  serializeEncryptedKey,
  deserializeEncryptedKey,
  createEncryptedKeyCommitment,
} from '../fairdrop/crypto/escrow.js'
import { NodeCryptoProvider } from '../fairdrop/crypto/node.js'

const ESCROW_BUCKET = '__escrow'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

interface BeeLike {
  uploadData(batchId: string, data: Uint8Array, opts?: any): Promise<{ reference: { toString(): string } }>
  downloadData(reference: string, opts?: any): Promise<{ toUint8Array(): Uint8Array }>
}

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
  /** Real on-chain tx hash if chain mode */
  txHash?: string
}

interface ChainConfig {
  rpcUrl: string
  chainId?: number
  escrowContract?: `0x${string}`
}

const STATE_NAMES: EscrowStatus[] = [
  'Created', 'Funded', 'KeyCommitted', 'Released', 'Claimed',
  'Expired', 'Cancelled', 'Disputed', 'SellerResponded',
  'ResolvedBuyer', 'ResolvedSeller',
]

let escrowCounter = 0

export class EscrowService {
  private adapter?: StorageAdapter
  private identity?: IdentityService
  private chainConfig?: ChainConfig
  private bee?: BeeLike
  private batchId?: string
  private cryptoProvider = new NodeCryptoProvider()

  init(
    adapter: StorageAdapter,
    identity: IdentityService,
    chain?: ChainConfig,
    bee?: BeeLike,
    batchId?: string,
  ): void {
    this.adapter = adapter
    this.identity = identity
    this.chainConfig = chain
    this.bee = bee
    this.batchId = batchId
  }

  /** True when full on-chain escrow is available (chain + bee + batchId + contract). */
  get hasChain(): boolean {
    return !!(this.chainConfig?.escrowContract && this.chainConfig.rpcUrl && this.bee && this.batchId)
  }

  /**
   * Create an escrow.
   *
   * Chain mode (bee + chain + escrowContract): encrypt with fresh DEK, upload to Swarm,
   * create on-chain escrow with content hash + key commitment.
   * Local mode: metadata-only simulation in __escrow bucket.
   */
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

    // Read source data — try decrypted first, fall back to raw
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

    // Generate escrow-specific encryption key + IV
    const escrowKey = this.cryptoProvider.randomBytes(32)
    const iv = this.cryptoProvider.randomBytes(12)

    // Encrypt with AES-GCM (matches FairdropClient.createEscrow format: IV + ciphertext blob)
    const ciphertext = await this.cryptoProvider.aesGcmEncrypt(plaintext, escrowKey, iv)
    const encryptedBlob = new Uint8Array(iv.length + ciphertext.length)
    encryptedBlob.set(iv, 0)
    encryptedBlob.set(ciphertext, iv.length)

    // Content hash (keccak256 — matches Solidity)
    const contentHashBytes = keccak_256(encryptedBlob)
    const contentHash = '0x' + Buffer.from(contentHashBytes).toString('hex')

    // Key commitment for on-chain
    const { commitment, salt } = await createKeyCommitment(this.cryptoProvider, escrowKey)

    if (this.hasChain) {
      // ── Chain mode: upload to Swarm + create on-chain escrow ──────────
      const upload = await this.bee!.uploadData(this.batchId!, encryptedBlob)
      const reference = upload.reference.toString()

      const escrowId = await this.chainCreateEscrow(
        contentHash as `0x${string}`,
        ('0x' + Buffer.from(commitment).toString('hex')) as `0x${string}`,
        opts.price,
        opts.expiryDays ?? 7,
      )

      // Persist key for crash recovery
      await this.persistEscrowKey({
        escrowId: escrowId.toString(),
        reference,
        contentHash,
        encryptionKey: Buffer.from(escrowKey).toString('hex'),
        salt: Buffer.from(salt).toString('hex'),
        price: opts.price,
        description: opts.description,
        status: 'Created',
        createdAt: new Date().toISOString(),
        seller: current.address,
      })

      return { escrowId, reference, contentHash, status: 'Created' }
    }

    // ── Local mode: simulate ──────────────────────────────────────────
    if (!(await this.adapter.bucketExists(ESCROW_BUCKET))) {
      try { await this.adapter.createBucket(ESCROW_BUCKET) }
      catch (e: any) { if (e?.code !== 'BUCKET_EXISTS') throw e }
    }

    const escrowId = BigInt(++escrowCounter)
    const ref = `escrow-${escrowId}`
    await this.adapter.put(ESCROW_BUCKET, `${ref}.data`, encryptedBlob)

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

  /** Get escrow status. Chain mode: read from contract. Local: read metadata. */
  async status(escrowId: bigint): Promise<EscrowDetails> {
    if (!this.adapter) throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Not initialized')

    if (this.hasChain) {
      return this.chainEscrowDetails(escrowId)
    }

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

  /** Buyer: fund the escrow. Chain only. */
  async fund(escrowId: bigint): Promise<string> {
    if (!this.hasChain) {
      throw new FdsError(FdsErrorCode.CHAIN_UNREACHABLE, 'fund requires chain config + bee + escrowContract')
    }
    const details = await this.chainEscrowDetails(escrowId)
    if (details.status !== 'Created') {
      throw new FdsError(FdsErrorCode.ESCROW_WRONG_STATE, `Escrow ${escrowId} is in state ${details.status}, expected Created`)
    }
    const wallet = await this.getWalletClient()
    const txHash = await wallet.writeContract({
      address: this.chainConfig!.escrowContract!,
      abi: DataEscrowABI,
      functionName: 'fundEscrow',
      args: [escrowId],
      value: details.price,
    } as any)
    return txHash
  }

  /**
   * Buy: fund the escrow, wait for seller's key reveal, decrypt and verify.
   *
   * Steps:
   * 1. Fund the escrow on-chain
   * 2. Poll for KeyRevealed event (seller has revealed encrypted key)
   * 3. Decrypt the encrypted key with our private key (ECDH)
   * 4. Download encrypted blob from Swarm
   * 5. Verify content hash matches on-chain
   * 6. Decrypt and return plaintext
   *
   * Caller can split this into fund() + awaitKeyReveal() + decryptPurchased()
   * for finer control (e.g., bail out before pay, custom timeouts).
   */
  async buy(escrowId: bigint, opts?: { swarmReference?: string; timeoutMs?: number }): Promise<Uint8Array> {
    if (!this.hasChain) {
      throw new FdsError(FdsErrorCode.CHAIN_UNREACHABLE, 'buy requires chain mode')
    }
    await this.fund(escrowId)
    const encryptedKey = await this.awaitKeyReveal(escrowId, opts?.timeoutMs ?? 600_000)
    if (!opts?.swarmReference) {
      throw new FdsError(FdsErrorCode.INVALID_INPUT, 'buy() requires opts.swarmReference (out-of-band from seller). Use fund() + awaitKeyReveal() + decryptPurchased() for streaming flow.')
    }
    return this.decryptPurchased(escrowId, opts.swarmReference, encryptedKey)
  }

  /**
   * Wait for seller's KeyRevealed event for a specific escrow.
   * Polls historic logs first, then watches for new events. Times out after `timeoutMs`.
   */
  async awaitKeyReveal(escrowId: bigint, timeoutMs = 600_000): Promise<Uint8Array> {
    if (!this.hasChain) {
      throw new FdsError(FdsErrorCode.CHAIN_UNREACHABLE, 'awaitKeyReveal requires chain mode')
    }
    const publicClient = await this.getPublicClient()
    const { parseAbiItem, decodeEventLog } = await import('viem')

    const eventAbi = parseAbiItem('event KeyRevealed(uint256 indexed escrowId, bytes encryptedKeyForBuyer)')
    const fromBlock = await publicClient.getBlockNumber().then((n: bigint) => n - 1000n).catch(() => 0n)

    // Check historic logs first
    const historic = await publicClient.getLogs({
      address: this.chainConfig!.escrowContract!,
      event: eventAbi as any,
      args: { escrowId },
      fromBlock,
      toBlock: 'latest',
    })
    if (historic.length > 0) {
      const last = historic[historic.length - 1]
      const decoded = decodeEventLog({ abi: [eventAbi], data: last.data, topics: last.topics }) as any
      return Uint8Array.from(Buffer.from((decoded.args.encryptedKeyForBuyer as string).slice(2), 'hex'))
    }

    // Poll for new events
    const start = Date.now()
    const pollInterval = 5000
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, pollInterval))
      const fresh = await publicClient.getLogs({
        address: this.chainConfig!.escrowContract!,
        event: eventAbi as any,
        args: { escrowId },
        fromBlock,
        toBlock: 'latest',
      })
      if (fresh.length > 0) {
        const last = fresh[fresh.length - 1]
        const decoded = decodeEventLog({ abi: [eventAbi], data: last.data, topics: last.topics }) as any
        return Uint8Array.from(Buffer.from((decoded.args.encryptedKeyForBuyer as string).slice(2), 'hex'))
      }
    }
    throw new FdsError(FdsErrorCode.CHAIN_UNREACHABLE, `Timeout waiting for KeyRevealed event for escrow ${escrowId}`)
  }

  /**
   * Decrypt purchased data after seller has revealed the encrypted key.
   *
   * Uses our private key to decrypt the ECDH-wrapped DEK, then downloads the
   * encrypted blob from Swarm and decrypts it. Verifies content hash matches
   * the on-chain commitment before returning plaintext.
   */
  async decryptPurchased(
    escrowId: bigint,
    swarmReference: string,
    encryptedKeyForBuyer: Uint8Array,
  ): Promise<Uint8Array> {
    if (!this.bee) {
      throw new FdsError(FdsErrorCode.NO_STORAGE, 'Bee node required to download purchased data')
    }
    if (!this.identity) {
      throw new FdsError(FdsErrorCode.NO_IDENTITY, 'Identity required to decrypt purchased data')
    }
    const privKey = this.identity.getPrivateKey()
    if (!privKey) {
      throw new FdsError(FdsErrorCode.IDENTITY_LOCKED, 'Identity locked')
    }
    const buyerPrivKey = Uint8Array.from(Buffer.from(privKey.startsWith('0x') ? privKey.slice(2) : privKey, 'hex'))

    // 1. Decrypt the encryption key (ECDH)
    const encryptedKeyPackage = deserializeEncryptedKey(encryptedKeyForBuyer)
    const decryptionKey = await decryptKeyAsBuyer(this.cryptoProvider, encryptedKeyPackage, buyerPrivKey)

    // 2. Download encrypted blob from Swarm
    const blob = await this.bee.downloadData(swarmReference)
    const encryptedBlob = blob.toUint8Array()

    // 3. Verify content hash matches on-chain commitment
    const details = await this.chainEscrowDetails(escrowId)
    const actualHash = keccak_256(encryptedBlob)
    const expectedHashHex = details.contentHash.startsWith('0x') ? details.contentHash.slice(2) : details.contentHash
    const expectedHash = Uint8Array.from(Buffer.from(expectedHashHex, 'hex'))
    if (!constantTimeEqual(actualHash, expectedHash)) {
      throw new FdsError(FdsErrorCode.ESCROW_WRONG_STATE, 'Content hash mismatch — downloaded data does not match on-chain commitment')
    }

    // 4. Decrypt with AES-GCM (IV is first 12 bytes of blob)
    const iv = encryptedBlob.slice(0, 12)
    const ciphertext = encryptedBlob.slice(12)
    try {
      return await this.cryptoProvider.aesGcmDecrypt(ciphertext, decryptionKey, iv)
    } catch (e: any) {
      throw new FdsError(FdsErrorCode.ESCROW_WRONG_STATE, `Decryption failed: ${e?.message || e}`)
    }
  }

  /**
   * Seller commits encrypted key to chain. Phase 1 of release.
   * Buyer's public key required to encrypt the DEK for them.
   */
  async commitKey(escrowId: bigint, buyerPublicKey: Uint8Array): Promise<{ txHash: string; serializedEncryptedKey: Uint8Array; commitmentSalt: Uint8Array }> {
    if (!this.hasChain) {
      throw new FdsError(FdsErrorCode.CHAIN_UNREACHABLE, 'commitKey requires chain mode')
    }
    const stored = await this.getStoredEscrowKey(escrowId.toString())
    if (!stored) {
      throw new FdsError(FdsErrorCode.ESCROW_NOT_FOUND, `No stored key for escrow ${escrowId}`)
    }
    const escrowKey = Uint8Array.from(Buffer.from(stored.encryptionKey, 'hex'))

    // Encrypt DEK for buyer via ECDH
    const encryptedKeyPackage = await encryptKeyForBuyer(this.cryptoProvider, escrowKey, buyerPublicKey)
    const serializedEncryptedKey = serializeEncryptedKey(encryptedKeyPackage)

    // Commitment to encrypted key
    const { commitment, salt: commitmentSalt } = await createEncryptedKeyCommitment(this.cryptoProvider, serializedEncryptedKey)
    const commitmentHex = ('0x' + Buffer.from(commitment).toString('hex')) as `0x${string}`

    const wallet = await this.getWalletClient()
    const txHash = await wallet.writeContract({
      address: this.chainConfig!.escrowContract!,
      abi: DataEscrowABI,
      functionName: 'commitKeyRelease',
      args: [escrowId, commitmentHex],
    } as any)

    // Persist commitment salt + serialized key for reveal phase
    await this.persistEscrowKey({
      ...stored,
      status: 'KeyCommitted',
      // store salt + serialized key in extra fields
      ...({
        commitmentSalt: Buffer.from(commitmentSalt).toString('hex'),
        serializedEncryptedKey: Buffer.from(serializedEncryptedKey).toString('hex'),
      } as any),
    })

    return { txHash, serializedEncryptedKey, commitmentSalt }
  }

  /** Seller reveals encrypted key on-chain. Phase 2 of release. */
  async revealKey(escrowId: bigint): Promise<string> {
    if (!this.hasChain) {
      throw new FdsError(FdsErrorCode.CHAIN_UNREACHABLE, 'revealKey requires chain mode')
    }
    const stored = await this.getStoredEscrowKey(escrowId.toString()) as any
    if (!stored?.serializedEncryptedKey || !stored?.commitmentSalt) {
      throw new FdsError(FdsErrorCode.ESCROW_NOT_FOUND, `No commit data for escrow ${escrowId} — call commitKey first`)
    }
    const serializedKey = Uint8Array.from(Buffer.from(stored.serializedEncryptedKey, 'hex'))
    const saltHex = ('0x' + stored.commitmentSalt) as `0x${string}`

    const wallet = await this.getWalletClient()
    const txHash = await wallet.writeContract({
      address: this.chainConfig!.escrowContract!,
      abi: DataEscrowABI,
      functionName: 'revealKey',
      args: [escrowId, serializedKey, saltHex],
    } as any)

    await this.persistEscrowKey({ ...stored, status: 'Released' })
    return txHash
  }

  /** Seller claims payment after dispute window. */
  async claim(escrowId: bigint): Promise<string> {
    if (!this.hasChain) {
      throw new FdsError(FdsErrorCode.CHAIN_UNREACHABLE, 'claim requires chain mode')
    }
    const wallet = await this.getWalletClient()
    return wallet.writeContract({
      address: this.chainConfig!.escrowContract!,
      abi: DataEscrowABI,
      functionName: 'claimPayment',
      args: [escrowId],
    } as any)
  }

  /** Buyer claims refund for expired escrow. */
  async claimExpired(escrowId: bigint): Promise<string> {
    if (!this.hasChain) {
      throw new FdsError(FdsErrorCode.CHAIN_UNREACHABLE, 'claimExpired requires chain mode')
    }
    const wallet = await this.getWalletClient()
    return wallet.writeContract({
      address: this.chainConfig!.escrowContract!,
      abi: DataEscrowABI,
      functionName: 'claimExpired',
      args: [escrowId],
    } as any)
  }

  /** Buyer raises dispute (5% bond required). */
  async dispute(escrowId: bigint): Promise<string> {
    if (!this.hasChain) {
      throw new FdsError(FdsErrorCode.CHAIN_UNREACHABLE, 'dispute requires chain mode')
    }
    const details = await this.chainEscrowDetails(escrowId)
    const bond = (details.price * 5n) / 100n

    const wallet = await this.getWalletClient()
    return wallet.writeContract({
      address: this.chainConfig!.escrowContract!,
      abi: DataEscrowABI,
      functionName: 'disputeEscrow',
      args: [escrowId],
      value: bond,
    } as any)
  }

  async reputation(_escrowId: bigint): Promise<{ score: number; tier: string }> {
    return { score: 0, tier: 'unknown' }
  }

  async recoverKeys(escrowId: string, _password: string): Promise<{ encryptionKey: string; salt: string } | null> {
    const r = await this.getStoredEscrowKey(escrowId)
    if (!r) return null
    return { encryptionKey: r.encryptionKey, salt: r.salt }
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

  /** Prepare unsigned txs (for keyless gateway flow — fds-id signs, then submit). */
  readonly prepare = {
    create: async (..._: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'prepare.create — use create() with bee+chain') },
    fund: async (..._: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'prepare.fund — use fund() with chain') },
    commitKey: async (..._: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'prepare.commitKey — use commitKey() with chain') },
    revealKey: async (..._: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'prepare.revealKey — use revealKey() with chain') },
    claim: async (..._: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'prepare.claim — use claim() with chain') },
    dispute: async (..._: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'prepare.dispute — use dispute() with chain') },
  }

  // ── Chain helpers (private) ──────────────────────────────

  private async chainCreateEscrow(
    contentHash: `0x${string}`,
    keyCommitment: `0x${string}`,
    priceEth: string,
    expiryDays: number,
  ): Promise<bigint> {
    const wallet = await this.getWalletClient()
    const publicClient = await this.getPublicClient()
    const { parseEther } = await import('viem')

    const priceWei = parseEther(priceEth)
    const expiry = BigInt(Math.floor(Date.now() / 1000) + expiryDays * 86400)
    const disputeWindow = 0n

    const txHash = await wallet.writeContract({
      address: this.chainConfig!.escrowContract!,
      abi: DataEscrowABI,
      functionName: 'createEscrowWithTerms',
      args: [contentHash, keyCommitment, ZERO_ADDRESS, priceWei, expiry, disputeWindow],
    } as any)

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    return this.parseEscrowIdFromReceipt(receipt)
  }

  private async chainEscrowDetails(escrowId: bigint): Promise<EscrowDetails> {
    const publicClient = await this.getPublicClient()
    const result = await publicClient.readContract({
      address: this.chainConfig!.escrowContract!,
      abi: DataEscrowABI,
      functionName: 'escrows',
      args: [escrowId],
    }) as readonly any[]

    const stateIdx = Number(result[17])
    return {
      escrowId,
      seller: result[0],
      buyer: result[1] === ZERO_ADDRESS ? undefined : result[1],
      price: result[6] as bigint,
      contentHash: result[3],
      status: STATE_NAMES[stateIdx] ?? 'Created',
      createdAt: new Date(),
      expiresAt: result[7] ? new Date(Number(result[7]) * 1000) : undefined,
    }
  }

  private parseEscrowIdFromReceipt(receipt: any): bigint {
    // EscrowCreated(uint256 indexed escrowId, address indexed seller, ...)
    // Topic[1] = escrowId
    const log = receipt.logs?.find((l: any) =>
      l.address?.toLowerCase() === this.chainConfig!.escrowContract!.toLowerCase()
    )
    if (!log || !log.topics?.[1]) {
      throw new FdsError(FdsErrorCode.CHAIN_UNREACHABLE, 'EscrowCreated event not found in receipt')
    }
    return BigInt(log.topics[1])
  }

  private async getWalletClient(): Promise<any> {
    if (!this.identity) throw new FdsError(FdsErrorCode.NO_IDENTITY, 'Identity required')
    const privKey = this.identity.getPrivateKey()
    if (!privKey) throw new FdsError(FdsErrorCode.IDENTITY_LOCKED, 'Identity locked')

    const { createWalletClient, http } = await import('viem')
    const { privateKeyToAccount } = await import('viem/accounts')
    const chainObj = await this.getChain()

    const pkHex = privKey.startsWith('0x') ? privKey : '0x' + privKey
    const account = privateKeyToAccount(pkHex as `0x${string}`)

    return createWalletClient({
      account,
      chain: chainObj,
      transport: http(this.chainConfig!.rpcUrl),
    })
  }

  private async getPublicClient(): Promise<any> {
    const { createPublicClient, http } = await import('viem')
    const chainObj = await this.getChain()
    return createPublicClient({
      chain: chainObj,
      transport: http(this.chainConfig!.rpcUrl),
    })
  }

  private async getChain(): Promise<any> {
    const id = this.chainConfig?.chainId ?? 8453
    const chains = await import('viem/chains')
    const chainMap: Record<number, any> = {
      1: chains.mainnet,
      8453: chains.base,
      84532: chains.baseSepolia,
      11155111: chains.sepolia,
      100: chains.gnosis,
    }
    return chainMap[id] ?? { id, name: `chain-${id}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [this.chainConfig!.rpcUrl] } } }
  }

  // ── Persistence helpers (private) ─────────────────────────

  private async persistEscrowKey(record: EscrowRecord): Promise<void> {
    if (!this.adapter) return
    if (!(await this.adapter.bucketExists(ESCROW_BUCKET))) {
      try { await this.adapter.createBucket(ESCROW_BUCKET) }
      catch (e: any) { if (e?.code !== 'BUCKET_EXISTS') throw e }
    }
    const ref = `escrow-${record.escrowId}`
    await this.adapter.put(ESCROW_BUCKET, `${ref}.meta.json`,
      new TextEncoder().encode(JSON.stringify(record, null, 2)))
  }

  private async getStoredEscrowKey(escrowId: string): Promise<EscrowRecord | null> {
    if (!this.adapter) return null
    try {
      const data = await this.adapter.get(ESCROW_BUCKET, `escrow-${escrowId}.meta.json`)
      return JSON.parse(new TextDecoder().decode(data))
    } catch { return null }
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}
