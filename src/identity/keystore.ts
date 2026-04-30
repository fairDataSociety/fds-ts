/**
 * Ethereum Web3 Secret Storage v3 Keystore Implementation
 *
 * This implements the standard Ethereum keystore format, allowing
 * keystores to be exchanged between FDS apps and other Ethereum wallets.
 *
 * Specification: https://ethereum.org/en/developers/docs/data-structures-and-encoding/web3-secret-storage/
 *
 * Security features:
 * - scrypt for key derivation (memory-hard, GPU-resistant)
 * - AES-128-CTR for encryption
 * - Keccak-256 MAC with constant-time comparison
 * - All random values from CSPRNG
 */

import {
  aesCtrEncrypt,
  aesCtrDecrypt,
  deriveKeyWithParams,
  keccak256,
  constantTimeEqual,
  randomBytes,
  ETHEREUM_SCRYPT_PARAMS,
} from '../crypto/web3/index.js'
import { Wallet } from './wallet.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Ethereum Web3 Secret Storage v3 keystore format
 */
export interface EncryptedKeystore {
  version: 3
  id: string
  address: string
  crypto: {
    cipher: 'aes-128-ctr'
    ciphertext: string
    cipherparams: {
      iv: string
    }
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
 * Options for keystore creation
 */
export interface KeystoreOptions {
  /**
   * Scrypt N parameter (CPU/memory cost)
   * Default: 262144 (Ethereum standard)
   * Higher = more secure but slower
   */
  n?: number
  /**
   * Custom UUID for the keystore
   * Default: randomly generated
   */
  id?: string
}

// ============================================================================
// Keystore Functions
// ============================================================================

/**
 * Create an encrypted keystore from a wallet
 *
 * @param wallet - Wallet to encrypt
 * @param password - Password to encrypt with
 * @param options - Optional keystore options
 * @returns Encrypted keystore object
 */
export function createKeystore(
  wallet: Wallet,
  password: string,
  options: KeystoreOptions = {}
): EncryptedKeystore {
  const { n = ETHEREUM_SCRYPT_PARAMS.N, id = generateUUID() } = options

  // Generate random salt and IV
  const salt = randomBytes(32)
  const iv = randomBytes(16)

  // Derive key using scrypt
  const derivedKey = deriveKeyWithParams(password, salt, {
    N: n,
    r: ETHEREUM_SCRYPT_PARAMS.r,
    p: ETHEREUM_SCRYPT_PARAMS.p,
    dkLen: ETHEREUM_SCRYPT_PARAMS.dkLen,
  })

  // Use first 16 bytes for AES-128
  const encryptionKey = derivedKey.slice(0, 16)
  // Use last 16 bytes for MAC
  const macKey = derivedKey.slice(16, 32)

  // Get private key bytes (without 0x prefix)
  const privateKeyBytes = wallet.privateKey

  // Encrypt with AES-128-CTR
  const ciphertext = aesCtrEncrypt(privateKeyBytes, encryptionKey, iv)

  // Compute MAC: Keccak-256(macKey || ciphertext)
  const macInput = new Uint8Array(macKey.length + ciphertext.length)
  macInput.set(macKey, 0)
  macInput.set(ciphertext, macKey.length)
  const mac = keccak256(macInput)

  return {
    version: 3,
    id,
    address: wallet.address.slice(2).toLowerCase(), // Remove 0x, lowercase
    crypto: {
      cipher: 'aes-128-ctr',
      ciphertext: bytesToHex(ciphertext),
      cipherparams: {
        iv: bytesToHex(iv),
      },
      kdf: 'scrypt',
      kdfparams: {
        dklen: ETHEREUM_SCRYPT_PARAMS.dkLen,
        n,
        r: ETHEREUM_SCRYPT_PARAMS.r,
        p: ETHEREUM_SCRYPT_PARAMS.p,
        salt: bytesToHex(salt),
      },
      mac: bytesToHex(mac),
    },
  }
}

/**
 * Decrypt a keystore and return the wallet
 *
 * @param keystore - Encrypted keystore object
 * @param password - Password to decrypt with
 * @returns Decrypted wallet
 * @throws Error if password is incorrect or keystore is invalid
 */
export function decryptKeystore(
  keystore: EncryptedKeystore,
  password: string
): Wallet {
  // Validate keystore format
  if (keystore.version !== 3) {
    throw new Error('Unsupported keystore version')
  }
  if (keystore.crypto.cipher !== 'aes-128-ctr') {
    throw new Error('Unsupported cipher')
  }
  if (keystore.crypto.kdf !== 'scrypt') {
    throw new Error('Unsupported KDF')
  }

  // Parse hex values
  const salt = hexToBytes(keystore.crypto.kdfparams.salt)
  const iv = hexToBytes(keystore.crypto.cipherparams.iv)
  const ciphertext = hexToBytes(keystore.crypto.ciphertext)
  const storedMac = hexToBytes(keystore.crypto.mac)

  // Derive key using scrypt
  const { n, r, p, dklen } = keystore.crypto.kdfparams
  const derivedKey = deriveKeyWithParams(password, salt, {
    N: n,
    r,
    p,
    dkLen: dklen,
  })

  // Split derived key
  const encryptionKey = derivedKey.slice(0, 16)
  const macKey = derivedKey.slice(16, 32)

  // Verify MAC using constant-time comparison
  const macInput = new Uint8Array(macKey.length + ciphertext.length)
  macInput.set(macKey, 0)
  macInput.set(ciphertext, macKey.length)
  const computedMac = keccak256(macInput)

  if (!constantTimeEqual(computedMac, storedMac)) {
    throw new Error('Incorrect password')
  }

  // Decrypt private key
  const privateKeyBytes = aesCtrDecrypt(ciphertext, encryptionKey, iv)

  // Create wallet from decrypted private key
  const wallet = Wallet.fromPrivateKeyBytes(privateKeyBytes)

  // Verify address matches
  const expectedAddress = keystore.address.toLowerCase()
  const actualAddress = wallet.address.slice(2).toLowerCase()
  if (actualAddress !== expectedAddress) {
    throw new Error('Decrypted key does not match keystore address')
  }

  return wallet
}

/**
 * Serialize keystore to JSON string
 *
 * @param keystore - Keystore to serialize
 * @returns JSON string
 */
export function serializeKeystore(keystore: EncryptedKeystore): string {
  return JSON.stringify(keystore, null, 2)
}

/**
 * Parse keystore from JSON string
 *
 * @param json - JSON string
 * @returns Parsed keystore
 * @throws Error if JSON is invalid
 */
export function parseKeystore(json: string): EncryptedKeystore {
  const keystore = JSON.parse(json) as EncryptedKeystore

  // Basic validation
  if (keystore.version !== 3) {
    throw new Error('Invalid keystore version')
  }
  if (!keystore.crypto?.cipher || !keystore.crypto?.kdf) {
    throw new Error('Invalid keystore format')
  }

  return keystore
}

/**
 * Check if a string is a valid keystore JSON
 *
 * @param json - String to check
 * @returns true if valid keystore format
 */
export function isValidKeystoreJSON(json: string): boolean {
  try {
    parseKeystore(json)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert bytes to hex string (lowercase, no prefix)
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Convert hex string to bytes
 */
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  // Use crypto.randomUUID if available
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  // Fallback implementation
  const bytes = randomBytes(16)

  // Set version (4) and variant (8, 9, A, or B)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = bytesToHex(bytes)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}
