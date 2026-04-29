/**
 * Encryption Tests — TDD
 *
 * Tests AES-256-GCM file encryption/decryption.
 *
 * Security requirements from spec:
 * - AES-256-GCM with 12-byte IV (standard)
 * - Auth tag verification on decrypt (tampered ciphertext rejected)
 * - Format: IV(12) || authTag(16) || ciphertext
 * - Uses @noble/ciphers (isomorphic, no Node.js crypto)
 */

import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from '../../../src/crypto/encryption.js'

describe('AES-256-GCM Encryption', () => {
  const key = new Uint8Array(32).fill(42)  // test key

  it('encrypts and decrypts round-trip', () => {
    const plaintext = new TextEncoder().encode('hello world')
    const ciphertext = encrypt(plaintext, key)
    const decrypted = decrypt(ciphertext, key)
    expect(new TextDecoder().decode(decrypted)).toBe('hello world')
  })

  it('ciphertext is larger than plaintext (IV + authTag overhead)', () => {
    const plaintext = new TextEncoder().encode('test')
    const ciphertext = encrypt(plaintext, key)
    // 12 (IV) + 16 (auth tag) + 4 (plaintext) = 32
    expect(ciphertext.length).toBe(plaintext.length + 12 + 16)
  })

  it('produces different ciphertext each time (random IV)', () => {
    const plaintext = new TextEncoder().encode('same input')
    const ct1 = encrypt(plaintext, key)
    const ct2 = encrypt(plaintext, key)
    expect(Buffer.from(ct1).toString('hex')).not.toBe(Buffer.from(ct2).toString('hex'))
  })

  it('rejects tampered ciphertext (auth tag fails)', () => {
    const plaintext = new TextEncoder().encode('authentic')
    const ciphertext = encrypt(plaintext, key)
    // Flip a byte in the ciphertext portion
    const tampered = new Uint8Array(ciphertext)
    tampered[20] ^= 0xff  // modify byte after IV + authTag
    expect(() => decrypt(tampered, key)).toThrow()
  })

  it('rejects wrong key', () => {
    const plaintext = new TextEncoder().encode('secret')
    const ciphertext = encrypt(plaintext, key)
    const wrongKey = new Uint8Array(32).fill(99)
    expect(() => decrypt(ciphertext, wrongKey)).toThrow()
  })

  it('handles empty plaintext', () => {
    const empty = new Uint8Array(0)
    const ciphertext = encrypt(empty, key)
    expect(ciphertext.length).toBe(12 + 16)  // IV + authTag only
    const decrypted = decrypt(ciphertext, key)
    expect(decrypted.length).toBe(0)
  })

  it('handles large data (1MB)', () => {
    const large = new Uint8Array(1024 * 1024).fill(0xab)
    const ciphertext = encrypt(large, key)
    const decrypted = decrypt(ciphertext, key)
    expect(decrypted.length).toBe(large.length)
    expect(decrypted[0]).toBe(0xab)
    expect(decrypted[decrypted.length - 1]).toBe(0xab)
  })

  it('requires 32-byte key', () => {
    const plaintext = new TextEncoder().encode('test')
    const shortKey = new Uint8Array(16)
    expect(() => encrypt(plaintext, shortKey)).toThrow()
  })
})
