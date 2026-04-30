/**
 * Core cryptographic functions for FDS
 *
 * Security considerations:
 * - Uses constant-time comparison for MAC verification
 * - All random values generated from crypto.getRandomValues (CSPRNG)
 * - Key material is not logged or exposed in error messages
 */

import { scrypt } from '@noble/hashes/scrypt.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { sha256 as sha256Hash } from '@noble/hashes/sha2.js'
import { gcm, ctr } from '@noble/ciphers/aes.js'
import { randomBytes as nobleRandomBytes } from '@noble/hashes/utils.js'

// ============================================================================
// Types
// ============================================================================

export interface ScryptParams {
  N: number // CPU/memory cost parameter (power of 2)
  r: number // Block size
  p: number // Parallelization parameter
  dkLen: number // Derived key length in bytes
}

export interface EncryptedData {
  salt: Uint8Array // 32 bytes for password-based, empty for raw key
  nonce: Uint8Array // 12 bytes for GCM, 16 bytes for CTR
  ciphertext: Uint8Array // Encrypted data + auth tag (GCM) or just encrypted data (CTR)
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default scrypt parameters for FDS file encryption
 * N=262144 (2^18) provides ~2 seconds derivation time on modern hardware (Ethereum standard)
 */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  N: 262144, // 2^18 - Ethereum standard
  r: 8,
  p: 1,
  dkLen: 32, // 256-bit key for AES-256
}

/**
 * Ethereum Web3 Secret Storage v3 parameters
 * Used for keystore compatibility with Ethereum ecosystem
 */
export const ETHEREUM_SCRYPT_PARAMS: ScryptParams = {
  N: 262144, // 2^18 - Ethereum standard (Ethereum standard)
  r: 8,
  p: 1,
  dkLen: 32, // Derive 32 bytes, use first 16 for AES-128
}

// ============================================================================
// Random Number Generation
// ============================================================================

/**
 * Generate cryptographically secure random bytes
 *
 * @param length - Number of bytes to generate
 * @returns Random bytes
 */
export function randomBytes(length: number): Uint8Array {
  return nobleRandomBytes(length)
}

// ============================================================================
// Hashing Functions
// ============================================================================

/**
 * Compute Keccak-256 hash
 * Used for Ethereum keystore MAC computation
 *
 * @param data - Data to hash
 * @returns 32-byte hash
 */
export function keccak256(data: Uint8Array): Uint8Array {
  return keccak_256(data)
}

/**
 * Compute SHA-256 hash
 *
 * @param data - Data to hash
 * @returns 32-byte hash
 */
export function sha256(data: Uint8Array): Uint8Array {
  return sha256Hash(data)
}

// ============================================================================
// Constant-Time Comparison
// ============================================================================

/**
 * Constant-time byte array comparison
 * CRITICAL: Prevents timing attacks on MAC verification
 *
 * @param a - First byte array
 * @param b - Second byte array
 * @returns true if arrays are equal
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i]
  }

  return result === 0
}

// ============================================================================
// Key Derivation
// ============================================================================

/**
 * Derive a key from password using scrypt with default parameters
 *
 * @param password - Password string
 * @param salt - Salt bytes (32 bytes recommended)
 * @returns Derived key
 */
export function deriveKey(password: string, salt: Uint8Array): Uint8Array {
  return deriveKeyWithParams(password, salt, DEFAULT_SCRYPT_PARAMS)
}

/**
 * Derive a key from password using scrypt with custom parameters
 *
 * @param password - Password string
 * @param salt - Salt bytes
 * @param params - Scrypt parameters
 * @returns Derived key
 */
export function deriveKeyWithParams(
  password: string,
  salt: Uint8Array,
  params: ScryptParams
): Uint8Array {
  const encoder = new TextEncoder()
  const passwordBytes = encoder.encode(password)

  return scrypt(passwordBytes, salt, {
    N: params.N,
    r: params.r,
    p: params.p,
    dkLen: params.dkLen,
  })
}

// ============================================================================
// AES-256-GCM Encryption (Primary for file encryption)
// ============================================================================

/**
 * Encrypt data using AES-256-GCM
 * Format: [12 bytes nonce][ciphertext + 16 bytes auth tag]
 *
 * @param plaintext - Data to encrypt
 * @param key - 256-bit (32 bytes) encryption key
 * @returns Encrypted data with nonce prepended
 */
export function encrypt(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length !== 32) {
    throw new Error('Key must be 32 bytes for AES-256-GCM')
  }

  const nonce = randomBytes(12)
  const cipher = gcm(key, nonce)
  const ciphertext = cipher.encrypt(plaintext)

  // Prepend nonce to ciphertext
  const result = new Uint8Array(nonce.length + ciphertext.length)
  result.set(nonce, 0)
  result.set(ciphertext, nonce.length)

  return result
}

/**
 * Decrypt data using AES-256-GCM
 * Expects format: [12 bytes nonce][ciphertext + 16 bytes auth tag]
 *
 * @param encrypted - Encrypted data with nonce prepended
 * @param key - 256-bit (32 bytes) encryption key
 * @returns Decrypted plaintext
 * @throws Error if authentication fails
 */
export function decrypt(encrypted: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length !== 32) {
    throw new Error('Key must be 32 bytes for AES-256-GCM')
  }

  if (encrypted.length < 12 + 16) {
    throw new Error('Encrypted data too short')
  }

  const nonce = encrypted.slice(0, 12)
  const ciphertext = encrypted.slice(12)

  const cipher = gcm(key, nonce)
  return cipher.decrypt(ciphertext)
}

/**
 * Encrypt data with password using AES-256-GCM and scrypt
 * Format: [32 bytes salt][12 bytes nonce][ciphertext + auth tag]
 *
 * @param plaintext - Data to encrypt
 * @param password - Password string
 * @returns Encrypted data with salt and nonce prepended
 */
export function encryptWithPassword(
  plaintext: Uint8Array,
  password: string
): Uint8Array {
  const salt = randomBytes(32)
  const key = deriveKey(password, salt)

  const nonce = randomBytes(12)
  const cipher = gcm(key, nonce)
  const ciphertext = cipher.encrypt(plaintext)

  // Format: [salt][nonce][ciphertext + tag]
  const result = new Uint8Array(salt.length + nonce.length + ciphertext.length)
  result.set(salt, 0)
  result.set(nonce, salt.length)
  result.set(ciphertext, salt.length + nonce.length)

  return result
}

/**
 * Decrypt data with password using AES-256-GCM and scrypt
 * Expects format: [32 bytes salt][12 bytes nonce][ciphertext + auth tag]
 *
 * @param encrypted - Encrypted data with salt and nonce prepended
 * @param password - Password string
 * @returns Decrypted plaintext
 * @throws Error if authentication fails or password is wrong
 */
export function decryptWithPassword(
  encrypted: Uint8Array,
  password: string
): Uint8Array {
  if (encrypted.length < 32 + 12 + 16) {
    throw new Error('Encrypted data too short')
  }

  const salt = encrypted.slice(0, 32)
  const nonce = encrypted.slice(32, 32 + 12)
  const ciphertext = encrypted.slice(32 + 12)

  const key = deriveKey(password, salt)

  const cipher = gcm(key, nonce)
  return cipher.decrypt(ciphertext)
}

// ============================================================================
// AES-128-CTR Encryption (For Ethereum keystore compatibility)
// ============================================================================

/**
 * Encrypt data using AES-128-CTR
 * Used for Ethereum Web3 Secret Storage v3 compatibility
 *
 * Note: CTR mode does not provide authentication. Use GCM for new code.
 * This is provided only for Ethereum keystore interoperability.
 *
 * @param plaintext - Data to encrypt
 * @param key - 128-bit (16 bytes) encryption key
 * @param iv - 128-bit (16 bytes) initialization vector
 * @returns Ciphertext (same length as plaintext)
 */
export function aesCtrEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array
): Uint8Array {
  if (key.length !== 16) {
    throw new Error('Key must be 16 bytes for AES-128-CTR')
  }
  if (iv.length !== 16) {
    throw new Error('IV must be 16 bytes for AES-CTR')
  }

  const cipher = ctr(key, iv)
  return cipher.encrypt(plaintext)
}

/**
 * Decrypt data using AES-128-CTR
 * Used for Ethereum Web3 Secret Storage v3 compatibility
 *
 * @param ciphertext - Data to decrypt
 * @param key - 128-bit (16 bytes) encryption key
 * @param iv - 128-bit (16 bytes) initialization vector
 * @returns Decrypted plaintext
 */
export function aesCtrDecrypt(
  ciphertext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array
): Uint8Array {
  if (key.length !== 16) {
    throw new Error('Key must be 16 bytes for AES-128-CTR')
  }
  if (iv.length !== 16) {
    throw new Error('IV must be 16 bytes for AES-CTR')
  }

  const cipher = ctr(key, iv)
  return cipher.decrypt(ciphertext)
}
