/**
 * Escrow Crypto Tests — ported from fairdrop/tests/unit/escrow/escrow-crypto.test.ts
 *
 * Tests cryptographic operations for DataEscrow:
 * - Key commitment (salted hash)
 * - Buyer-specific key encryption (ECDH + AES-GCM)
 * - Serialization/deserialization
 * - Encrypted key commitment (mempool-safe reveal)
 * - Security properties (forward secrecy, salt prevents rainbow attacks)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as secp256k1 from '@noble/secp256k1'
import { sha256 } from '@noble/hashes/sha2.js'
import {
  createKeyCommitment,
  verifyKeyCommitment,
  encryptKeyForBuyer,
  decryptKeyAsBuyer,
  serializeEncryptedKey,
  deserializeEncryptedKey,
  createEncryptedKeyCommitment,
  verifyEncryptedKeyCommitment,
  generateEncryptionKey,
} from '../../../src/fairdrop/crypto/escrow.js'
import { NodeCryptoProvider } from '../../../src/fairdrop/crypto/node.js'

const crypto = new NodeCryptoProvider()

describe('Key Commitment', () => {
  describe('createKeyCommitment', () => {
    it('creates commitment from 32-byte key', async () => {
      const key = crypto.randomBytes(32)
      const { commitment, salt } = await createKeyCommitment(crypto, key)

      expect(commitment).toBeInstanceOf(Uint8Array)
      expect(commitment.length).toBe(32)
      expect(salt).toBeInstanceOf(Uint8Array)
      expect(salt.length).toBe(32)
    })

    it('generates different salt each time', async () => {
      const key = crypto.randomBytes(32)
      const r1 = await createKeyCommitment(crypto, key)
      const r2 = await createKeyCommitment(crypto, key)
      expect(r1.salt).not.toEqual(r2.salt)
      expect(r1.commitment).not.toEqual(r2.commitment)
    })

    it('rejects key that is not 32 bytes', async () => {
      const shortKey = crypto.randomBytes(16)
      const longKey = crypto.randomBytes(64)
      await expect(createKeyCommitment(crypto, shortKey)).rejects.toThrow('32 bytes')
      await expect(createKeyCommitment(crypto, longKey)).rejects.toThrow('32 bytes')
    })

    it('handles empty key rejection', async () => {
      const emptyKey = new Uint8Array(0)
      await expect(createKeyCommitment(crypto, emptyKey)).rejects.toThrow('32 bytes')
    })
  })

  describe('verifyKeyCommitment', () => {
    it('verifies valid key against commitment', async () => {
      const key = crypto.randomBytes(32)
      const { commitment, salt } = await createKeyCommitment(crypto, key)
      expect(await verifyKeyCommitment(crypto, key, salt, commitment)).toBe(true)
    })

    it('rejects wrong key', async () => {
      const key = crypto.randomBytes(32)
      const wrongKey = crypto.randomBytes(32)
      const { commitment, salt } = await createKeyCommitment(crypto, key)
      expect(await verifyKeyCommitment(crypto, wrongKey, salt, commitment)).toBe(false)
    })

    it('rejects wrong salt', async () => {
      const key = crypto.randomBytes(32)
      const wrongSalt = crypto.randomBytes(32)
      const { commitment } = await createKeyCommitment(crypto, key)
      expect(await verifyKeyCommitment(crypto, key, wrongSalt, commitment)).toBe(false)
    })

    it('rejects modified commitment', async () => {
      const key = crypto.randomBytes(32)
      const { commitment, salt } = await createKeyCommitment(crypto, key)
      const modified = new Uint8Array(commitment)
      modified[0] ^= 0x01
      expect(await verifyKeyCommitment(crypto, key, salt, modified)).toBe(false)
    })

    it('rejects invalid key length', async () => {
      const key = crypto.randomBytes(32)
      const { commitment, salt } = await createKeyCommitment(crypto, key)
      const shortKey = crypto.randomBytes(16)
      expect(await verifyKeyCommitment(crypto, shortKey, salt, commitment)).toBe(false)
    })
  })
})

describe('Buyer Key Encryption', () => {
  let buyerPrivateKey: Uint8Array
  let buyerPublicKey: Uint8Array

  beforeAll(() => {
    buyerPrivateKey = secp256k1.utils.randomSecretKey()
    buyerPublicKey = secp256k1.getPublicKey(buyerPrivateKey)
  })

  describe('encryptKeyForBuyer', () => {
    it('encrypts 32-byte key for buyer', async () => {
      const key = crypto.randomBytes(32)
      const encrypted = await encryptKeyForBuyer(crypto, key, buyerPublicKey)
      expect(encrypted.encryptedKey).toBeInstanceOf(Uint8Array)
      expect(encrypted.iv).toBeInstanceOf(Uint8Array)
      expect(encrypted.iv.length).toBe(12)
      expect(encrypted.ephemeralPubkey).toBeInstanceOf(Uint8Array)
      expect(encrypted.ephemeralPubkey.length).toBe(33)
    })

    it('uses different ephemeral key each time', async () => {
      const key = crypto.randomBytes(32)
      const e1 = await encryptKeyForBuyer(crypto, key, buyerPublicKey)
      const e2 = await encryptKeyForBuyer(crypto, key, buyerPublicKey)
      expect(e1.ephemeralPubkey).not.toEqual(e2.ephemeralPubkey)
      expect(e1.iv).not.toEqual(e2.iv)
    })

    it('rejects key that is not 32 bytes', async () => {
      const shortKey = crypto.randomBytes(16)
      await expect(encryptKeyForBuyer(crypto, shortKey, buyerPublicKey)).rejects.toThrow('32 bytes')
    })
  })

  describe('decryptKeyAsBuyer', () => {
    it('decrypts key with buyer private key', async () => {
      const original = crypto.randomBytes(32)
      const encrypted = await encryptKeyForBuyer(crypto, original, buyerPublicKey)
      const decrypted = await decryptKeyAsBuyer(crypto, encrypted, buyerPrivateKey)
      expect(decrypted).toEqual(original)
    })

    it('fails with wrong private key', async () => {
      const original = crypto.randomBytes(32)
      const encrypted = await encryptKeyForBuyer(crypto, original, buyerPublicKey)
      const wrongKey = secp256k1.utils.randomSecretKey()
      await expect(decryptKeyAsBuyer(crypto, encrypted, wrongKey)).rejects.toThrow()
    })

    it('fails with tampered ciphertext', async () => {
      const original = crypto.randomBytes(32)
      const encrypted = await encryptKeyForBuyer(crypto, original, buyerPublicKey)
      const tampered = { ...encrypted, encryptedKey: new Uint8Array(encrypted.encryptedKey) }
      tampered.encryptedKey[0] ^= 0x01
      await expect(decryptKeyAsBuyer(crypto, tampered, buyerPrivateKey)).rejects.toThrow()
    })

    it('fails with tampered IV', async () => {
      const original = crypto.randomBytes(32)
      const encrypted = await encryptKeyForBuyer(crypto, original, buyerPublicKey)
      const tampered = { ...encrypted, iv: new Uint8Array(encrypted.iv) }
      tampered.iv[0] ^= 0x01
      await expect(decryptKeyAsBuyer(crypto, tampered, buyerPrivateKey)).rejects.toThrow()
    })

    it('fails with tampered ephemeral pubkey', async () => {
      const original = crypto.randomBytes(32)
      const encrypted = await encryptKeyForBuyer(crypto, original, buyerPublicKey)
      const wrongEphemeral = secp256k1.getPublicKey(secp256k1.utils.randomSecretKey())
      const tampered = { ...encrypted, ephemeralPubkey: wrongEphemeral }
      await expect(decryptKeyAsBuyer(crypto, tampered, buyerPrivateKey)).rejects.toThrow()
    })
  })

  describe('roundtrip', () => {
    it('preserves key through encrypt → decrypt cycles', async () => {
      for (let i = 0; i < 5; i++) {
        const key = crypto.randomBytes(32)
        const encrypted = await encryptKeyForBuyer(crypto, key, buyerPublicKey)
        const decrypted = await decryptKeyAsBuyer(crypto, encrypted, buyerPrivateKey)
        expect(decrypted).toEqual(key)
      }
    })
  })
})

describe('Serialization', () => {
  it('roundtrips encrypted key through serialize → deserialize', async () => {
    const buyerPriv = secp256k1.utils.randomSecretKey()
    const buyerPub = secp256k1.getPublicKey(buyerPriv)
    const key = crypto.randomBytes(32)
    const encrypted = await encryptKeyForBuyer(crypto, key, buyerPub)

    const serialized = serializeEncryptedKey(encrypted)
    expect(serialized).toBeInstanceOf(Uint8Array)
    expect(serialized.length).toBe(33 + 12 + encrypted.encryptedKey.length)

    const deserialized = deserializeEncryptedKey(serialized)
    expect(deserialized.ephemeralPubkey).toEqual(encrypted.ephemeralPubkey)
    expect(deserialized.iv).toEqual(encrypted.iv)
    expect(deserialized.encryptedKey).toEqual(encrypted.encryptedKey)
  })

  it('throws on truncated data', () => {
    const tooShort = new Uint8Array(33 + 12 + 16 - 1)
    expect(() => deserializeEncryptedKey(tooShort)).toThrow('too short')
  })

  it('full encrypt → serialize → deserialize → decrypt', async () => {
    const buyerPriv = secp256k1.utils.randomSecretKey()
    const buyerPub = secp256k1.getPublicKey(buyerPriv)
    const original = crypto.randomBytes(32)
    const encrypted = await encryptKeyForBuyer(crypto, original, buyerPub)
    const serialized = serializeEncryptedKey(encrypted)
    const deserialized = deserializeEncryptedKey(serialized)
    const decrypted = await decryptKeyAsBuyer(crypto, deserialized, buyerPriv)
    expect(decrypted).toEqual(original)
  })
})

describe('Encrypted Key Commitment', () => {
  it('creates and verifies commitment for serialized encrypted key', async () => {
    const buyerPriv = secp256k1.utils.randomSecretKey()
    const buyerPub = secp256k1.getPublicKey(buyerPriv)
    const key = crypto.randomBytes(32)
    const encrypted = await encryptKeyForBuyer(crypto, key, buyerPub)
    const serialized = serializeEncryptedKey(encrypted)

    const { commitment, salt } = await createEncryptedKeyCommitment(crypto, serialized)
    expect(commitment.length).toBe(32)

    expect(await verifyEncryptedKeyCommitment(crypto, serialized, salt, commitment)).toBe(true)
  })

  it('rejects wrong serialized data', async () => {
    const buyerPriv = secp256k1.utils.randomSecretKey()
    const buyerPub = secp256k1.getPublicKey(buyerPriv)

    const key = crypto.randomBytes(32)
    const encrypted = await encryptKeyForBuyer(crypto, key, buyerPub)
    const serialized = serializeEncryptedKey(encrypted)
    const { commitment, salt } = await createEncryptedKeyCommitment(crypto, serialized)

    const differentKey = crypto.randomBytes(32)
    const differentEncrypted = await encryptKeyForBuyer(crypto, differentKey, buyerPub)
    const differentSerialized = serializeEncryptedKey(differentEncrypted)

    expect(await verifyEncryptedKeyCommitment(crypto, differentSerialized, salt, commitment)).toBe(false)
  })
})

describe('Utility Functions', () => {
  it('generateEncryptionKey produces 32 bytes', () => {
    const key = generateEncryptionKey(crypto)
    expect(key.length).toBe(32)
  })

  it('generateEncryptionKey is non-deterministic', () => {
    const k1 = generateEncryptionKey(crypto)
    const k2 = generateEncryptionKey(crypto)
    expect(k1).not.toEqual(k2)
  })
})

describe('Security Properties', () => {
  it('encrypted key cannot be decrypted without buyer private key', async () => {
    const buyerPriv = secp256k1.utils.randomSecretKey()
    const buyerPub = secp256k1.getPublicKey(buyerPriv)
    const attackerPriv = secp256k1.utils.randomSecretKey()

    const original = crypto.randomBytes(32)
    const encrypted = await encryptKeyForBuyer(crypto, original, buyerPub)
    await expect(decryptKeyAsBuyer(crypto, encrypted, attackerPriv)).rejects.toThrow()
  })

  it('different keys produce different commitments (commitment hides key)', () => {
    const k1 = crypto.randomBytes(32)
    const k2 = crypto.randomBytes(32)
    const salt = crypto.randomBytes(32)

    const c1 = sha256(new Uint8Array([...k1, ...salt]))
    const c2 = sha256(new Uint8Array([...k2, ...salt]))
    expect(c1).not.toEqual(c2)
  })

  it('salt prevents rainbow table attacks', async () => {
    const key = crypto.randomBytes(32)
    const r1 = await createKeyCommitment(crypto, key)
    const r2 = await createKeyCommitment(crypto, key)

    expect(r1.commitment).not.toEqual(r2.commitment)
    expect(r1.salt).not.toEqual(r2.salt)
    expect(await verifyKeyCommitment(crypto, key, r1.salt, r1.commitment)).toBe(true)
    expect(await verifyKeyCommitment(crypto, key, r2.salt, r2.commitment)).toBe(true)
  })

  it('ephemeral key provides forward secrecy', async () => {
    const buyerPriv = secp256k1.utils.randomSecretKey()
    const buyerPub = secp256k1.getPublicKey(buyerPriv)
    const key = crypto.randomBytes(32)

    const e1 = await encryptKeyForBuyer(crypto, key, buyerPub)
    const e2 = await encryptKeyForBuyer(crypto, key, buyerPub)

    expect(e1.encryptedKey).not.toEqual(e2.encryptedKey)
    const d1 = await decryptKeyAsBuyer(crypto, e1, buyerPriv)
    const d2 = await decryptKeyAsBuyer(crypto, e2, buyerPriv)
    expect(d1).toEqual(key)
    expect(d2).toEqual(key)
  })
})
