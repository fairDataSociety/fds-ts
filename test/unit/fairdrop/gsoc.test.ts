/**
 * GSOC Module Tests — ported from fairdrop/tests/unit/gsoc.test.ts
 *
 * Tests inbox identifier generation and deterministic key derivation
 * for zero-leak private messaging.
 */

import { describe, it, expect } from 'vitest'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { INBOX_PREFIX, getIndexedIdentifier } from '../../../src/fairdrop/gsoc.js'

function keccakHex(data: string): string {
  const bytes = new TextEncoder().encode(data)
  return '0x' + Buffer.from(keccak_256(bytes)).toString('hex')
}

describe('GSOC Module', () => {
  describe('Constants', () => {
    it('has the correct inbox prefix', () => {
      expect(INBOX_PREFIX).toBe('fairdrop-inbox-v2')
    })
  })

  describe('getIndexedIdentifier', () => {
    it('generates unique identifiers for different indices', () => {
      const baseId = keccakHex('test-inbox')

      const id0 = getIndexedIdentifier(baseId, 0)
      const id1 = getIndexedIdentifier(baseId, 1)
      const id2 = getIndexedIdentifier(baseId, 2)

      expect(id0).not.toBe(id1)
      expect(id1).not.toBe(id2)
      expect(id0).not.toBe(id2)
    })

    it('is deterministic for same inputs', () => {
      const baseId = keccakHex('test-inbox')

      const id1 = getIndexedIdentifier(baseId, 5)
      const id2 = getIndexedIdentifier(baseId, 5)

      expect(id1).toBe(id2)
    })

    it('produces 32-byte keccak256 hash (0x + 64 hex chars)', () => {
      const baseId = keccakHex('test-inbox')
      const id = getIndexedIdentifier(baseId, 0)
      expect(id).toMatch(/^0x[0-9a-f]{64}$/)
    })

    it('handles large index values', () => {
      const baseId = keccakHex('test-inbox')

      const id1 = getIndexedIdentifier(baseId, 999999)
      const id2 = getIndexedIdentifier(baseId, 1000000)

      expect(id1).not.toBe(id2)
      expect(id1).toMatch(/^0x[0-9a-f]{64}$/)
    })

    it('produces different results for different base identifiers', () => {
      const baseId1 = keccakHex('inbox-alice')
      const baseId2 = keccakHex('inbox-bob')

      const id1 = getIndexedIdentifier(baseId1, 0)
      const id2 = getIndexedIdentifier(baseId2, 0)

      expect(id1).not.toBe(id2)
    })

    it('handles index 0 explicitly (first slot)', () => {
      const baseId = keccakHex('test-inbox')
      const id = getIndexedIdentifier(baseId, 0)
      // Should not be the same as the bare base identifier
      expect(id).not.toBe(baseId)
      expect(id).toMatch(/^0x[0-9a-f]{64}$/)
    })

    it('produces different results for adjacent indices', () => {
      const baseId = keccakHex('test-inbox')
      // Adjacent indices should produce wildly different hashes (avalanche effect)
      const id100 = getIndexedIdentifier(baseId, 100)
      const id101 = getIndexedIdentifier(baseId, 101)

      // Hamming distance — at least 50 of 256 bits should differ on average
      let differingChars = 0
      for (let i = 2; i < id100.length; i++) {
        if (id100[i] !== id101[i]) differingChars++
      }
      expect(differingChars).toBeGreaterThan(20)  // strong avalanche
    })
  })
})
