/**
 * IdentityService — wallet management, ENS resolution, signing, backup.
 *
 * Wraps @fairdatasociety/fds-id: HDWallet, Wallet, Keystore, KeystoreBackup, ENS.
 * Identity auto-propagates to all other services (Firebase Auth pattern).
 */

import {
  HDWallet,
  Wallet,
  Keystore,
  KeystoreBackup,
  parseENSName,
  FDS_TEXT_RECORDS,
  SwarmClient,
  signMessage as fdsSignMessage,
  signTypedData as fdsSignTypedData,
  verifyMessage as fdsVerifyMessage,
  hashMessage,
  encryptBackup,
  decryptBackup,
} from '@fairdatasociety/fds-id'
import type { FdsIdentity } from '../types.js'
import { FdsError, FdsErrorCode } from '../errors.js'

export interface IdentityCreateOptions {
  /** Password for SecureWallet (key-zeroizing wallet). Recommended for production. */
  password?: string
  /** Word count for mnemonic: 12 or 24. Default: 12. */
  wordCount?: 12 | 24
}

export interface IdentityServiceOptions {
  /** Bee node URL for keystore backup uploads. */
  beeUrl?: string
  /** Postage batch ID for backup uploads. */
  batchId?: string
}

export class IdentityService {
  private wallet: any = null  // Wallet instance (fds-id uses private constructor)
  private hdWallet: any = null  // HDWallet instance
  private locked = false
  private address: string | null = null
  private publicKey: string | null = null
  private ensName: string | null = null
  private subdomain: string | null = null
  private beeUrl?: string
  private batchId?: string

  /** Callbacks for when identity changes — other services subscribe to this */
  private onIdentityChange: Array<(identity: FdsIdentity | null) => void> = []

  /** Wire optional Bee config for backup/restore. */
  configure(opts: IdentityServiceOptions): void {
    this.beeUrl = opts.beeUrl
    this.batchId = opts.batchId
  }

  /** Current identity (null if not created/imported) */
  get current(): { address: string; publicKey: string; ensName?: string } | null {
    if (!this.address || !this.publicKey) return null
    return {
      address: this.address,
      publicKey: this.publicKey,
      ensName: this.ensName ?? undefined,
    }
  }

  get isLocked(): boolean {
    return this.locked
  }

  /**
   * Create a new identity.
   * Generates HD wallet, derives account 0.
   * Returns mnemonic ONCE — SDK does not store it.
   */
  async create(opts?: IdentityCreateOptions): Promise<FdsIdentity> {
    const wordCount = opts?.wordCount ?? 12
    this.hdWallet = HDWallet.create({ wordCount })
    this.wallet = this.hdWallet.deriveAccount(0)
    const mnemonic: string = this.hdWallet.mnemonic

    this.address = this.wallet.address as string
    this.publicKey = Buffer.from(this.wallet.publicKey).toString('hex')

    const identity: FdsIdentity = {
      address: this.address,
      publicKey: this.publicKey,
      mnemonic, // returned ONCE
    }

    this.notifyChange(identity)
    return identity
  }

  /**
   * Import identity from mnemonic.
   */
  async import(mnemonic: string): Promise<FdsIdentity> {
    this.hdWallet = HDWallet.fromMnemonic(mnemonic)
    this.wallet = this.hdWallet.deriveAccount(0)

    this.address = this.wallet.address as string
    this.publicKey = Buffer.from(this.wallet.publicKey).toString('hex')

    const identity: FdsIdentity = {
      address: this.address!,
      publicKey: this.publicKey!,
      // mnemonic NOT returned on import — user already has it
    }

    this.notifyChange(identity)
    return identity
  }

  /**
   * Resolve an ENS name to address + public key.
   */
  async resolve(name: string): Promise<{ address?: string; publicKey?: string }> {
    const parsed = parseENSName(name)
    // Full resolution requires an RPC-connected ENS client
    // For now, return the parsed components
    return {
      address: parsed.address ?? undefined,
      publicKey: parsed.publicKey ?? undefined,
    }
  }

  /**
   * Lock the identity — prevents key access until unlock.
   */
  async lock(): Promise<void> {
    if (this.wallet) {
      this.wallet.lock()
    }
    if (this.hdWallet) {
      this.hdWallet.lock()
    }
    this.locked = true
  }

  /**
   * Unlock the identity.
   */
  async unlock(_password?: string): Promise<void> {
    if (this.wallet) {
      this.wallet.unlock()
    }
    if (this.hdWallet) {
      this.hdWallet.unlock()
    }
    this.locked = false
  }

  /**
   * Sign a message (EIP-191 personal_sign).
   */
  async sign(message: string): Promise<Uint8Array> {
    this.ensureUnlocked()
    const hash = hashMessage(message)
    return this.wallet!.sign(hash)
  }

  /**
   * Sign EIP-712 typed data.
   */
  async signTypedData(domain: any, types: any, value: any): Promise<Uint8Array> {
    this.ensureUnlocked()
    return fdsSignTypedData({ types, primaryType: Object.keys(types)[0], domain, message: value }, (hash) => this.wallet!.sign(hash))
  }

  /**
   * Derive a child wallet at the given BIP-44 index.
   */
  async deriveChild(index: number): Promise<FdsIdentity> {
    if (!this.hdWallet) {
      throw new FdsError(FdsErrorCode.NO_IDENTITY, 'No HD wallet — import with mnemonic to derive children')
    }
    this.ensureUnlocked()
    const child = this.hdWallet.deriveAccount(index)
    return {
      address: child.address,
      publicKey: Buffer.from(child.publicKey).toString('hex'),
    }
  }

  /**
   * Export as Web3 v3 keystore (MetaMask compatible).
   */
  async exportKeystore(password: string): Promise<object> {
    this.ensureUnlocked()
    return Keystore.encrypt(this.wallet!, password)
  }

  /**
   * Import from Web3 v3 keystore.
   */
  async importKeystore(keystore: object, password: string): Promise<FdsIdentity> {
    this.wallet = await Keystore.decrypt(keystore as any, password)
    this.address = this.wallet.address as string
    this.publicKey = Buffer.from(this.wallet.publicKey).toString('hex')
    this.locked = false

    const identity: FdsIdentity = {
      address: this.address!,
      publicKey: this.publicKey!,
    }

    this.notifyChange(identity)
    return identity
  }

  /**
   * Backup identity to Swarm (encrypted, password-protected).
   *
   * Encrypts the keystore with `password` (scrypt + AES-GCM via KeystoreBackup),
   * uploads to Swarm, and returns the reference. Caller is responsible for
   * persisting the reference (e.g., to ENS text record).
   *
   * Requires Bee config — call `configure({ beeUrl, batchId })` first or pass
   * a SwarmClient explicitly.
   */
  async backup(password: string, opts?: { swarmClient?: InstanceType<typeof SwarmClient>; subdomain?: string }): Promise<{ reference: string }> {
    this.ensureUnlocked()
    const beeUrl = this.beeUrl
    if (!opts?.swarmClient && !beeUrl) {
      throw new FdsError(FdsErrorCode.NO_STORAGE, 'Bee URL required for backup. Configure via configure({ beeUrl, batchId }) or pass swarmClient.')
    }

    const backup = new KeystoreBackup({
      bee: { url: beeUrl, stampId: this.batchId },
    } as any)

    const account = this.toFdsAccount(opts?.subdomain)
    const result = await backup.backup(account, password, {
      stampId: this.batchId,
    })
    return { reference: result.reference as string }
  }

  /**
   * Restore identity from a Swarm reference + password.
   *
   * Downloads the encrypted keystore from Swarm, decrypts with password,
   * and rehydrates the wallet. Notifies subscribers of identity change.
   */
  async restore(reference: string, password: string): Promise<FdsIdentity> {
    const beeUrl = this.beeUrl
    if (!beeUrl) {
      throw new FdsError(FdsErrorCode.NO_STORAGE, 'Bee URL required for restore. Call configure({ beeUrl }) first.')
    }

    const backup = new KeystoreBackup({
      bee: { url: beeUrl, stampId: this.batchId },
    } as any)

    const result = await backup.restore(reference as any, password) as any
    const acct = result.account as any

    // Rehydrate wallet from restored private key
    this.wallet = await Wallet.fromPrivateKey(
      typeof acct.privateKey === 'string' ? acct.privateKey : Buffer.from(acct.privateKey).toString('hex'),
    )
    this.address = this.wallet.address as string
    this.publicKey = Buffer.from(this.wallet.publicKey).toString('hex')
    this.subdomain = acct.subdomain ?? null
    this.locked = false

    const identity: FdsIdentity = {
      address: this.address!,
      publicKey: this.publicKey!,
    }
    this.notifyChange(identity)
    return identity
  }

  /** Build an FDSAccount snapshot from current wallet state (for backup APIs). */
  private toFdsAccount(subdomain?: string): any {
    if (!this.wallet) throw new FdsError(FdsErrorCode.NO_IDENTITY, 'No identity to back up')
    const sub = subdomain ?? this.subdomain ?? 'fds'
    const privKey = this.getPrivateKey()
    if (!privKey) throw new FdsError(FdsErrorCode.IDENTITY_LOCKED, 'Cannot backup locked identity')
    return {
      subdomain: sub,
      publicKey: this.publicKey!,
      privateKey: privKey,
      walletAddress: this.address!,
      created: Date.now(),
      stampId: this.batchId,
    }
  }

  /** Get the private key (hex, for adapter integration). Only accessible when unlocked. */
  getPrivateKey(): string | null {
    if (!this.wallet || this.locked) return null
    try {
      const pk = this.wallet.privateKey
      // Normalize: ensure hex without 0x prefix for fairdrive-core compatibility
      const hex = Buffer.from(pk).toString('hex')
      return hex
    } catch {
      return null
    }
  }

  /** Subscribe to identity changes (used by other services) */
  onChange(callback: (identity: FdsIdentity | null) => void): void {
    this.onIdentityChange.push(callback)
  }

  // ── Private ────────────────────────────────────────────

  private ensureUnlocked(): void {
    if (!this.wallet) {
      throw new FdsError(FdsErrorCode.NO_IDENTITY)
    }
    if (this.locked) {
      throw new FdsError(FdsErrorCode.IDENTITY_LOCKED)
    }
  }

  private notifyChange(identity: FdsIdentity | null): void {
    for (const cb of this.onIdentityChange) {
      cb(identity)
    }
  }
}
