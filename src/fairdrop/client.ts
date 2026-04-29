/**
 * FairdropClient - Main SDK entry point
 *
 * Provides programmatic access to Fairdrop functionality.
 * Works in both Node.js and browser environments.
 */

import { Bee } from '@ethersphere/bee-js'
import type { BatchId, Reference } from '@ethersphere/bee-js'
import { encodeFunctionData, zeroAddress, getEventSelector } from 'viem'
import type { WalletProvider, CryptoProvider, EncodingProvider, StorageAdapter, ContractProvider } from './index.js'
import { FairdropError, FairdropErrorCode, escrowError } from './index.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import * as secp256k1 from '@noble/secp256k1'
import {
  createKeyCommitment,
  encryptKeyForBuyer,
  decryptKeyAsBuyer,
  serializeEncryptedKey,
  deserializeEncryptedKey,
  createEncryptedKeyCommitment,
  generateEncryptionKey,
  deriveEncryptionKey,
  deriveEncryptionIV,
} from './crypto/index.js'
import { AccountStorage } from './storage/index.js'
import { KeystoreService } from './account/index.js'
import { EscrowKeystore } from './escrow-keystore.js'
import {
  mineInboxKey,
  findNextSlot,
  writeToInbox,
  pollInbox as gsocPollInbox,
  subscribeToInbox as gsocSubscribeToInbox,
} from './gsoc.js'
import type { GSOCSubscription } from './gsoc.js'
import {
  generateKeyPair,
  encryptFile,
  decryptFile,
  serializeEncryptedFile,
  deserializeEncryptedFile,
} from './crypto/index.js'
import type {
  FairdropClientOptions,
  UploadOptions,
  SendOptions,
  SendResult,
  AccountSummary,
  InboxParams,
  StampInfo,
  ConnectionStatus,
  Message,
  HonestInbox,
  AnonymousMessage,
  InboxCallbacks,
  InboxSubscription,
  EscrowMetadata,
  CreateEscrowOptions,
  CreateEscrowResult,
  EscrowDetails,
  VerificationResult,
  CommitKeyResult,
  RevealKeyResult,
  ReputationResult,
  UnsignedTransaction,
  PrepareEscrowResult,
  PrepareCommitKeyResult,
  PrepareTransactionResult,
} from './types.js'
import { EscrowState } from './types.js'
import { DataEscrowABI } from './abi/DataEscrow.js'

/**
 * Internal account state
 */
interface AccountState {
  subdomain: string
  address: string
  publicKey: Uint8Array
  privateKey: Uint8Array
  inboxTopic?: Uint8Array
}

/**
 * Main Fairdrop SDK client
 */
export class FairdropClient {
  private readonly bee: Bee
  private readonly options: FairdropClientOptions
  private readonly accountStorage: AccountStorage
  private readonly keystoreService: KeystoreService
  private readonly escrowKeystore: EscrowKeystore
  private readonly crypto: CryptoProvider
  private readonly encoding: EncodingProvider
  private readonly contract: ContractProvider | null

  private wallet: WalletProvider | null = null
  private activeAccount: AccountState | null = null
  private stampBatchId: string | null = null
  private stampInfo: StampInfo | null = null
  private cachedAccounts: AccountSummary[] = []

  /** Escrow contract address (set via setEscrowContract) */
  private escrowContractAddress: `0x${string}` | null = null

  /** Chain ID for escrow operations */
  private chainId: number

  /** Public client for ENS resolution */
  private readonly ensClient: import('viem').PublicClient | null

  /** ENS domain for account registration (fairdrop.eth or fairdrop-dev.eth) */
  private readonly ensDomain: string

  /** Reputation API base URL */
  private readonly reputationApiUrl: string

  constructor(options: FairdropClientOptions) {
    this.options = options
    this.bee = new Bee(options.beeUrl)
    this.crypto = options.crypto
    this.encoding = options.encoding
    this.contract = options.contract ?? null

    // Initialize storage services
    this.accountStorage = new AccountStorage(
      options.storage,
      options.crypto,
      options.encoding
    )
    // Get ENS domain from options, config, or default to fairdrop.eth
    this.ensDomain = options.ensDomain ?? options.config?.get('ENS_DOMAIN') ?? 'fairdrop.eth'
    this.reputationApiUrl = options.reputationApiUrl ?? 'https://agents.datafund.io/api/v1'
    this.chainId = options.chainId ?? 8453
    this.ensClient = options.ensClient ?? null

    this.keystoreService = new KeystoreService(
      options.crypto,
      options.encoding,
      this.ensDomain
    )
    this.escrowKeystore = new EscrowKeystore(
      options.storage,
      options.crypto,
      options.encoding
    )

    // If private key provided, create embedded wallet
    if (options.privateKey) {
      import('@fairdrop/core/wallet').then(({ EmbeddedWalletProvider }) => {
        this.wallet = new EmbeddedWalletProvider(options.privateKey!)
      })
    } else if (options.wallet) {
      this.wallet = options.wallet
    }
  }

  // ===========================================================================
  // Account Management
  // ===========================================================================

  /**
   * Create a new account
   */
  async createAccount(subdomain: string, password: string): Promise<{ address: string }> {
    // Check if account already exists
    const existing = await this.accountStorage.getAccount(subdomain)
    if (existing) {
      throw new FairdropError(
        FairdropErrorCode.ACCOUNT_NOT_FOUND,
        `Account "${subdomain}" already exists`,
        false,
        false
      )
    }

    // Generate new keypair
    const keyPair = generateKeyPair()
    // Derive Ethereum address: keccak256 of uncompressed pubkey (sans prefix), last 20 bytes
    const uncompressed = secp256k1.ProjectivePoint.fromHex(keyPair.publicKey).toRawBytes(false)
    const pubKeyHash = keccak_256(uncompressed.slice(1))
    const address = this.encoding.bytesToHex(pubKeyHash.slice(-20))

    // Hash password
    const passwordHash = await this.accountStorage.hashPassword(password)

    // Generate inbox topic (hash of public key)
    const inboxTopic = await this.crypto.sha256(keyPair.publicKey)

    // Store account
    await this.accountStorage.saveAccount({
      subdomain: subdomain.toLowerCase(),
      address: `0x${address}`,
      publicKey: this.encoding.bytesToHex(keyPair.publicKey),
      encryptedPrivateKey: await this.encryptPrivateKey(keyPair.privateKey, password),
      passwordHash,
      createdAt: Date.now(),
    })

    // Set as active
    this.activeAccount = {
      subdomain: subdomain.toLowerCase(),
      address: `0x${address}`,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      inboxTopic,
    }

    await this.accountStorage.setActiveAccountSubdomain(subdomain.toLowerCase())

    return { address: `0x${address}` }
  }

  /**
   * Unlock an existing account
   */
  async unlockAccount(subdomain: string, password: string): Promise<void> {
    const account = await this.accountStorage.getAccount(subdomain)
    if (!account) {
      throw new FairdropError(
        FairdropErrorCode.ACCOUNT_NOT_FOUND,
        `Account "${subdomain}" not found`,
        false,
        false
      )
    }

    // Verify password
    const isValid = await this.accountStorage.verifyPassword(password, account.passwordHash)
    if (!isValid) {
      throw new FairdropError(
        FairdropErrorCode.INVALID_PASSWORD,
        'Invalid password',
        false,
        false
      )
    }

    // Decrypt private key
    if (!account.encryptedPrivateKey) {
      throw new FairdropError(
        FairdropErrorCode.ACCOUNT_LOCKED,
        'Account has no encrypted private key',
        false,
        false
      )
    }

    const privateKey = await this.decryptPrivateKey(account.encryptedPrivateKey, password)
    const publicKey = this.encoding.hexToBytes(account.publicKey)
    const inboxTopic = await this.crypto.sha256(publicKey)

    // Set as active
    this.activeAccount = {
      subdomain: account.subdomain,
      address: account.address,
      publicKey,
      privateKey,
      inboxTopic,
    }

    // Update last login
    await this.accountStorage.saveAccount({
      ...account,
      lastLoginAt: Date.now(),
    })

    await this.accountStorage.setActiveAccountSubdomain(subdomain.toLowerCase())
  }

  /**
   * Lock the current account (clear session)
   */
  async lockAccount(): Promise<void> {
    this.activeAccount = null
    await this.accountStorage.setActiveAccountSubdomain(null)
  }

  /**
   * Delete an account
   */
  async deleteAccount(subdomain: string): Promise<void> {
    const account = await this.accountStorage.getAccount(subdomain)
    if (!account) {
      throw new FairdropError(
        FairdropErrorCode.ACCOUNT_NOT_FOUND,
        `Account "${subdomain}" not found`,
        false,
        false
      )
    }

    // If this is the active account, lock it first
    if (this.activeAccount?.subdomain === subdomain.toLowerCase()) {
      await this.lockAccount()
    }

    await this.accountStorage.deleteAccount(subdomain)
  }

  /**
   * Export account as keystore
   */
  async exportAccount(password: string): Promise<object> {
    if (!this.activeAccount) {
      throw new FairdropError(
        FairdropErrorCode.ACCOUNT_LOCKED,
        'No active account',
        false,
        false
      )
    }

    const keystoreJson = await this.keystoreService.createKeystore(
      {
        subdomain: this.activeAccount.subdomain,
        publicKey: this.encoding.bytesToHex(this.activeAccount.publicKey),
        privateKey: this.encoding.bytesToHex(this.activeAccount.privateKey),
        inboxParams: (this.activeAccount as Record<string, unknown>).inboxParams as InboxParams | undefined,
        created: Date.now(),
      },
      password
    )

    return JSON.parse(keystoreJson)
  }

  /**
   * Import account from keystore
   */
  async importAccount(keystore: object, password: string): Promise<{ address: string }> {
    const keystoreJson = JSON.stringify(keystore)

    const { payload, passwordHash } = await this.keystoreService.parseKeystore(
      keystoreJson,
      password
    )

    // Check if account already exists
    const existing = await this.accountStorage.getAccount(payload.subdomain)
    if (existing) {
      throw new FairdropError(
        FairdropErrorCode.ACCOUNT_NOT_FOUND,
        `Account "${payload.subdomain}" already exists`,
        false,
        false
      )
    }

    // Derive address from public key
    const publicKey = this.encoding.hexToBytes(payload.publicKey)
    const address = `0x${this.encoding.bytesToHex(publicKey.slice(0, 20))}`

    // Store account
    await this.accountStorage.saveAccount({
      subdomain: payload.subdomain.toLowerCase(),
      address,
      publicKey: payload.publicKey,
      encryptedPrivateKey: await this.encryptPrivateKey(
        this.encoding.hexToBytes(payload.privateKey),
        password
      ),
      passwordHash,
      createdAt: payload.created,
    })

    return { address }
  }

  /**
   * Get active account (if any)
   */
  getActiveAccount(): AccountSummary | null {
    if (!this.activeAccount) {
      return null
    }

    return {
      subdomain: this.activeAccount.subdomain,
      address: this.activeAccount.address,
      unlocked: true,
    }
  }

  /**
   * List all accounts
   */
  listAccounts(): AccountSummary[] {
    return this.cachedAccounts
  }

  /**
   * List all accounts (async version)
   */
  async listAccountsAsync(): Promise<AccountSummary[]> {
    const accounts = await this.accountStorage.getAccounts()
    this.cachedAccounts = Object.values(accounts).map((a) => ({
      subdomain: a.subdomain,
      address: a.address,
      unlocked: this.activeAccount?.subdomain === a.subdomain,
    }))
    return this.cachedAccounts
  }

  /**
   * Get inbox params for sharing
   */
  getInboxParams(): InboxParams | null {
    if (!this.activeAccount) {
      return null
    }
    // Return GSOC inbox params if available on the active account
    const inboxParams = (this.activeAccount as Record<string, unknown>).inboxParams as InboxParams | undefined
    return inboxParams ?? null
  }

  /**
   * Get active account's private key (hex)
   * Used for decrypting encrypted refs and signing
   */
  getPrivateKey(): string | null {
    if (!this.activeAccount?.privateKey) {
      return null
    }
    return this.encoding.bytesToHex(this.activeAccount.privateKey)
  }

  /**
   * Get active account's public key (hex)
   * Used for encryption targeting this account
   */
  getPublicKey(): string | null {
    if (!this.activeAccount?.publicKey) {
      return null
    }
    return this.encoding.bytesToHex(this.activeAccount.publicKey)
  }

  /**
   * Lookup account by subdomain (returns full account info including public key)
   */
  async lookupAccount(subdomain: string): Promise<{ address: string; publicKey: string } | null> {
    const normalized = subdomain.replace(`.${this.ensDomain}`, '').toLowerCase()
    const account = await this.accountStorage.getAccount(normalized)
    if (!account) {
      return null
    }
    return {
      address: account.address,
      publicKey: account.publicKey,
    }
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  /**
   * Upload data to Swarm
   */
  async upload(data: Uint8Array, options?: UploadOptions): Promise<string> {
    const batchId = await this.getStampBatchId()

    const result = await this.bee.uploadData(batchId, data, {
      contentType: options?.contentType,
    })

    // bee-js Reference type needs .toString() to get hex string
    return result.reference.toString()
  }

  /**
   * Download data from Swarm
   */
  async download(reference: string): Promise<Uint8Array> {
    const data = await this.bee.downloadData(reference as Reference)
    // bee-js returns Bytes object with .bytes property containing the Buffer
    return Uint8Array.from(data.bytes)
  }

  /**
   * Upload multiple files
   */
  async uploadMultiple(files: Uint8Array[]): Promise<string[]> {
    return Promise.all(files.map((f) => this.upload(f)))
  }

  /**
   * Download multiple files
   */
  async downloadMultiple(refs: string[]): Promise<Uint8Array[]> {
    return Promise.all(refs.map((r) => this.download(r)))
  }

  // ===========================================================================
  // Messaging (Mode 1: Sender Revealed)
  // ===========================================================================

  /**
   * Send encrypted file to recipient
   */
  async sendFile(
    to: string,
    file: Uint8Array,
    options?: SendOptions
  ): Promise<SendResult> {
    if (!this.activeAccount) {
      throw new FairdropError(
        FairdropErrorCode.ACCOUNT_LOCKED,
        'No active account',
        false,
        false
      )
    }

    // Resolve recipient address
    const recipientAddress = await this.resolveRecipient(to)
    if (!recipientAddress) {
      throw new FairdropError(
        FairdropErrorCode.ACCOUNT_NOT_FOUND,
        `Could not resolve recipient: ${to}`,
        false,
        false
      )
    }

    // Get recipient's public key (would need lookup mechanism)
    // For now, we'll use the address as a placeholder
    const recipientPublicKey = this.encoding.hexToBytes(recipientAddress.slice(2).padEnd(66, '0'))

    // Encrypt file
    const encrypted = await encryptFile(
      this.crypto,
      file,
      { name: 'file', type: 'application/octet-stream', size: file.length },
      recipientPublicKey
    )

    // Serialize and upload
    const serialized = serializeEncryptedFile(encrypted)
    const reference = await this.upload(serialized)

    return {
      reference,
      to: recipientAddress,
      notified: false, // GSOC notification would go here
    }
  }

  // ===========================================================================
  // Anonymous Messaging (Mode 2: Honest Inbox)
  // ===========================================================================

  /**
   * Send anonymous file to recipient's public key.
   * Optionally notifies via GSOC inbox if inboxParams provided.
   */
  async sendAnonymous(
    recipientPublicKey: string,
    file: Uint8Array,
    options?: { inboxParams?: InboxParams; stampId?: string; filename?: string; size?: number; sender?: string; senderPubkey?: string; contentType?: string; note?: string }
  ): Promise<SendResult> {
    const publicKeyBytes = this.encoding.hexToBytes(recipientPublicKey)

    // Encrypt file
    const encrypted = await encryptFile(
      this.crypto,
      file,
      { name: options?.filename ?? 'anonymous', type: options?.contentType ?? 'application/octet-stream', size: file.length },
      publicKeyBytes
    )

    // Serialize and upload
    const serialized = serializeEncryptedFile(encrypted)
    const reference = await this.upload(serialized)

    let notified = false
    let notificationError: string | undefined

    // Write GSOC notification if inbox params provided
    if (options?.inboxParams) {
      const stampId = options.stampId ?? this.stampBatchId
      if (stampId) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const gsocOp = async () => {
              const slot = await findNextSlot(this.bee, options.inboxParams!)
              await writeToInbox(this.bee, options.inboxParams!, slot, {
                reference,
                filename: options.filename,
                size: options.size ?? file.length,
                sender: options.sender,
                senderPubkey: options.senderPubkey,
                contentType: options.contentType,
                note: options.note,
              }, stampId)
            }
            await Promise.race([
              gsocOp(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('GSOC notification timed out after 30s')), 30000)),
            ])
            notified = true
            notificationError = undefined
            break
          } catch (err) {
            notificationError = err instanceof Error ? err.message : String(err)
            if (attempt === 0) {
              await new Promise((r) => setTimeout(r, 2000))
            }
          }
        }
      }
    }

    return {
      reference,
      to: recipientPublicKey,
      notified,
      notificationError,
    }
  }

  /**
   * Create a new honest inbox.
   * Optionally mines GSOC parameters for real-time notifications.
   */
  async createHonestInbox(
    name: string,
    options?: { targetOverlay?: string; proximity?: number }
  ): Promise<HonestInbox> {
    // Generate dedicated keypair for this inbox
    const keyPair = generateKeyPair()
    const id = this.encoding.bytesToHex(await this.crypto.sha256(keyPair.publicKey)).slice(0, 16)
    const publicKeyHex = this.encoding.bytesToHex(keyPair.publicKey)
    const privateKeyHex = this.encoding.bytesToHex(keyPair.privateKey)

    const inbox: HonestInbox = {
      id,
      name,
      publicKey: publicKeyHex,
      privateKey: privateKeyHex,
      created: Date.now(),
    }

    // Mine GSOC parameters if overlay provided (or auto-detect)
    let overlay = options?.targetOverlay
    if (!overlay) {
      try {
        const addresses = await this.bee.getNodeAddresses()
        overlay = (addresses as Record<string, unknown>).overlay as string
      } catch {
        // Bee node may not be available; skip GSOC mining
      }
    }

    if (overlay) {
      const { params } = mineInboxKey(this.bee, overlay, options?.proximity ?? 16)
      inbox.gsocParams = {
        ...params,
        recipientPublicKey: publicKeyHex,
      }
    }

    // Store inbox
    if (this.activeAccount) {
      await this.accountStorage.saveHonestInbox({
        id,
        name,
        publicKey: publicKeyHex,
        privateKey: privateKeyHex,
        createdAt: inbox.created,
      })
    }

    return inbox
  }

  /**
   * Get messages from honest inbox via GSOC polling.
   */
  async getHonestInboxMessages(inboxId: string, lastKnownIndex?: number): Promise<AnonymousMessage[]> {
    // Load inbox from storage to get GSOC params
    const stored = await this.accountStorage.getHonestInbox(inboxId)
    if (!stored) {
      return []
    }

    // Check if we have GSOC params stored (need to retrieve from inbox object)
    // For now, use the inbox's stored gsocParams if available
    const gsocParams = (stored as Record<string, unknown>).gsocParams as InboxParams | undefined
    if (!gsocParams) {
      return []
    }

    const messages = await gsocPollInbox(this.bee, gsocParams, lastKnownIndex ?? 0)
    return messages.map((msg) => ({
      reference: msg.reference,
      timestamp: msg.timestamp,
      index: msg.index ?? 0,
    }))
  }

  /**
   * Get shareable link for honest inbox
   */
  getHonestInboxLink(inbox: HonestInbox): string {
    return `fairdrop://inbox/${inbox.id}?pk=${inbox.publicKey}`
  }

  // ===========================================================================
  // Inbox Operations
  // ===========================================================================

  /**
   * Poll inbox for new messages.
   * Uses GSOC polling if inbox params available, falls back to storage.
   */
  async pollInbox(lastIndex?: number): Promise<Message[]> {
    if (!this.activeAccount) {
      return []
    }

    // Try GSOC polling if account has inbox params
    const inboxParams = (this.activeAccount as Record<string, unknown>).inboxParams as InboxParams | undefined
    if (inboxParams) {
      try {
        const gsocMessages = await gsocPollInbox(this.bee, inboxParams, lastIndex ?? 0)
        return gsocMessages.map((msg) => ({
          reference: msg.reference,
          from: 'anonymous',
          timestamp: msg.timestamp,
          read: false,
          message: undefined,
          fileReference: msg.reference,
        }))
      } catch {
        // Fall through to storage-based polling
      }
    }

    // Fallback: return stored messages
    const messages = await this.accountStorage.getMessages(
      this.activeAccount.subdomain,
      'received'
    )

    return messages.map((m) => ({
      reference: m.reference,
      from: m.from || 'unknown',
      timestamp: m.timestamp,
      read: m.read,
      message: undefined,
      fileReference: m.reference,
    }))
  }

  /**
   * Subscribe to inbox updates.
   * Uses GSOC WebSocket subscription when inbox params available,
   * falls back to interval polling otherwise.
   */
  subscribeToInbox(callbacks: InboxCallbacks): InboxSubscription {
    // Try GSOC WebSocket subscription if account has inbox params
    const inboxParams = this.activeAccount
      ? (this.activeAccount as Record<string, unknown>).inboxParams as InboxParams | undefined
      : undefined

    if (inboxParams) {
      const gsocSub = gsocSubscribeToInbox(this.bee, inboxParams, 0, {
        onMessage: (msg) => {
          callbacks.onMessage({
            reference: msg.reference,
            from: 'anonymous',
            timestamp: msg.timestamp,
            read: false,
            message: undefined,
            fileReference: msg.reference,
          })
        },
        onError: (err) => callbacks.onError?.(err),
      })

      return {
        unsubscribe: () => gsocSub.cancel(),
      }
    }

    // Fallback: interval polling
    const interval = setInterval(async () => {
      try {
        const messages = await this.pollInbox()
        messages.forEach((m) => callbacks.onMessage(m))
      } catch (err) {
        callbacks.onError?.(err instanceof Error ? err : new Error(String(err)))
      }
    }, 30000)

    return {
      unsubscribe: () => clearInterval(interval),
    }
  }

  // ===========================================================================
  // Stamps
  // ===========================================================================

  /**
   * Assign a postage stamp batch
   */
  async assignStamp(batchId: string): Promise<void> {
    // Verify stamp exists and is usable
    try {
      const stamp = await this.bee.getPostageBatch(batchId as BatchId)
      this.stampBatchId = batchId
      this.stampInfo = {
        batchId,
        capacity: stamp.depth,
        expiresAt: stamp.duration.isZero() ? undefined : stamp.duration.toEndDate().getTime(),
      }
    } catch (err) {
      throw new FairdropError(
        FairdropErrorCode.NO_STAMP_AVAILABLE,
        `Invalid stamp batch: ${err instanceof Error ? err.message : String(err)}`,
        false,
        false
      )
    }
  }

  /**
   * Get current stamp info
   */
  getStampInfo(): StampInfo | null {
    return this.stampInfo
  }

  // ===========================================================================
  // ENS/Name Resolution
  // ===========================================================================

  /**
   * Lookup address by ENS name
   */
  async lookupAddress(name: string): Promise<string | null> {
    // Check if it's a Fairdrop subdomain
    if (name.endsWith(`.${this.ensDomain}`)) {
      const subdomain = name.replace(`.${this.ensDomain}`, '')
      const account = await this.accountStorage.getAccount(subdomain)
      if (account?.address) return account.address
    }

    // Try ENS resolution
    if (this.ensClient) {
      try {
        const address = await this.ensClient.getEnsAddress({ name })
        return address ?? null
      } catch (err) {
        throw new FairdropError(
          FairdropErrorCode.ENS_RESOLUTION_FAILED,
          `ENS lookup failed for ${name}: ${err instanceof Error ? err.message : String(err)}`,
          true,
          false
        )
      }
    }

    return null
  }

  /**
   * Reverse resolve address to name
   */
  async reverseResolve(address: string): Promise<string | null> {
    if (this.ensClient) {
      try {
        const name = await this.ensClient.getEnsName({ address: address as `0x${string}` })
        return name ?? null
      } catch (err) {
        throw new FairdropError(
          FairdropErrorCode.ENS_RESOLUTION_FAILED,
          `ENS reverse lookup failed for ${address}: ${err instanceof Error ? err.message : String(err)}`,
          true,
          false
        )
      }
    }
    return null
  }

  // ===========================================================================
  // Status
  // ===========================================================================

  /**
   * Check connection to Bee node
   */
  async checkConnection(): Promise<ConnectionStatus> {
    try {
      await this.bee.checkConnection()
      const versions = await this.bee.getVersions()

      return {
        connected: true,
        version: versions.beeVersion,
      }
    } catch (err) {
      return {
        connected: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Get Bee node info
   */
  async getBeeInfo(): Promise<object> {
    try {
      return await this.bee.getNodeInfo()
    } catch {
      return {}
    }
  }

  // ===========================================================================
  // Escrow Operations
  // ===========================================================================

  /**
   * Set the escrow contract address
   */
  setEscrowContract(address: `0x${string}`): void {
    this.escrowContractAddress = address
  }

  /**
   * Replace the contract provider at runtime.
   * Used to upgrade from read-only (gateway) to signing (local) mode
   * after an account logs in.
   */
  setContractProvider(provider: ContractProvider): void {
    this.contract = provider
  }


  /**
   * Create an escrow for selling encrypted data
   *
   * Flow:
   * 1. Generate encryption key
   * 2. Encrypt data with key
   * 3. Upload encrypted data to Swarm
   * 4. Create key commitment (keccak256(key || salt))
   * 5. Create escrow on-chain
   * 6. Store key securely in keystore for crash recovery
   *
   * @param password - Password to encrypt stored keys (for crash recovery)
   */
  async createEscrow(
    data: Uint8Array,
    metadata: EscrowMetadata,
    options: CreateEscrowOptions & { password?: string; derivedKey?: Uint8Array; derivedIV?: Uint8Array }
  ): Promise<CreateEscrowResult> {
    this.requireContractProvider()
    this.requireEscrowContract()

    // Use provided derived key or generate a random one
    const encryptionKey = options.derivedKey ?? generateEncryptionKey(this.crypto)

    // Use provided derived IV or generate a random one
    const iv = options.derivedIV ?? this.crypto.randomBytes(12)

    // Encrypt data with symmetric key (NOT ECIES - buyer will decrypt with revealed key)
    const ciphertext = await this.crypto.aesGcmEncrypt(data, encryptionKey, iv)

    // Combine IV + ciphertext for storage (buyer needs IV to decrypt)
    const encryptedBlob = this.concat(iv, ciphertext)

    // Upload encrypted data to Swarm
    const encryptedDataRef = await this.upload(encryptedBlob)

    // Calculate content hash using keccak256 (matches Solidity)
    const contentHash = keccak_256(encryptedBlob)

    // Create key commitment
    const { commitment, salt } = await createKeyCommitment(this.crypto, encryptionKey)

    // Convert to hex for on-chain
    const contentHashHex = `0x${this.encoding.bytesToHex(contentHash)}` as `0x${string}`
    const keyCommitmentHex = `0x${this.encoding.bytesToHex(commitment)}` as `0x${string}`

    // Create escrow on-chain
    const disputeWindow = BigInt(options.disputeWindowSeconds ?? 0)
    const txHash = await this.contract!.writeContract({
      address: this.escrowContractAddress!,
      abi: DataEscrowABI,
      functionName: 'createEscrowWithTerms',
      args: [contentHashHex, keyCommitmentHex, zeroAddress, options.price, BigInt(options.expiryDays), disputeWindow],
    })

    const receipt = await this.contract!.waitForTransaction(txHash)

    // Parse escrow ID from event
    const escrowId = this.parseEscrowIdFromReceipt(receipt)

    // Store keys securely for crash recovery (if password provided)
    if (options.password) {
      await this.escrowKeystore.storeKey(
        escrowId.toString(),
        { encryptionKey, salt },
        options.password
      )
    }

    return {
      escrowId,
      encryptedDataRef,
      keyCommitment: keyCommitmentHex,
      txHash,
      blockNumber: receipt.blockNumber,
      encryptionKey,
      salt,
    }
  }

  /**
   * Recover stored escrow keys (for crash recovery)
   *
   * Call this if you need to retrieve keys after a browser crash.
   */
  async recoverEscrowKeys(
    escrowId: string,
    password: string
  ): Promise<{ encryptionKey: Uint8Array; salt: Uint8Array; commitmentSalt?: Uint8Array } | null> {
    return this.escrowKeystore.getKey(escrowId, password)
  }

  /**
   * List stored escrow keys (metadata only, not decrypted)
   */
  async listStoredEscrowKeys(): Promise<Array<{ escrowId: string; status: string; createdAt: number }>> {
    return this.escrowKeystore.listKeys()
  }

  /**
   * Delete stored escrow key (after successful claim)
   */
  async deleteStoredEscrowKey(escrowId: string): Promise<void> {
    await this.escrowKeystore.deleteKey(escrowId)
  }

  /**
   * Create an escrow for an existing skill using deterministic key derivation.
   *
   * The encryption key is derived from the seller's private key + plaintext hash,
   * so the same content always produces the same ciphertext and Swarm reference.
   * This enables multiple escrows for the same content without re-uploading.
   *
   * @param data - Plaintext data to sell
   * @param metadata - Escrow metadata
   * @param options - Escrow options (price, expiry)
   * @returns Same as createEscrow but with deterministic keys
   */
  async createEscrowForSkill(
    data: Uint8Array,
    metadata: EscrowMetadata,
    options: CreateEscrowOptions & { password?: string }
  ): Promise<CreateEscrowResult> {
    if (!this.activeAccount?.privateKey) {
      throw new FairdropError(
        FairdropErrorCode.ACCOUNT_LOCKED,
        'Account must be unlocked to derive deterministic keys',
        false,
        false
      )
    }

    // Hash the plaintext to use as HKDF info
    const plaintextHash = keccak_256(data)

    // Derive deterministic key and IV
    const derivedKey = deriveEncryptionKey(this.activeAccount.privateKey, plaintextHash)
    const derivedIV = deriveEncryptionIV(this.activeAccount.privateKey, plaintextHash)

    return this.createEscrow(data, metadata, { ...options, derivedKey, derivedIV })
  }

  /**
   * Fund an escrow as buyer
   */
  async fundEscrow(escrowId: bigint): Promise<`0x${string}`> {
    this.requireContractProvider()
    this.requireEscrowContract()

    // Get escrow details for amount
    const escrow = await this.getEscrowDetails(escrowId)
    if (escrow.state !== EscrowState.CREATED) {
      throw escrowError(
        FairdropErrorCode.ESCROW_INVALID_STATE,
        `Escrow ${escrowId} is not in CREATED state`
      )
    }

    const txHash = await this.contract!.writeContract({
      address: this.escrowContractAddress!,
      abi: DataEscrowABI,
      functionName: 'fundEscrow',
      args: [escrowId],
      value: escrow.amount,
    })

    await this.contract!.waitForTransaction(txHash)
    return txHash
  }

  /**
   * Commit to releasing the encrypted key (Phase 1 of release)
   *
   * Seller commits to the encrypted key before revealing.
   * This prevents front-running attacks.
   *
   * IMPORTANT: The returned `serializedEncryptedKey` and `commitmentSalt`
   * MUST be preserved for the reveal phase. They can be stored in the
   * EscrowKeystore using the password parameter.
   */
  async commitKeyRelease(
    escrowId: bigint,
    encryptionKey: Uint8Array,
    buyerPublicKey: Uint8Array,
    password?: string
  ): Promise<CommitKeyResult> {
    this.requireContractProvider()
    this.requireEscrowContract()

    // Encrypt key for buyer using ECDH
    const encryptedKeyPackage = await encryptKeyForBuyer(
      this.crypto,
      encryptionKey,
      buyerPublicKey
    )

    // Serialize for on-chain storage
    const serializedEncryptedKey = serializeEncryptedKey(encryptedKeyPackage)

    // Create commitment to encrypted key
    const { commitment, salt: commitmentSalt } = await createEncryptedKeyCommitment(
      this.crypto,
      serializedEncryptedKey
    )

    const encryptedKeyCommitmentHex = `0x${this.encoding.bytesToHex(commitment)}` as `0x${string}`

    // Commit on-chain
    const txHash = await this.contract!.writeContract({
      address: this.escrowContractAddress!,
      abi: DataEscrowABI,
      functionName: 'commitKeyRelease',
      args: [escrowId, encryptedKeyCommitmentHex],
    })

    const receipt = await this.contract!.waitForTransaction(txHash)

    // Store in keystore for crash recovery (if password provided)
    if (password) {
      await this.escrowKeystore.updateStatus(
        escrowId.toString(),
        'committed',
        commitmentSalt,
        password,
        serializedEncryptedKey
      )
    }

    return {
      txHash,
      blockNumber: receipt.blockNumber,
      commitTimestamp: Math.floor(Date.now() / 1000),
      encryptedKeyCommitment: encryptedKeyCommitmentHex,
      serializedEncryptedKey,
      commitmentSalt,
    }
  }

  /**
   * Reveal the encrypted key (Phase 2 of release)
   *
   * Must wait MIN_BLOCK_DELAY blocks AND MIN_TIME_DELAY seconds
   * after commitKeyRelease before calling this.
   *
   * IMPORTANT: Use the SAME serializedEncryptedKey and commitmentSalt
   * returned from commitKeyRelease(). Re-encrypting will NOT work
   * because ECDH uses different ephemeral keys each time.
   */
  async revealKey(
    escrowId: bigint,
    serializedEncryptedKey: Uint8Array,
    commitmentSalt: Uint8Array,
    password?: string
  ): Promise<RevealKeyResult> {
    this.requireContractProvider()
    this.requireEscrowContract()

    // If password provided, try to get stored key from keystore
    let keyToReveal = serializedEncryptedKey
    let saltToUse = commitmentSalt

    if (password) {
      const storedKeys = await this.escrowKeystore.getKey(escrowId.toString(), password)
      if (storedKeys?.serializedEncryptedKey && storedKeys?.commitmentSalt) {
        keyToReveal = storedKeys.serializedEncryptedKey
        saltToUse = storedKeys.commitmentSalt
      }
    }

    const saltHex = `0x${this.encoding.bytesToHex(saltToUse)}` as `0x${string}`

    const txHash = await this.contract!.writeContract({
      address: this.escrowContractAddress!,
      abi: DataEscrowABI,
      functionName: 'revealKey',
      args: [escrowId, keyToReveal, saltHex],
    })

    await this.contract!.waitForTransaction(txHash)

    // Update keystore status
    if (password) {
      await this.escrowKeystore.updateStatus(escrowId.toString(), 'revealed')
    }

    return {
      txHash,
      encryptedKeyForBuyer: keyToReveal,
    }
  }

  /**
   * Claim payment after successful key release (seller)
   *
   * Must wait DISPUTE_WINDOW after key release.
   */
  async claimPayment(escrowId: bigint): Promise<`0x${string}`> {
    this.requireContractProvider()
    this.requireEscrowContract()

    const txHash = await this.contract!.writeContract({
      address: this.escrowContractAddress!,
      abi: DataEscrowABI,
      functionName: 'claimPayment',
      args: [escrowId],
    })

    await this.contract!.waitForTransaction(txHash)
    return txHash
  }

  /**
   * Claim refund for expired escrow (buyer)
   */
  async claimExpired(escrowId: bigint): Promise<`0x${string}`> {
    this.requireContractProvider()
    this.requireEscrowContract()

    const txHash = await this.contract!.writeContract({
      address: this.escrowContractAddress!,
      abi: DataEscrowABI,
      functionName: 'claimExpired',
      args: [escrowId],
    })

    await this.contract!.waitForTransaction(txHash)
    return txHash
  }

  /**
   * Raise a dispute (buyer)
   *
   * Requires 5% dispute bond.
   * Must be within DISPUTE_WINDOW after key release.
   */
  async disputeEscrow(escrowId: bigint): Promise<`0x${string}`> {
    this.requireContractProvider()
    this.requireEscrowContract()

    // Get escrow to calculate required bond
    const escrow = await this.getEscrowDetails(escrowId)
    const requiredBond = (escrow.amount * 5n) / 100n

    const txHash = await this.contract!.writeContract({
      address: this.escrowContractAddress!,
      abi: DataEscrowABI,
      functionName: 'disputeEscrow',
      args: [escrowId],
      value: requiredBond,
    })

    await this.contract!.waitForTransaction(txHash)
    return txHash
  }

  /**
   * Get escrow details from chain
   */
  async getEscrowDetails(escrowId: bigint): Promise<EscrowDetails> {
    this.requireContractProvider()
    this.requireEscrowContract()

    const result = await this.contract!.readContract<readonly [
      `0x${string}`, // 0: seller
      `0x${string}`, // 1: buyer
      `0x${string}`, // 2: paymentToken
      `0x${string}`, // 3: contentHash
      `0x${string}`, // 4: keyCommitment
      `0x${string}`, // 5: encryptedKeyCommitment
      bigint, // 6: amount
      bigint, // 7: expiresAt
      bigint, // 8: disputeWindow
      bigint, // 9: commitBlock
      bigint, // 10: commitTimestamp
      bigint, // 11: releaseTimestamp
      bigint, // 12: disputeRaisedAt
      bigint, // 13: disputeBond
      `0x${string}`, // 14: sellerResponseHash
      bigint, // 15: sellerAgentId
      bigint, // 16: buyerAgentId
      number, // 17: state
    ]>({
      address: this.escrowContractAddress!,
      abi: DataEscrowABI,
      functionName: 'escrows',
      args: [escrowId],
    })

    return {
      escrowId,
      seller: result[0],
      buyer: result[1],
      contentHash: result[3],
      keyCommitment: result[4],
      amount: result[6],
      expiresAt: result[7],
      state: result[17] as EscrowState,
      commitBlock: result[9],
      commitTimestamp: result[10],
      releaseTimestamp: result[11],
      disputeRaisedAt: result[12],
      disputeBond: result[13],
    }
  }

  /**
   * Decrypt and verify purchased data as buyer
   *
   * Uses the encrypted key from the KeyRevealed event.
   * Verifies the decrypted content matches the on-chain content hash.
   *
   * @param escrowId - Escrow ID to verify against
   * @param swarmReference - Swarm reference from seller (not same as contentHash!)
   * @param encryptedKeyForBuyer - Encrypted key from KeyRevealed event
   * @param buyerPrivateKey - Buyer's private key for decryption
   * @returns Decrypted and verified data
   * @throws If decryption fails or content hash doesn't match
   */
  async decryptPurchasedData(
    escrowId: bigint,
    swarmReference: string,
    encryptedKeyForBuyer: Uint8Array,
    buyerPrivateKey: Uint8Array
  ): Promise<Uint8Array> {
    // Get escrow details for content hash verification
    const escrow = await this.getEscrowDetails(escrowId)

    // Deserialize and decrypt the encryption key
    const encryptedKeyPackage = deserializeEncryptedKey(encryptedKeyForBuyer)
    const decryptionKey = await decryptKeyAsBuyer(
      this.crypto,
      encryptedKeyPackage,
      buyerPrivateKey
    )

    // Download encrypted data from Swarm
    const encryptedBlob = await this.download(swarmReference)

    // Verify the encrypted data hash matches on-chain (keccak256 to match Solidity)
    const actualContentHash = keccak_256(encryptedBlob)
    const expectedContentHash = this.encoding.hexToBytes(escrow.contentHash.slice(2))

    let hashMatches = actualContentHash.length === expectedContentHash.length
    if (hashMatches) {
      for (let i = 0; i < actualContentHash.length; i++) {
        if (actualContentHash[i] !== expectedContentHash[i]) {
          hashMatches = false
          break
        }
      }
    }

    if (!hashMatches) {
      throw escrowError(
        FairdropErrorCode.ESCROW_INVALID_KEY,
        'Content hash mismatch: downloaded data does not match on-chain hash'
      )
    }

    // Extract IV and ciphertext from blob (IV is first 12 bytes)
    const iv = encryptedBlob.slice(0, 12)
    const ciphertext = encryptedBlob.slice(12)

    try {
      // Decrypt using AES-GCM with the revealed key
      const decrypted = await this.crypto.aesGcmDecrypt(ciphertext, decryptionKey, iv)
      return decrypted
    } catch (err) {
      throw escrowError(
        FairdropErrorCode.ESCROW_INVALID_KEY,
        `Decryption failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  /**
   * Verify purchased data without downloading (quick check)
   *
   * Verifies the key commitment matches the revealed key.
   * This is a quick check that doesn't require downloading the full data.
   *
   * @param escrowId - Escrow ID
   * @param encryptedKeyForBuyer - Encrypted key from KeyRevealed event
   * @param salt - Commitment salt from reveal
   * @param buyerPrivateKey - Buyer's private key
   * @returns Verification result
   */
  async verifyKeyCommitment(
    escrowId: bigint,
    encryptedKeyForBuyer: Uint8Array,
    salt: Uint8Array,
    buyerPrivateKey: Uint8Array
  ): Promise<VerificationResult> {
    const { verifyKeyCommitment: verifyCommitment } = await import('@fairdrop/core/crypto')

    const escrow = await this.getEscrowDetails(escrowId)

    // Decrypt the key
    const encryptedKeyPackage = deserializeEncryptedKey(encryptedKeyForBuyer)
    const decryptedKey = await decryptKeyAsBuyer(
      this.crypto,
      encryptedKeyPackage,
      buyerPrivateKey
    )

    // Verify the key matches the original commitment
    const keyCommitmentBytes = this.encoding.hexToBytes(escrow.keyCommitment.slice(2))
    const isValid = await verifyCommitment(this.crypto, decryptedKey, salt, keyCommitmentBytes)

    return {
      valid: isValid,
      contentHash: escrow.contentHash,
      metadata: { contentHash: escrow.contentHash, seller: escrow.seller },
      price: escrow.amount,
      expiresAt: Number(escrow.expiresAt),
    }
  }

  // ===========================================================================
  // Prepare Operations (keyless gateway — return unsigned transactions)
  // ===========================================================================

  /**
   * Prepare an escrow: encrypt, upload to Swarm, return unsigned tx.
   * No ContractProvider or private key needed on the server.
   */
  async prepareEscrow(
    data: Uint8Array,
    metadata: EscrowMetadata,
    options: CreateEscrowOptions & { derivedKey?: Uint8Array; derivedIV?: Uint8Array }
  ): Promise<PrepareEscrowResult> {
    this.requireEscrowContract()

    const encryptionKey = options.derivedKey ?? generateEncryptionKey(this.crypto)
    const iv = options.derivedIV ?? this.crypto.randomBytes(12)

    // Encrypt and upload (off-chain)
    const ciphertext = await this.crypto.aesGcmEncrypt(data, encryptionKey, iv)
    const encryptedBlob = this.concat(iv, ciphertext)
    const encryptedDataRef = await this.upload(encryptedBlob)

    // Compute on-chain parameters
    const contentHash = keccak_256(encryptedBlob)
    const { commitment, salt } = await createKeyCommitment(this.crypto, encryptionKey)
    const contentHashHex = `0x${this.encoding.bytesToHex(contentHash)}` as `0x${string}`
    const keyCommitmentHex = `0x${this.encoding.bytesToHex(commitment)}` as `0x${string}`
    // Encode calldata (no signing)
    const disputeWindow = BigInt(options.disputeWindowSeconds ?? 0)
    const data_ = encodeFunctionData({
      abi: DataEscrowABI,
      functionName: 'createEscrowWithTerms',
      args: [contentHashHex, keyCommitmentHex, zeroAddress, options.price, BigInt(options.expiryDays), disputeWindow],
    })

    return {
      transaction: {
        to: this.escrowContractAddress!,
        data: data_,
        value: '0x0' as `0x${string}`,
        chainId: this.getEscrowChainId(),
      },
      encryptedDataRef,
      contentHash: contentHashHex,
      keyCommitment: keyCommitmentHex,
      encryptionKey: this.encoding.bytesToHex(encryptionKey),
      salt: this.encoding.bytesToHex(salt),
    }
  }

  /**
   * Prepare escrow with deterministic keys (for skill copies).
   * Requires unlocked account for key derivation.
   */
  async prepareEscrowForSkill(
    data: Uint8Array,
    metadata: EscrowMetadata,
    options: CreateEscrowOptions
  ): Promise<PrepareEscrowResult> {
    if (!this.activeAccount?.privateKey) {
      throw new FairdropError(
        FairdropErrorCode.ACCOUNT_LOCKED,
        'Account must be unlocked to derive deterministic keys',
        false,
        false
      )
    }

    const plaintextHash = keccak_256(data)
    const derivedKey = deriveEncryptionKey(this.activeAccount.privateKey, plaintextHash)
    const derivedIV = deriveEncryptionIV(this.activeAccount.privateKey, plaintextHash)

    return this.prepareEscrow(data, metadata, { ...options, derivedKey, derivedIV })
  }

  /**
   * Prepare fund escrow transaction (buyer).
   * Needs ContractProvider for reading escrow amount.
   */
  async prepareFundEscrow(escrowId: bigint): Promise<PrepareTransactionResult> {
    this.requireContractProvider()
    this.requireEscrowContract()

    const escrow = await this.getEscrowDetails(escrowId)
    if (escrow.state !== EscrowState.CREATED) {
      throw escrowError(
        FairdropErrorCode.ESCROW_INVALID_STATE,
        `Escrow ${escrowId} is not in CREATED state`
      )
    }

    const data = encodeFunctionData({
      abi: DataEscrowABI,
      functionName: 'fundEscrow',
      args: [escrowId],
    })

    return {
      transaction: {
        to: this.escrowContractAddress!,
        data,
        value: `0x${escrow.amount.toString(16)}` as `0x${string}`,
        chainId: this.getEscrowChainId(),
      },
    }
  }

  /**
   * Prepare commit key release transaction (seller, phase 1).
   */
  async prepareCommitKeyRelease(
    escrowId: bigint,
    encryptionKey: Uint8Array,
    buyerPublicKey: Uint8Array
  ): Promise<PrepareCommitKeyResult> {
    this.requireEscrowContract()

    const encryptedKeyPackage = await encryptKeyForBuyer(
      this.crypto,
      encryptionKey,
      buyerPublicKey
    )
    const serializedEncryptedKey = serializeEncryptedKey(encryptedKeyPackage)
    const { commitment, salt: commitmentSalt } = await createEncryptedKeyCommitment(
      this.crypto,
      serializedEncryptedKey
    )
    const encryptedKeyCommitmentHex = `0x${this.encoding.bytesToHex(commitment)}` as `0x${string}`

    const data = encodeFunctionData({
      abi: DataEscrowABI,
      functionName: 'commitKeyRelease',
      args: [escrowId, encryptedKeyCommitmentHex],
    })

    return {
      transaction: {
        to: this.escrowContractAddress!,
        data,
        value: '0x0' as `0x${string}`,
        chainId: this.getEscrowChainId(),
      },
      encryptedKeyCommitment: encryptedKeyCommitmentHex,
      serializedEncryptedKey: this.encoding.bytesToHex(serializedEncryptedKey),
      commitmentSalt: this.encoding.bytesToHex(commitmentSalt),
    }
  }

  /**
   * Prepare reveal key transaction (seller, phase 2).
   */
  prepareRevealKey(
    escrowId: bigint,
    serializedEncryptedKey: Uint8Array,
    commitmentSalt: Uint8Array
  ): PrepareTransactionResult {
    this.requireEscrowContract()

    const encKeyHex = `0x${this.encoding.bytesToHex(serializedEncryptedKey)}` as `0x${string}`
    const saltHex = `0x${this.encoding.bytesToHex(commitmentSalt)}` as `0x${string}`

    const data = encodeFunctionData({
      abi: DataEscrowABI,
      functionName: 'revealKey',
      args: [escrowId, encKeyHex, saltHex],
    })

    return {
      transaction: {
        to: this.escrowContractAddress!,
        data,
        value: '0x0' as `0x${string}`,
        chainId: this.getEscrowChainId(),
      },
    }
  }

  /**
   * Prepare claim payment transaction (seller).
   */
  prepareClaimPayment(escrowId: bigint): PrepareTransactionResult {
    this.requireEscrowContract()

    const data = encodeFunctionData({
      abi: DataEscrowABI,
      functionName: 'claimPayment',
      args: [escrowId],
    })

    return {
      transaction: {
        to: this.escrowContractAddress!,
        data,
        value: '0x0' as `0x${string}`,
        chainId: this.getEscrowChainId(),
      },
    }
  }

  /**
   * Prepare claim expired transaction (buyer refund).
   */
  prepareClaimExpired(escrowId: bigint): PrepareTransactionResult {
    this.requireEscrowContract()

    const data = encodeFunctionData({
      abi: DataEscrowABI,
      functionName: 'claimExpired',
      args: [escrowId],
    })

    return {
      transaction: {
        to: this.escrowContractAddress!,
        data,
        value: '0x0' as `0x${string}`,
        chainId: this.getEscrowChainId(),
      },
    }
  }

  /**
   * Prepare dispute escrow transaction (buyer).
   * Needs ContractProvider to read escrow amount for bond calculation.
   */
  async prepareDisputeEscrow(escrowId: bigint): Promise<PrepareTransactionResult> {
    this.requireContractProvider()
    this.requireEscrowContract()

    const escrow = await this.getEscrowDetails(escrowId)
    const requiredBond = (escrow.amount * 5n) / 100n

    const data = encodeFunctionData({
      abi: DataEscrowABI,
      functionName: 'disputeEscrow',
      args: [escrowId],
    })

    return {
      transaction: {
        to: this.escrowContractAddress!,
        data,
        value: `0x${requiredBond.toString(16)}` as `0x${string}`,
        chainId: this.getEscrowChainId(),
      },
    }
  }

  // ===========================================================================
  // Reputation Operations
  // ===========================================================================

  /**
   * Check seller reputation before funding an escrow
   *
   * Queries the reputation API for the seller's agent or wallet reputation.
   * Returns a recommendation (proceed/caution/avoid) based on the score.
   *
   * @param escrowId - Escrow to check seller reputation for
   * @param minScore - Minimum score to consider safe (default: 700 = gold tier)
   * @returns ReputationResult with score, tier, and recommendation
   */
  async checkSellerReputation(escrowId: bigint, minScore = 700): Promise<ReputationResult> {
    const escrow = await this.getEscrowDetails(escrowId)

    // Try agent reputation first (if seller has an agent ID)
    try {
      const agentsRes = await this.fetchReputationApi(`/agents/${0}/reputation`)
      // We need the agent ID from the contract — use getEscrowAgents if available
      let sellerAgentId = 0
      try {
        const agents = await this.contract!.readContract<readonly [bigint, bigint]>({
          address: this.escrowContractAddress!,
          abi: DataEscrowABI,
          functionName: 'getEscrowAgents',
          args: [escrowId],
        })
        sellerAgentId = Number(agents[0])
      } catch {
        // getEscrowAgents may not exist on older contracts
      }

      if (sellerAgentId > 0) {
        const agentRep = await this.fetchReputationApi(`/agents/${sellerAgentId}/reputation`)
        if (agentRep) {
          const safe = agentRep.score >= minScore
          return {
            safe,
            score: agentRep.score,
            tier: agentRep.tier,
            recommendation: agentRep.recommendation,
            reason: safe ? undefined : `Agent score ${agentRep.score} below minimum ${minScore}`,
            agentId: sellerAgentId,
            metrics: agentRep.metrics,
          }
        }
      }
    } catch {
      // Fall through to wallet lookup
    }

    // Fall back to wallet reputation
    try {
      const walletRep = await this.fetchReputationApi(`/wallets/${escrow.seller}/reputation`)
      if (walletRep?.seller) {
        const rep = walletRep.seller
        const safe = rep.score >= minScore
        return {
          safe,
          score: rep.score,
          tier: rep.tier,
          recommendation: rep.recommendation,
          reason: safe ? undefined : `Seller score ${rep.score} below minimum ${minScore}`,
          metrics: rep.metrics,
        }
      }
    } catch {
      // API unavailable
    }

    // API unavailable or no data — return cautious default
    return {
      safe: false,
      score: 500,
      tier: 'new',
      recommendation: 'caution',
      reason: 'Reputation data unavailable',
    }
  }

  /**
   * Fund an escrow with automatic reputation check
   *
   * Checks seller reputation first. If score is below minScore, throws an error.
   * The caller can catch the error and decide whether to proceed anyway.
   *
   * @param escrowId - Escrow to fund
   * @param minScore - Minimum reputation score (default: 700)
   * @returns Transaction hash
   * @throws If reputation check fails (score below minimum)
   */
  async fundEscrowSafe(escrowId: bigint, minScore = 700): Promise<`0x${string}`> {
    const rep = await this.checkSellerReputation(escrowId, minScore)

    if (!rep.safe) {
      throw escrowError(
        FairdropErrorCode.ESCROW_INVALID_STATE,
        `Seller reputation check failed: ${rep.reason ?? `score ${rep.score} < ${minScore}`}. ` +
        `Tier: ${rep.tier}, recommendation: ${rep.recommendation}. ` +
        `Use fundEscrow() to bypass this check.`
      )
    }

    return this.fundEscrow(escrowId)
  }

  /**
   * Fetch from the reputation API
   */
  private async fetchReputationApi(path: string): Promise<any> {
    const url = `${this.reputationApiUrl}${path}`
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    return res.json()
  }

  // ===========================================================================
  // ACT (Access Control Trie) Operations
  // ===========================================================================

  /**
   * Upload data with ACT access control
   *
   * Only specified grantees can decrypt the content.
   * Uses bee-js createGrantees API.
   *
   * @param data - Data to upload
   * @param grantees - List of grantee public keys (hex strings)
   * @returns Upload result with reference and history address
   */
  async uploadWithAct(
    data: Uint8Array,
    grantees: string[]
  ): Promise<{ reference: string; historyAddress: string; granteeCount: number }> {
    if (!this.activeAccount) {
      throw new FairdropError(
        FairdropErrorCode.ACCOUNT_LOCKED,
        'No active account',
        false,
        false
      )
    }

    const batchId = await this.getStampBatchId()

    // Convert hex strings to the format bee-js expects
    const granteeKeys = grantees.map((g) => g.startsWith('0x') ? g.slice(2) : g)

    // Create grantee list and upload data
    const result = await this.bee.createGrantees(batchId, granteeKeys)

    // Upload the actual data
    const uploadResult = await this.bee.uploadData(batchId, data)

    return {
      reference: uploadResult.reference.toString(),
      historyAddress: result.historyref.toString(),
      granteeCount: grantees.length,
    }
  }

  /**
   * Download ACT-protected content
   *
   * Requires the caller to be a grantee with access.
   *
   * @param reference - Swarm reference
   * @param historyAddress - ACT history address
   * @param publisherPubkey - Publisher's public key
   * @returns Downloaded data
   */
  async downloadWithAct(
    reference: string,
    historyAddress: string,
    publisherPubkey: string
  ): Promise<Uint8Array> {
    if (!this.activeAccount) {
      throw new FairdropError(
        FairdropErrorCode.ACCOUNT_LOCKED,
        'No active account',
        false,
        false
      )
    }

    // Download data - bee-js handles ACT decryption if caller is a grantee
    const data = await this.bee.downloadData(reference)
    return Uint8Array.from(data.bytes)
  }

  /**
   * Add grantees to existing ACT-protected content
   *
   * @param reference - Swarm reference
   * @param historyAddress - ACT history address
   * @param grantees - Public keys to grant access to
   * @returns Updated grantees result
   */
  async addGrantees(
    reference: string,
    historyAddress: string,
    grantees: string[]
  ): Promise<{ reference: string; historyAddress: string; added: string[] }> {
    const batchId = await this.getStampBatchId()

    const granteeKeys = grantees.map((g) => g.startsWith('0x') ? g.slice(2) : g)

    const result = await this.bee.patchGrantees(
      batchId,
      reference,
      historyAddress,
      { add: granteeKeys }
    )

    return {
      reference: result.ref.toString(),
      historyAddress: result.historyref.toString(),
      added: grantees,
    }
  }

  /**
   * Revoke access from grantees on ACT-protected content
   *
   * @param reference - Swarm reference
   * @param historyAddress - ACT history address
   * @param grantees - Public keys to revoke access from
   * @returns Updated grantees result
   */
  async revokeGrantees(
    reference: string,
    historyAddress: string,
    grantees: string[]
  ): Promise<{ reference: string; historyAddress: string; removed: string[] }> {
    const batchId = await this.getStampBatchId()

    const granteeKeys = grantees.map((g) => g.startsWith('0x') ? g.slice(2) : g)

    const result = await this.bee.patchGrantees(
      batchId,
      reference,
      historyAddress,
      { revoke: granteeKeys }
    )

    return {
      reference: result.ref.toString(),
      historyAddress: result.historyref.toString(),
      removed: grantees,
    }
  }

  /**
   * List current grantees for ACT-protected content
   *
   * @param reference - Swarm reference (the ACT reference from createGrantees)
   * @returns List of grantee public keys
   */
  async listGrantees(reference: string): Promise<string[]> {
    const result = await this.bee.getGrantees(reference)
    return result.grantees.map((g) => g.toString())
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Get stamp batch ID, using auto-detection if not set
   */
  private async getStampBatchId(): Promise<BatchId> {
    if (this.stampBatchId) {
      return this.stampBatchId as BatchId
    }

    // Try to find a usable stamp
    try {
      const stamps = await this.bee.getAllPostageBatch()
      const usable = stamps.find((s) => s.usable)

      if (usable) {
        this.stampBatchId = usable.batchID
        return usable.batchID as BatchId
      }
    } catch {
      // Ignore errors, throw below
    }

    throw new FairdropError(
      FairdropErrorCode.NO_STAMP_AVAILABLE,
      'No postage stamp assigned. Call assignStamp() first.',
      false,
      false
    )
  }

  /**
   * Encrypt private key for storage
   */
  private async encryptPrivateKey(privateKey: Uint8Array, password: string): Promise<string> {
    const salt = this.crypto.randomBytes(16)
    const iv = this.crypto.randomBytes(12)

    // Derive key from password
    const passwordBytes = new TextEncoder().encode(password)
    const keyMaterial = await this.crypto.sha256(
      this.concat(passwordBytes, salt)
    )

    // Encrypt
    const encrypted = await this.crypto.aesGcmEncrypt(privateKey, keyMaterial, iv)

    // Encode: salt (16) + iv (12) + ciphertext
    const result = this.concat(salt, iv, encrypted)
    return this.encoding.base64Encode(result)
  }

  /**
   * Decrypt private key from storage
   */
  private async decryptPrivateKey(encryptedKey: string, password: string): Promise<Uint8Array> {
    const data = this.encoding.base64Decode(encryptedKey)

    const salt = data.slice(0, 16)
    const iv = data.slice(16, 28)
    const ciphertext = data.slice(28)

    // Derive key from password
    const passwordBytes = new TextEncoder().encode(password)
    const keyMaterial = await this.crypto.sha256(
      this.concat(passwordBytes, salt)
    )

    // Decrypt
    return this.crypto.aesGcmDecrypt(ciphertext, keyMaterial, iv)
  }

  /**
   * Resolve recipient to address
   */
  private async resolveRecipient(to: string): Promise<string | null> {
    // Check if already an address
    if (to.startsWith('0x') && to.length === 42) {
      return to
    }

    // Try ENS/subdomain lookup
    return this.lookupAddress(to.includes('.') ? to : `${to}.${this.ensDomain}`)
  }

  /**
   * Concatenate Uint8Arrays
   */
  private concat(...arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const arr of arrays) {
      result.set(arr, offset)
      offset += arr.length
    }
    return result
  }

  /**
   * Require contract provider for escrow operations
   */
  private requireContractProvider(): void {
    if (!this.contract) {
      throw escrowError(
        FairdropErrorCode.ESCROW_CREATE_FAILED,
        'Contract provider not configured. Pass contract option to FairdropClient.'
      )
    }
  }

  /**
   * Get the chain ID for escrow operations.
   * Returns the chain ID from the contract provider, or defaults to Base.
   */
  private getEscrowChainId(): number {
    return this.chainId
  }

  /**
   * Require escrow contract address
   */
  private requireEscrowContract(): void {
    if (!this.escrowContractAddress) {
      throw escrowError(
        FairdropErrorCode.ESCROW_CREATE_FAILED,
        'Escrow contract address not set. Call setEscrowContract() first.'
      )
    }
  }

  /**
   * Parse escrow ID from transaction receipt
   */
  private parseEscrowIdFromReceipt(receipt: import('@fairdrop/core').TransactionReceipt): bigint {
    // Compute EscrowCreated topic from ABI
    const escrowCreatedEvent = DataEscrowABI.find(
      (item) => item.type === 'event' && item.name === 'EscrowCreated'
    )
    if (!escrowCreatedEvent) {
      throw escrowError(
        FairdropErrorCode.ESCROW_CREATE_FAILED,
        'EscrowCreated event not found in ABI'
      )
    }

    const topic0 = getEventSelector(escrowCreatedEvent as { type: 'event'; name: string; inputs: readonly { name: string; type: string; indexed?: boolean }[] })

    for (const log of receipt.logs) {
      if (log.topics[0] === topic0 && log.topics.length > 1) {
        return BigInt(log.topics[1])
      }
    }

    throw escrowError(
      FairdropErrorCode.ESCROW_CREATE_FAILED,
      'Could not parse escrow ID from transaction receipt'
    )
  }
}
