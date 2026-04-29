/**
 * ACT (Access Control Trie) Tests — ported from
 * fairdrive/tests/core/access/ACT.test.ts
 *
 * Tests cryptographic access control:
 * - Encrypt with DEK + per-grantee ECDH grants
 * - Decrypt for owner and grantees
 * - Grant additional grantees
 * - Revoke grantees
 * - Edge cases: empty content, binary content, large content
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Wallet, SigningKey, getBytes } from 'ethers'
import { ACT } from '../../../src/fairdrive/access/ACT.js'
import type { Bee } from '@ethersphere/bee-js'

// In-memory mock bee storage
const uploadedData = new Map<string, Buffer>()
let refCounter = 0

function createMockBee(): Bee {
  return {
    uploadData: vi.fn().mockImplementation(async (_batchId: string, data: Uint8Array) => {
      const ref = `ref${++refCounter}` + '0'.repeat(64 - `ref${refCounter}`.length)
      uploadedData.set(ref, Buffer.from(data))
      return { reference: { toHex: () => ref, toString: () => ref, toUint8Array: () => Buffer.from(ref) } }
    }),
    downloadData: vi.fn().mockImplementation(async (ref: string) => {
      const data = uploadedData.get(ref)
      if (!data) throw new Error(`Reference not found: ${ref}`)
      const bytes = new Uint8Array(data)
      return { toUint8Array: () => bytes }
    }),
  } as unknown as Bee
}

const TEST_BATCH_ID = '0'.repeat(64)
const TEST_CONTENT = Buffer.from('Hello, this is secret content!')

function createTestWallet(): { address: string; publicKey: string; privateKey: Uint8Array } {
  const wallet = Wallet.createRandom()
  const privateKeyBytes = getBytes(wallet.privateKey)
  const publicKey = SigningKey.computePublicKey(wallet.privateKey, false) // uncompressed
  return {
    address: wallet.address,
    publicKey: publicKey.slice(2), // strip 0x
    privateKey: new Uint8Array(privateKeyBytes),
  }
}

describe('ACT', () => {
  let act: ACT
  let owner: ReturnType<typeof createTestWallet>
  let grantee1: ReturnType<typeof createTestWallet>
  let grantee2: ReturnType<typeof createTestWallet>

  beforeEach(() => {
    vi.clearAllMocks()
    uploadedData.clear()
    refCounter = 0
    act = new ACT({
      beeUrl: 'http://localhost:1633',
      postageBatchId: TEST_BATCH_ID,
      bee: createMockBee() as any,
    })
    owner = createTestWallet()
    grantee1 = createTestWallet()
    grantee2 = createTestWallet()
  })

  describe('encrypt', () => {
    it('returns actRef + contentRef + metadata', async () => {
      const result = await act.encrypt(TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey)
      expect(result.actRef).toBeDefined()
      expect(result.contentRef).toBeDefined()
      expect(result.metadata).toBeDefined()
    })

    it('creates metadata with correct structure', async () => {
      const result = await act.encrypt(TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey)
      const { metadata } = result
      expect(metadata.version).toBe(2)
      expect(metadata.contentRef).toBe(result.contentRef)
      expect(metadata.contentHash).toBeDefined()
      expect(metadata.owner).toBe(owner.address)
      expect(metadata.ownerPublicKey).toBe(owner.publicKey)
      expect(metadata.grants).toBeDefined()
      expect(metadata.createdAt).toBeDefined()
      expect(metadata.modifiedAt).toBeDefined()
    })

    it('always includes owner as first grantee', async () => {
      const result = await act.encrypt(TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey)
      expect(result.metadata.grants).toHaveLength(1)
      expect(result.metadata.grants[0].grantee).toBe(owner.address)
    })

    it('includes additional grantees', async () => {
      const result = await act.encrypt(
        TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey,
        [
          { address: grantee1.address, publicKey: grantee1.publicKey },
          { address: grantee2.address, publicKey: grantee2.publicKey },
        ],
      )
      expect(result.metadata.grants).toHaveLength(3)
      expect(result.metadata.grants.map(g => g.grantee)).toEqual([
        owner.address, grantee1.address, grantee2.address,
      ])
    })

    it('generates unique encrypted DEKs per grantee', async () => {
      const result = await act.encrypt(
        TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey,
        [{ address: grantee1.address, publicKey: grantee1.publicKey }],
      )
      expect(result.metadata.grants[0].encryptedDEK).not.toBe(result.metadata.grants[1].encryptedDEK)
    })

    it('content hash is keccak256 hex (0x + 64 chars)', async () => {
      const result = await act.encrypt(TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey)
      expect(result.metadata.contentHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
    })

    it('throws without postage batch ID', async () => {
      const noBatch = new ACT({ beeUrl: 'http://localhost:1633', bee: createMockBee() as any })
      await expect(
        noBatch.encrypt(TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey)
      ).rejects.toThrow('No postage batch ID configured')
    })

    it('handles empty content', async () => {
      const result = await act.encrypt(Buffer.from(''), owner.address, owner.publicKey, owner.privateKey)
      expect(result.actRef).toBeDefined()
    })

    it('handles binary content', async () => {
      const binary = Buffer.from([0, 1, 255, 128, 64, 32, 16, 8, 4, 2, 1, 0])
      const result = await act.encrypt(binary, owner.address, owner.publicKey, owner.privateKey)
      expect(result.actRef).toBeDefined()
    })

    it('handles large content (1MB)', async () => {
      const large = Buffer.alloc(1024 * 1024, 'x')
      const result = await act.encrypt(large, owner.address, owner.publicKey, owner.privateKey)
      expect(result.actRef).toBeDefined()
    })
  })

  describe('decrypt', () => {
    it('owner can decrypt their own content', async () => {
      const enc = await act.encrypt(TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey)
      const dec = await act.decrypt(enc.actRef, owner.address, owner.privateKey)
      expect(Buffer.compare(dec, TEST_CONTENT)).toBe(0)
    })

    it('grantee can decrypt shared content', async () => {
      const enc = await act.encrypt(
        TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey,
        [{ address: grantee1.address, publicKey: grantee1.publicKey }],
      )
      const dec = await act.decrypt(enc.actRef, grantee1.address, grantee1.privateKey)
      expect(Buffer.compare(dec, TEST_CONTENT)).toBe(0)
    })

    it('throws "Access denied" for non-grantee', async () => {
      const enc = await act.encrypt(TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey)
      await expect(
        act.decrypt(enc.actRef, grantee1.address, grantee1.privateKey)
      ).rejects.toThrow(/Access denied/)
    })

    it('case-insensitive address matching', async () => {
      const enc = await act.encrypt(TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey)
      const dec = await act.decrypt(enc.actRef, owner.address.toLowerCase(), owner.privateKey)
      expect(Buffer.compare(dec, TEST_CONTENT)).toBe(0)
    })

    it('decrypts binary content correctly', async () => {
      const binary = Buffer.from([0, 1, 255, 128, 64, 32, 16, 8])
      const enc = await act.encrypt(binary, owner.address, owner.publicKey, owner.privateKey)
      const dec = await act.decrypt(enc.actRef, owner.address, owner.privateKey)
      expect(Buffer.compare(dec, binary)).toBe(0)
    })
  })

  describe('grant', () => {
    it('owner can grant access to a new grantee', async () => {
      const enc = await act.encrypt(TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey)
      const newRef = await act.grant(
        enc.actRef, owner.address, owner.privateKey,
        { address: grantee1.address, publicKey: grantee1.publicKey },
      )
      expect(newRef).toBeDefined()

      const dec = await act.decrypt(newRef, grantee1.address, grantee1.privateKey)
      expect(Buffer.compare(dec, TEST_CONTENT)).toBe(0)
    })

    it('throws if not owner', async () => {
      const enc = await act.encrypt(TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey)
      await expect(
        act.grant(enc.actRef, grantee1.address, grantee1.privateKey,
          { address: grantee2.address, publicKey: grantee2.publicKey })
      ).rejects.toThrow(/not the owner/)
    })

    it('throws if grantee already has access', async () => {
      const enc = await act.encrypt(
        TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey,
        [{ address: grantee1.address, publicKey: grantee1.publicKey }],
      )
      await expect(
        act.grant(enc.actRef, owner.address, owner.privateKey,
          { address: grantee1.address, publicKey: grantee1.publicKey })
      ).rejects.toThrow(/already has access/)
    })

    it('updates modifiedAt timestamp', async () => {
      const enc = await act.encrypt(TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey)
      const before = enc.metadata.modifiedAt
      await new Promise(r => setTimeout(r, 10))

      const newRef = await act.grant(enc.actRef, owner.address, owner.privateKey,
        { address: grantee1.address, publicKey: grantee1.publicKey })
      const newMeta = await act.loadMetadata(newRef)
      expect(new Date(newMeta.modifiedAt).getTime()).toBeGreaterThan(new Date(before).getTime())
    })
  })

  describe('revoke', () => {
    it('owner can revoke grantee access', async () => {
      const enc = await act.encrypt(
        TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey,
        [{ address: grantee1.address, publicKey: grantee1.publicKey }],
      )
      const newRef = await act.revoke(enc.actRef, owner.address, grantee1.address)

      await expect(
        act.decrypt(newRef, grantee1.address, grantee1.privateKey)
      ).rejects.toThrow(/Access denied/)
    })

    it('owner retains access after revocation', async () => {
      const enc = await act.encrypt(
        TEST_CONTENT, owner.address, owner.publicKey, owner.privateKey,
        [{ address: grantee1.address, publicKey: grantee1.publicKey }],
      )
      const newRef = await act.revoke(enc.actRef, owner.address, grantee1.address)
      const dec = await act.decrypt(newRef, owner.address, owner.privateKey)
      expect(Buffer.compare(dec, TEST_CONTENT)).toBe(0)
    })
  })
})
