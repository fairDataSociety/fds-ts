/**
 * Node.js CryptoProvider Implementation
 *
 * Uses @noble/ciphers for AES operations and @noble/hashes for hashing.
 * Fully isomorphic - works in Node.js without Web Crypto API.
 */

import { gcm } from '@noble/ciphers/aes'
import { ctr } from '@noble/ciphers/aes'
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'
import { randomBytes as nobleRandomBytes } from '@noble/hashes/utils.js'
import type { CryptoProvider } from '../adapters/types.js'

/**
 * Node.js crypto provider using @noble libraries
 */
export class NodeCryptoProvider implements CryptoProvider {
  /**
   * Generate cryptographically secure random bytes
   */
  randomBytes(length: number): Uint8Array {
    return nobleRandomBytes(length)
  }

  /**
   * Generate a random UUID (v4)
   * Uses crypto.randomUUID() available in Node 19+
   */
  randomUUID(): string {
    // Node.js 19+ has crypto.randomUUID()
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID()
    }
    // Fallback: generate UUID v4 manually
    const bytes = this.randomBytes(16)
    // Set version (4) and variant (RFC4122)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  /**
   * Compute SHA-256 hash
   */
  async sha256(data: Uint8Array): Promise<Uint8Array> {
    return nobleSha256(data)
  }

  /**
   * Encrypt data using AES-GCM
   * @param data - Plaintext to encrypt
   * @param key - 256-bit AES key
   * @param iv - 12-byte initialization vector (nonce)
   * @returns Ciphertext with authentication tag appended (16 bytes)
   */
  async aesGcmEncrypt(
    data: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array
  ): Promise<Uint8Array> {
    const cipher = gcm(key, iv)
    return cipher.encrypt(data)
  }

  /**
   * Decrypt data using AES-GCM
   * @param ciphertext - Ciphertext with authentication tag
   * @param key - 256-bit AES key
   * @param iv - 12-byte initialization vector (nonce)
   * @returns Decrypted plaintext
   * @throws Error if authentication tag is invalid
   */
  async aesGcmDecrypt(
    ciphertext: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array
  ): Promise<Uint8Array> {
    const cipher = gcm(key, iv)
    return cipher.decrypt(ciphertext)
  }

  /**
   * Encrypt data using AES-CTR
   * @param data - Plaintext to encrypt
   * @param key - 256-bit AES key
   * @param iv - 16-byte counter/IV
   * @returns Ciphertext (same length as plaintext)
   */
  async aesCtrEncrypt(
    data: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array
  ): Promise<Uint8Array> {
    const cipher = ctr(key, iv)
    return cipher.encrypt(data)
  }

  /**
   * Decrypt data using AES-CTR
   * @param ciphertext - Ciphertext to decrypt
   * @param key - 256-bit AES key
   * @param iv - 16-byte counter/IV
   * @returns Decrypted plaintext
   */
  async aesCtrDecrypt(
    ciphertext: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array
  ): Promise<Uint8Array> {
    const cipher = ctr(key, iv)
    return cipher.decrypt(ciphertext)
  }
}
