/**
 * Escrow Keystore
 *
 * Secure storage for escrow encryption keys and salts.
 * Persists keys across browser sessions to enable crash recovery.
 *
 * Keys are encrypted with the user's password before storage.
 */

import type { StorageAdapter, CryptoProvider, EncodingProvider } from './index.js'

/**
 * Stored escrow key entry
 */
export interface EscrowKeyEntry {
  escrowId: string
  encryptionKey: string  // Hex-encoded, encrypted
  salt: string           // Hex-encoded, encrypted
  commitmentSalt?: string // For commit-reveal phase
  serializedEncryptedKey?: string // The encrypted key package for buyer (must be stored to match commitment)
  createdAt: number
  status: 'created' | 'committed' | 'revealed' | 'claimed'
}

/**
 * Raw key data before encryption
 */
export interface EscrowKeyData {
  encryptionKey: Uint8Array
  salt: Uint8Array
  commitmentSalt?: Uint8Array
  serializedEncryptedKey?: Uint8Array // The encrypted key package for buyer
}

const ESCROW_KEYS_KEY = 'fairdrop:escrow_keys'

/**
 * Escrow Keystore for secure key persistence
 */
export class EscrowKeystore {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly crypto: CryptoProvider,
    private readonly encoding: EncodingProvider
  ) {}

  /**
   * Store escrow key data (encrypted)
   */
  async storeKey(
    escrowId: string,
    keyData: EscrowKeyData,
    password: string
  ): Promise<void> {
    const entries = await this.getAllEntries()

    // Encrypt key data
    const encryptedEncryptionKey = await this.encryptData(keyData.encryptionKey, password)
    const encryptedSalt = await this.encryptData(keyData.salt, password)
    const encryptedCommitmentSalt = keyData.commitmentSalt
      ? await this.encryptData(keyData.commitmentSalt, password)
      : undefined
    const encryptedSerializedKey = keyData.serializedEncryptedKey
      ? await this.encryptData(keyData.serializedEncryptedKey, password)
      : undefined

    entries[escrowId] = {
      escrowId,
      encryptionKey: encryptedEncryptionKey,
      salt: encryptedSalt,
      commitmentSalt: encryptedCommitmentSalt,
      serializedEncryptedKey: encryptedSerializedKey,
      createdAt: Date.now(),
      status: 'created',
    }

    await this.storage.set(ESCROW_KEYS_KEY, JSON.stringify(entries))
  }

  /**
   * Retrieve escrow key data (decrypted)
   */
  async getKey(escrowId: string, password: string): Promise<EscrowKeyData | null> {
    const entries = await this.getAllEntries()
    const entry = entries[escrowId]

    if (!entry) {
      return null
    }

    try {
      const encryptionKey = await this.decryptData(entry.encryptionKey, password)
      const salt = await this.decryptData(entry.salt, password)
      const commitmentSalt = entry.commitmentSalt
        ? await this.decryptData(entry.commitmentSalt, password)
        : undefined
      const serializedEncryptedKey = entry.serializedEncryptedKey
        ? await this.decryptData(entry.serializedEncryptedKey, password)
        : undefined

      return { encryptionKey, salt, commitmentSalt, serializedEncryptedKey }
    } catch {
      throw new Error('Failed to decrypt escrow key - invalid password')
    }
  }

  /**
   * Update escrow key status and optionally store commit-reveal data
   */
  async updateStatus(
    escrowId: string,
    status: EscrowKeyEntry['status'],
    commitmentSalt?: Uint8Array,
    password?: string,
    serializedEncryptedKey?: Uint8Array
  ): Promise<void> {
    const entries = await this.getAllEntries()
    const entry = entries[escrowId]

    if (!entry) {
      throw new Error(`Escrow key not found: ${escrowId}`)
    }

    entry.status = status

    // Store commitment salt if provided (for reveal phase)
    if (commitmentSalt && password) {
      entry.commitmentSalt = await this.encryptData(commitmentSalt, password)
    }

    // Store serialized encrypted key (MUST match the commitment)
    if (serializedEncryptedKey && password) {
      entry.serializedEncryptedKey = await this.encryptData(serializedEncryptedKey, password)
    }

    await this.storage.set(ESCROW_KEYS_KEY, JSON.stringify(entries))
  }

  /**
   * Delete escrow key (after successful claim or expiration)
   */
  async deleteKey(escrowId: string): Promise<void> {
    const entries = await this.getAllEntries()
    delete entries[escrowId]
    await this.storage.set(ESCROW_KEYS_KEY, JSON.stringify(entries))
  }

  /**
   * List all stored escrow keys (without decrypting)
   */
  async listKeys(): Promise<Array<{ escrowId: string; status: string; createdAt: number }>> {
    const entries = await this.getAllEntries()
    return Object.values(entries).map((e) => ({
      escrowId: e.escrowId,
      status: e.status,
      createdAt: e.createdAt,
    }))
  }

  /**
   * Check if key exists
   */
  async hasKey(escrowId: string): Promise<boolean> {
    const entries = await this.getAllEntries()
    return escrowId in entries
  }

  /**
   * Get all entries from storage
   */
  private async getAllEntries(): Promise<Record<string, EscrowKeyEntry>> {
    const data = await this.storage.get(ESCROW_KEYS_KEY)
    if (!data) {
      return {}
    }
    try {
      return JSON.parse(data)
    } catch {
      return {}
    }
  }

  /**
   * Encrypt data with password
   */
  private async encryptData(data: Uint8Array, password: string): Promise<string> {
    const salt = this.crypto.randomBytes(16)
    const iv = this.crypto.randomBytes(12)

    // Derive key from password
    const passwordBytes = new TextEncoder().encode(password)
    const keyMaterial = await this.crypto.sha256(
      this.concat(passwordBytes, salt)
    )

    // Encrypt
    const encrypted = await this.crypto.aesGcmEncrypt(data, keyMaterial, iv)

    // Encode: salt (16) + iv (12) + ciphertext
    const result = this.concat(salt, iv, encrypted)
    return this.encoding.base64Encode(result)
  }

  /**
   * Decrypt data with password
   */
  private async decryptData(encryptedStr: string, password: string): Promise<Uint8Array> {
    const data = this.encoding.base64Decode(encryptedStr)

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
}
