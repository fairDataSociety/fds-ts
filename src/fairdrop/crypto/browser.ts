/**
 * Browser CryptoProvider Implementation
 *
 * Uses Web Crypto API (crypto.subtle) for cryptographic operations.
 * Only works in browser environments.
 */

import type { CryptoProvider } from '../adapters/types.js'

/**
 * Browser-based crypto provider using Web Crypto API
 */
export class BrowserCryptoProvider implements CryptoProvider {
  /**
   * Generate cryptographically secure random bytes
   */
  randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    return bytes
  }

  /**
   * Generate a random UUID (v4)
   */
  randomUUID(): string {
    return crypto.randomUUID()
  }

  /**
   * Compute SHA-256 hash
   */
  async sha256(data: Uint8Array): Promise<Uint8Array> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data as BufferSource)
    return new Uint8Array(hashBuffer)
  }

  /**
   * Encrypt data using AES-GCM
   * @param data - Plaintext to encrypt
   * @param key - 256-bit AES key
   * @param iv - 12-byte initialization vector
   * @returns Ciphertext with authentication tag appended
   */
  async aesGcmEncrypt(
    data: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array
  ): Promise<Uint8Array> {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    )

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      cryptoKey,
      data as BufferSource
    )

    return new Uint8Array(ciphertext)
  }

  /**
   * Decrypt data using AES-GCM
   * @param ciphertext - Ciphertext with authentication tag
   * @param key - 256-bit AES key
   * @param iv - 12-byte initialization vector
   * @returns Decrypted plaintext
   */
  async aesGcmDecrypt(
    ciphertext: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array
  ): Promise<Uint8Array> {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    )

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      cryptoKey,
      ciphertext as BufferSource
    )

    return new Uint8Array(plaintext)
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
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key as BufferSource,
      { name: 'AES-CTR' },
      false,
      ['encrypt']
    )

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-CTR', counter: iv as BufferSource, length: 64 },
      cryptoKey,
      data as BufferSource
    )

    return new Uint8Array(ciphertext)
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
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key as BufferSource,
      { name: 'AES-CTR' },
      false,
      ['decrypt']
    )

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-CTR', counter: iv as BufferSource, length: 64 },
      cryptoKey,
      ciphertext as BufferSource
    )

    return new Uint8Array(plaintext)
  }
}
