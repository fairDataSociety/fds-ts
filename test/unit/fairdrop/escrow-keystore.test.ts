/**
 * EscrowKeystore Tests — ported from fairdrop/tests/unit/escrow-keystore.test.ts
 *
 * Tests secure key storage for escrow encryption keys.
 * Critical for crash recovery functionality.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { EscrowKeystore } from '../../../src/fairdrop/escrow-keystore.js'
import { NodeCryptoProvider } from '../../../src/fairdrop/crypto/node.js'

const TEST_PASSWORD = 'test-password-12345'
const WRONG_PASSWORD = 'wrong-password'

/**
 * In-memory storage adapter matching escrow-keystore's setItem/getItem contract.
 * (The real fairdrop StorageAdapter interface uses get/set, but escrow-keystore
 * was written against an older shape — fixture matches actual usage.)
 */
function createTestStorage(): any {
  const store: Record<string, string> = {}
  return {
    _store: store,
    get: async (key: string) => store[key] ?? null,
    set: async (key: string, value: string) => { store[key] = value },
    remove: async (key: string) => { delete store[key] },
    keys: async () => Object.keys(store),
    session: {
      get: () => null,
      set: () => {},
      remove: () => {},
    },
  }
}

const encoding = {
  bytesToHex: (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex'),
  hexToBytes: (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex.startsWith('0x') ? hex.slice(2) : hex, 'hex')),
  base64Encode: (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64'),
  base64Decode: (str: string): Uint8Array => Uint8Array.from(Buffer.from(str, 'base64')),
} as any

describe('EscrowKeystore', () => {
  let keystore: EscrowKeystore
  let storage: ReturnType<typeof createTestStorage>
  const crypto = new NodeCryptoProvider()

  beforeEach(() => {
    storage = createTestStorage()
    keystore = new EscrowKeystore(storage, crypto, encoding)
  })

  describe('storeKey', () => {
    it('stores encrypted key data correctly', async () => {
      const escrowId = '123'
      const keyData = {
        encryptionKey: crypto.randomBytes(32),
        salt: crypto.randomBytes(32),
      }

      await keystore.storeKey(escrowId, keyData, TEST_PASSWORD)

      expect(await keystore.hasKey(escrowId)).toBe(true)

      const keys = await keystore.listKeys()
      expect(keys).toHaveLength(1)
      expect(keys[0].escrowId).toBe(escrowId)
      expect(keys[0].status).toBe('created')
    })

    it('stores commitment salt when provided', async () => {
      const escrowId = '456'
      const keyData = {
        encryptionKey: crypto.randomBytes(32),
        salt: crypto.randomBytes(32),
        commitmentSalt: crypto.randomBytes(32),
      }

      await keystore.storeKey(escrowId, keyData, TEST_PASSWORD)
      const retrieved = await keystore.getKey(escrowId, TEST_PASSWORD)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.commitmentSalt).toBeDefined()
      expect(retrieved!.commitmentSalt!.length).toBe(32)
    })

    it('overwrites existing key for same escrow ID', async () => {
      const escrowId = '789'
      const keyData1 = { encryptionKey: crypto.randomBytes(32), salt: crypto.randomBytes(32) }
      const keyData2 = { encryptionKey: crypto.randomBytes(32), salt: crypto.randomBytes(32) }

      await keystore.storeKey(escrowId, keyData1, TEST_PASSWORD)
      await keystore.storeKey(escrowId, keyData2, TEST_PASSWORD)

      const keys = await keystore.listKeys()
      expect(keys).toHaveLength(1)

      const retrieved = await keystore.getKey(escrowId, TEST_PASSWORD)
      expect(encoding.bytesToHex(retrieved!.encryptionKey)).toBe(encoding.bytesToHex(keyData2.encryptionKey))
    })
  })

  describe('getKey', () => {
    it('retrieves and decrypts stored key', async () => {
      const escrowId = '100'
      const original = {
        encryptionKey: crypto.randomBytes(32),
        salt: crypto.randomBytes(32),
      }

      await keystore.storeKey(escrowId, original, TEST_PASSWORD)
      const retrieved = await keystore.getKey(escrowId, TEST_PASSWORD)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.encryptionKey).toEqual(original.encryptionKey)
      expect(retrieved!.salt).toEqual(original.salt)
    })

    it('returns null for non-existent key', async () => {
      const result = await keystore.getKey('nonexistent', TEST_PASSWORD)
      expect(result).toBeNull()
    })

    it('throws on wrong password', async () => {
      const escrowId = '200'
      await keystore.storeKey(escrowId, {
        encryptionKey: crypto.randomBytes(32),
        salt: crypto.randomBytes(32),
      }, TEST_PASSWORD)

      await expect(keystore.getKey(escrowId, WRONG_PASSWORD)).rejects.toThrow()
    })
  })

  describe('updateStatus', () => {
    it('updates key status', async () => {
      const escrowId = '300'
      await keystore.storeKey(escrowId, {
        encryptionKey: crypto.randomBytes(32),
        salt: crypto.randomBytes(32),
      }, TEST_PASSWORD)

      await keystore.updateStatus(escrowId, 'committed')

      const keys = await keystore.listKeys()
      const updated = keys.find(k => k.escrowId === escrowId)
      expect(updated?.status).toBe('committed')
    })

    it('updates status with commitment salt', async () => {
      const escrowId = '301'
      await keystore.storeKey(escrowId, {
        encryptionKey: crypto.randomBytes(32),
        salt: crypto.randomBytes(32),
      }, TEST_PASSWORD)

      const commitmentSalt = crypto.randomBytes(32)
      const serializedKey = crypto.randomBytes(77) // 33 + 12 + 32
      await keystore.updateStatus(escrowId, 'committed', commitmentSalt, TEST_PASSWORD, serializedKey)

      const retrieved = await keystore.getKey(escrowId, TEST_PASSWORD)
      expect(retrieved?.commitmentSalt).toEqual(commitmentSalt)
      expect(retrieved?.serializedEncryptedKey).toEqual(serializedKey)
    })
  })

  describe('listKeys / deleteKey', () => {
    it('lists multiple stored keys', async () => {
      await keystore.storeKey('1', { encryptionKey: crypto.randomBytes(32), salt: crypto.randomBytes(32) }, TEST_PASSWORD)
      await keystore.storeKey('2', { encryptionKey: crypto.randomBytes(32), salt: crypto.randomBytes(32) }, TEST_PASSWORD)
      await keystore.storeKey('3', { encryptionKey: crypto.randomBytes(32), salt: crypto.randomBytes(32) }, TEST_PASSWORD)

      const keys = await keystore.listKeys()
      expect(keys).toHaveLength(3)
      const ids = keys.map(k => k.escrowId).sort()
      expect(ids).toEqual(['1', '2', '3'])
    })

    it('deletes a specific key', async () => {
      await keystore.storeKey('keep', { encryptionKey: crypto.randomBytes(32), salt: crypto.randomBytes(32) }, TEST_PASSWORD)
      await keystore.storeKey('delete', { encryptionKey: crypto.randomBytes(32), salt: crypto.randomBytes(32) }, TEST_PASSWORD)

      await keystore.deleteKey('delete')

      expect(await keystore.hasKey('keep')).toBe(true)
      expect(await keystore.hasKey('delete')).toBe(false)
    })

    it('returns empty list when no keys stored', async () => {
      const keys = await keystore.listKeys()
      expect(keys).toEqual([])
    })
  })

  describe('crash recovery', () => {
    it('persists keys across keystore instances (same backing storage)', async () => {
      const escrowId = 'recovery-test'
      const original = {
        encryptionKey: crypto.randomBytes(32),
        salt: crypto.randomBytes(32),
      }

      // Store with first instance
      await keystore.storeKey(escrowId, original, TEST_PASSWORD)

      // Create a fresh keystore instance pointing at same storage
      const recovered = new EscrowKeystore(storage, crypto, encoding)
      const retrieved = await recovered.getKey(escrowId, TEST_PASSWORD)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.encryptionKey).toEqual(original.encryptionKey)
      expect(retrieved!.salt).toEqual(original.salt)
    })
  })
})
