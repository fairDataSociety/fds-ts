/**
 * ECDH Encryption Tests — TDD
 *
 * Tests secp256k1 ECDH key exchange + AES-256-GCM for send/receive.
 * Spec: encrypt for a recipient's public key. Only they can decrypt.
 *
 * Security requirement S14: should use HKDF with domain separation,
 * not raw SHA-256 over shared secret.
 */

import { describe, it, expect } from 'vitest'
import {
  generateEphemeralKeyPair,
  encryptForRecipient,
  decryptFromSender,
} from '../../../src/crypto/ecdh.js'

describe('ECDH Encryption (send/receive)', () => {
  it('encrypts for a recipient who can decrypt', () => {
    // Simulate: sender encrypts for recipient
    const recipientKeyPair = generateEphemeralKeyPair()
    const plaintext = new TextEncoder().encode('secret message')

    const encrypted = encryptForRecipient(plaintext, recipientKeyPair.publicKey)
    const decrypted = decryptFromSender(encrypted, recipientKeyPair.privateKey)

    expect(new TextDecoder().decode(decrypted)).toBe('secret message')
  })

  it('wrong private key cannot decrypt', () => {
    const recipient = generateEphemeralKeyPair()
    const wrongKey = generateEphemeralKeyPair()
    const plaintext = new TextEncoder().encode('secret')

    const encrypted = encryptForRecipient(plaintext, recipient.publicKey)
    expect(() => decryptFromSender(encrypted, wrongKey.privateKey)).toThrow()
  })

  it('each encryption uses a different ephemeral key', () => {
    const recipient = generateEphemeralKeyPair()
    const plaintext = new TextEncoder().encode('same message')

    const ct1 = encryptForRecipient(plaintext, recipient.publicKey)
    const ct2 = encryptForRecipient(plaintext, recipient.publicKey)

    // Different ephemeral keys → different ciphertext
    expect(Buffer.from(ct1).toString('hex')).not.toBe(Buffer.from(ct2).toString('hex'))

    // Both decrypt to same plaintext
    expect(new TextDecoder().decode(decryptFromSender(ct1, recipient.privateKey))).toBe('same message')
    expect(new TextDecoder().decode(decryptFromSender(ct2, recipient.privateKey))).toBe('same message')
  })

  it('encrypted output contains ephemeral public key', () => {
    const recipient = generateEphemeralKeyPair()
    const encrypted = encryptForRecipient(new TextEncoder().encode('test'), recipient.publicKey)

    // Format: ephemeralPubKey(33 compressed) + IV(12) + authTag(16) + ciphertext
    // Minimum size: 33 + 12 + 16 + 0 = 61 bytes (empty plaintext)
    expect(encrypted.length).toBeGreaterThanOrEqual(61)
  })

  it('handles empty message', () => {
    const recipient = generateEphemeralKeyPair()
    const encrypted = encryptForRecipient(new Uint8Array(0), recipient.publicKey)
    const decrypted = decryptFromSender(encrypted, recipient.privateKey)
    expect(decrypted.length).toBe(0)
  })

  it('handles large message', () => {
    const recipient = generateEphemeralKeyPair()
    const large = new Uint8Array(100000).fill(0xab)
    const encrypted = encryptForRecipient(large, recipient.publicKey)
    const decrypted = decryptFromSender(encrypted, recipient.privateKey)
    expect(decrypted.length).toBe(100000)
    expect(decrypted[0]).toBe(0xab)
  })

  it('generateEphemeralKeyPair produces valid keys', () => {
    const kp = generateEphemeralKeyPair()
    expect(kp.privateKey.length).toBe(32)
    expect(kp.publicKey.length).toBe(33)  // compressed
  })
})
