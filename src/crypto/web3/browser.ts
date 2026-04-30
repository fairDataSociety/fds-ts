/**
 * Browser-specific crypto utilities
 *
 * Uses Web Crypto API for operations that benefit from native implementation.
 * Falls back to @noble libraries for scrypt (not available in Web Crypto).
 */

import {
  encrypt,
  decrypt,
  encryptWithPassword,
  decryptWithPassword,
  aesCtrEncrypt,
  aesCtrDecrypt,
  deriveKey,
  deriveKeyWithParams,
  keccak256,
  sha256,
  constantTimeEqual,
  randomBytes,
  DEFAULT_SCRYPT_PARAMS,
  ETHEREUM_SCRYPT_PARAMS,
  type ScryptParams,
} from './crypto.js'

/**
 * Browser crypto provider class
 * Provides a unified interface for crypto operations in browser environments
 */
export class BrowserCrypto {
  /**
   * Generate cryptographically secure random bytes
   */
  static randomBytes(length: number): Uint8Array {
    return randomBytes(length)
  }

  /**
   * Generate a random UUID (v4)
   */
  static randomUUID(): string {
    return crypto.randomUUID()
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  static encrypt(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
    return encrypt(plaintext, key)
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  static decrypt(encrypted: Uint8Array, key: Uint8Array): Uint8Array {
    return decrypt(encrypted, key)
  }

  /**
   * Encrypt data with password (scrypt + AES-256-GCM)
   */
  static encryptWithPassword(plaintext: Uint8Array, password: string): Uint8Array {
    return encryptWithPassword(plaintext, password)
  }

  /**
   * Decrypt data with password (scrypt + AES-256-GCM)
   */
  static decryptWithPassword(encrypted: Uint8Array, password: string): Uint8Array {
    return decryptWithPassword(encrypted, password)
  }

  /**
   * Encrypt using AES-128-CTR (Ethereum keystore compatibility)
   */
  static aesCtrEncrypt(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
    return aesCtrEncrypt(plaintext, key, iv)
  }

  /**
   * Decrypt using AES-128-CTR (Ethereum keystore compatibility)
   */
  static aesCtrDecrypt(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
    return aesCtrDecrypt(ciphertext, key, iv)
  }

  /**
   * Derive key from password using scrypt
   */
  static deriveKey(password: string, salt: Uint8Array): Uint8Array {
    return deriveKey(password, salt)
  }

  /**
   * Derive key with custom scrypt parameters
   */
  static deriveKeyWithParams(
    password: string,
    salt: Uint8Array,
    params: ScryptParams
  ): Uint8Array {
    return deriveKeyWithParams(password, salt, params)
  }

  /**
   * Compute Keccak-256 hash (Ethereum compatible)
   */
  static keccak256(data: Uint8Array): Uint8Array {
    return keccak256(data)
  }

  /**
   * Compute SHA-256 hash
   */
  static sha256(data: Uint8Array): Uint8Array {
    return sha256(data)
  }

  /**
   * Constant-time byte comparison (prevents timing attacks)
   */
  static constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    return constantTimeEqual(a, b)
  }

  /**
   * Default scrypt parameters for FDS
   */
  static get DEFAULT_SCRYPT_PARAMS(): ScryptParams {
    return DEFAULT_SCRYPT_PARAMS
  }

  /**
   * Ethereum-compatible scrypt parameters
   */
  static get ETHEREUM_SCRYPT_PARAMS(): ScryptParams {
    return ETHEREUM_SCRYPT_PARAMS
  }
}
