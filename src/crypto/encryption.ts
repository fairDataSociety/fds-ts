/**
 * AES-256-GCM Encryption — the core encryption primitive.
 *
 * Format: IV(12) || authTag(16) || ciphertext
 *
 * Uses @noble/ciphers for isomorphic operation (Node + browser).
 * No dependency on Node.js crypto module.
 *
 * Security properties:
 * - Authenticated encryption (confidentiality + integrity)
 * - 12-byte random IV (GCM standard, 2^96 space)
 * - 16-byte auth tag (128-bit authentication)
 * - Tampered ciphertext is rejected (GCM verification)
 */

import { gcm } from '@noble/ciphers/aes'
import { randomBytes } from '@noble/ciphers/webcrypto'

const IV_LENGTH = 12    // GCM standard
const TAG_LENGTH = 16   // 128-bit auth tag (appended by noble)

/**
 * Encrypt data with AES-256-GCM.
 *
 * @param plaintext - Data to encrypt
 * @param key - 32-byte encryption key
 * @returns IV(12) || authTag(16) || ciphertext
 */
export function encrypt(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (AES-256)')
  }

  const iv = randomBytes(IV_LENGTH)
  const cipher = gcm(key, iv)
  const ciphertext = cipher.encrypt(plaintext)
  // noble/ciphers appends the 16-byte auth tag to ciphertext

  // Pack: IV || authTag || encrypted data
  // noble format: ciphertext = encrypted + authTag(16)
  // Our format: IV(12) + authTag(16) + encrypted
  const encrypted = ciphertext.slice(0, ciphertext.length - TAG_LENGTH)
  const authTag = ciphertext.slice(ciphertext.length - TAG_LENGTH)

  const result = new Uint8Array(IV_LENGTH + TAG_LENGTH + encrypted.length)
  result.set(iv, 0)
  result.set(authTag, IV_LENGTH)
  result.set(encrypted, IV_LENGTH + TAG_LENGTH)
  return result
}

/**
 * Decrypt data with AES-256-GCM.
 *
 * @param data - IV(12) || authTag(16) || ciphertext
 * @param key - 32-byte encryption key
 * @returns Decrypted plaintext
 * @throws If auth tag verification fails (tampered or wrong key)
 */
export function decrypt(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (AES-256)')
  }

  if (data.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Ciphertext too short (missing IV or auth tag)')
  }

  const iv = data.slice(0, IV_LENGTH)
  const authTag = data.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const encrypted = data.slice(IV_LENGTH + TAG_LENGTH)

  // Reconstruct noble format: encrypted + authTag
  const ciphertext = new Uint8Array(encrypted.length + TAG_LENGTH)
  ciphertext.set(encrypted, 0)
  ciphertext.set(authTag, encrypted.length)

  const cipher = gcm(key, iv)
  return cipher.decrypt(ciphertext)
}
