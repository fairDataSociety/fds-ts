/**
 * Isomorphic Keystore Service
 *
 * Implements Ethereum-compatible keystore format for account backup/restore.
 * Uses scrypt KDF + AES-128-CTR encryption + keccak256 MAC.
 *
 * Works in both Node.js and browser environments via CryptoProvider.
 */

import { scrypt } from '@noble/hashes/scrypt.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import type { CryptoProvider, EncodingProvider } from '../adapters/types.js'

// Keystore progress stages
export type KeystoreProgress = 'deriving-key' | 'encrypting' | 'decrypting' | 'verifying'

// Ethereum keystore standard scrypt parameters
const SCRYPT_N = 262144 // 2^18 - Ethereum standard computation cost
const SCRYPT_R = 8 // block size
const SCRYPT_P = 1 // parallelization
const SCRYPT_DKLEN = 32 // derived key length

/**
 * Fairdrop Keystore format
 */
export interface FairdropKeystore {
  version: number
  type: 'fairdrop'
  address: string
  crypto: {
    cipher: 'aes-128-ctr'
    ciphertext: string
    cipherparams: { iv: string }
    kdf: 'scrypt'
    kdfparams: {
      dklen: number
      n: number
      r: number
      p: number
      salt: string
    }
    mac: string
  }
}

/**
 * Payload encrypted within the keystore
 */
export interface FairdropKeystorePayload {
  subdomain: string
  publicKey: string
  privateKey: string
  inboxParams?: {
    topic: string
    address: string
  }
  walletAddress?: string
  created: number
  stampId?: string
  stampExpiresAt?: number
  stampCapacity?: number
  stampTotalCapacity?: number
}

/**
 * Account type returned after keystore decryption
 */
export interface KeystoreAccount {
  subdomain: string
  publicKey: string
  privateKey: string
  passwordHash: string
  inboxParams?: {
    topic: string
    address: string
  }
  walletAddress?: string
  created: number
  stampId?: string
  stampExpiresAt?: number
  stampCapacity?: number
  stampTotalCapacity?: number
}

/**
 * Keystore Service
 *
 * Provides keystore creation and parsing using injected adapters.
 */
export class KeystoreService {
  constructor(
    private readonly crypto: CryptoProvider,
    private readonly encoding: EncodingProvider,
    private readonly ensDomain: string = 'fairdrop.eth'
  ) {}

  /**
   * Encrypt account data into a Fairdrop keystore
   */
  async createKeystore(
    payload: FairdropKeystorePayload,
    password: string,
    onProgress?: (stage: KeystoreProgress) => void
  ): Promise<string> {
    // Generate random salt and IV
    const salt = this.crypto.randomBytes(32)
    const iv = this.crypto.randomBytes(16)

    // Derive key using scrypt
    onProgress?.('deriving-key')
    const derivedKey = await this.deriveKey(password, salt)

    // Encrypt payload with AES-128-CTR
    onProgress?.('encrypting')
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
    const encryptionKey = derivedKey.slice(0, 16)
    const ciphertext = await this.crypto.aesCtrEncrypt(payloadBytes, encryptionKey, iv)

    // Generate MAC: keccak256(derivedKey[16:32] + ciphertext)
    const macKey = derivedKey.slice(16, 32)
    const macInput = this.concat(macKey, ciphertext)
    const mac = keccak_256(macInput)

    // Build keystore structure
    const keystore: FairdropKeystore = {
      version: 1,
      type: 'fairdrop',
      address: `${payload.subdomain}.${this.ensDomain}`,
      crypto: {
        cipher: 'aes-128-ctr',
        ciphertext: this.encoding.bytesToHex(ciphertext),
        cipherparams: { iv: this.encoding.bytesToHex(iv) },
        kdf: 'scrypt',
        kdfparams: {
          dklen: SCRYPT_DKLEN,
          n: SCRYPT_N,
          r: SCRYPT_R,
          p: SCRYPT_P,
          salt: this.encoding.bytesToHex(salt),
        },
        mac: this.encoding.bytesToHex(mac),
      },
    }

    return JSON.stringify(keystore, null, 2)
  }

  /**
   * Decrypt a Fairdrop keystore and return payload with password hash
   */
  async parseKeystore(
    keystoreJson: string,
    password: string,
    onProgress?: (stage: KeystoreProgress) => void
  ): Promise<{ payload: FairdropKeystorePayload; passwordHash: string }> {
    // Parse and validate keystore
    let keystore: FairdropKeystore
    try {
      keystore = JSON.parse(keystoreJson)
    } catch {
      throw new Error('Invalid keystore: not valid JSON')
    }

    if (!this.validateKeystoreFormat(keystore)) {
      throw new Error('Invalid keystore format')
    }

    const { crypto: ks } = keystore

    // Extract parameters
    const salt = this.encoding.hexToBytes(ks.kdfparams.salt)
    const iv = this.encoding.hexToBytes(ks.cipherparams.iv)
    const ciphertext = this.encoding.hexToBytes(ks.ciphertext)
    const storedMac = ks.mac

    // Derive key using scrypt
    onProgress?.('deriving-key')
    const derivedKey = await this.deriveKey(password, salt)

    // Verify MAC first
    onProgress?.('verifying')
    const macKey = derivedKey.slice(16, 32)
    const macInput = this.concat(macKey, ciphertext)
    const computedMac = this.encoding.bytesToHex(keccak_256(macInput))

    if (computedMac !== storedMac) {
      throw new Error('Incorrect password')
    }

    // Decrypt payload
    onProgress?.('decrypting')
    const encryptionKey = derivedKey.slice(0, 16)
    const payloadBytes = await this.crypto.aesCtrDecrypt(ciphertext, encryptionKey, iv)
    const payloadJson = new TextDecoder().decode(payloadBytes)

    let payload: FairdropKeystorePayload
    try {
      payload = JSON.parse(payloadJson)
    } catch {
      throw new Error('Decryption failed: corrupted payload')
    }

    // Hash password for storage
    const passwordHash = await this.hashPassword(password)

    return { payload, passwordHash }
  }

  /**
   * Validate keystore structure
   */
  validateKeystoreFormat(json: unknown): json is FairdropKeystore {
    if (!json || typeof json !== 'object') return false

    const ks = json as Record<string, unknown>

    if (ks.version !== 1) return false
    if (ks.type !== 'fairdrop') return false
    if (typeof ks.address !== 'string') return false
    if (!ks.crypto || typeof ks.crypto !== 'object') return false

    const crypto = ks.crypto as Record<string, unknown>

    if (crypto.cipher !== 'aes-128-ctr') return false
    if (crypto.kdf !== 'scrypt') return false
    if (typeof crypto.ciphertext !== 'string') return false
    if (typeof crypto.mac !== 'string') return false

    if (!crypto.cipherparams || typeof crypto.cipherparams !== 'object') return false
    if (!crypto.kdfparams || typeof crypto.kdfparams !== 'object') return false

    const cipherparams = crypto.cipherparams as Record<string, unknown>
    const kdfparams = crypto.kdfparams as Record<string, unknown>

    if (typeof cipherparams.iv !== 'string') return false
    if (typeof kdfparams.salt !== 'string') return false
    if (typeof kdfparams.n !== 'number') return false
    if (typeof kdfparams.r !== 'number') return false
    if (typeof kdfparams.p !== 'number') return false
    if (typeof kdfparams.dklen !== 'number') return false

    return true
  }

  /**
   * Get subdomain from keystore without decrypting
   * Supports both fairdrop.eth and fairdrop-dev.eth (and any configured domain)
   */
  getKeystoreSubdomain(keystoreJson: string): string | null {
    try {
      const keystore = JSON.parse(keystoreJson)
      if (keystore.address && typeof keystore.address === 'string') {
        // Match subdomain.domain.eth pattern (supports fairdrop.eth, fairdrop-dev.eth, etc.)
        const match = keystore.address.match(/^([^.]+)\.(?:fairdrop(?:-dev)?\.eth|.+\.eth)$/)
        return match ? match[1] : null
      }
    } catch {
      // Invalid JSON
    }
    return null
  }

  // ===========================================================================
  // Private helper functions
  // ===========================================================================

  /**
   * Derive encryption key using scrypt
   */
  private async deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
    const passwordBytes = new TextEncoder().encode(password)

    // Use @noble/hashes scrypt (async via setTimeout for UI responsiveness)
    return new Promise((resolve) => {
      setTimeout(() => {
        const key = scrypt(passwordBytes, salt, {
          N: SCRYPT_N,
          r: SCRYPT_R,
          p: SCRYPT_P,
          dkLen: SCRYPT_DKLEN,
        })
        resolve(key)
      }, 0)
    })
  }

  /**
   * Hash password using SHA-256
   */
  private async hashPassword(password: string): Promise<string> {
    const salt = 'fairdrop-v2-salt'
    const data = new TextEncoder().encode(password + salt)
    const hash = await this.crypto.sha256(data)
    return this.encoding.bytesToHex(hash)
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
