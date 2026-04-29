/**
 * Key Derivation Tests — TDD
 *
 * Tests the key derivation chain:
 *   wallet privkey → pod key (keccak256) → file key (PBKDF2)
 *
 * Security requirements from spec:
 * - Pod key: keccak256(privateKeyHex + ":pod:" + podName)
 * - File key: PBKDF2(podKey, "fairdrive:v1:{podName}:{filePath}", 100000, SHA-256)
 * - Deterministic: same inputs → same keys (cross-platform interop with Go fds-id-go)
 * - Pod names must not contain ":pod:" (key derivation ambiguity — finding S11)
 */

import { describe, it, expect } from 'vitest'
import { derivePodKey, deriveFileKey, validatePodName } from '../../../src/crypto/keys.js'

describe('Key Derivation', () => {
  const testPrivKeyHex = 'a'.repeat(64)  // 32 bytes as hex

  describe('derivePodKey', () => {
    it('produces a 32-byte key', () => {
      const key = derivePodKey(testPrivKeyHex, 'documents')
      expect(key).toBeInstanceOf(Uint8Array)
      expect(key.length).toBe(32)
    })

    it('is deterministic', () => {
      const key1 = derivePodKey(testPrivKeyHex, 'documents')
      const key2 = derivePodKey(testPrivKeyHex, 'documents')
      expect(Buffer.from(key1).toString('hex')).toBe(Buffer.from(key2).toString('hex'))
    })

    it('different pod names produce different keys', () => {
      const key1 = derivePodKey(testPrivKeyHex, 'documents')
      const key2 = derivePodKey(testPrivKeyHex, 'photos')
      expect(Buffer.from(key1).toString('hex')).not.toBe(Buffer.from(key2).toString('hex'))
    })

    it('different private keys produce different keys', () => {
      const key1 = derivePodKey('a'.repeat(64), 'documents')
      const key2 = derivePodKey('b'.repeat(64), 'documents')
      expect(Buffer.from(key1).toString('hex')).not.toBe(Buffer.from(key2).toString('hex'))
    })

    it('normalizes 0x prefix on private key', () => {
      const withPrefix = derivePodKey('0x' + testPrivKeyHex, 'documents')
      const without = derivePodKey(testPrivKeyHex, 'documents')
      expect(Buffer.from(withPrefix).toString('hex')).toBe(Buffer.from(without).toString('hex'))
    })
  })

  describe('deriveFileKey', () => {
    it('produces a 32-byte key', async () => {
      const podKey = derivePodKey(testPrivKeyHex, 'documents')
      const fileKey = await deriveFileKey(podKey, 'documents', '/report.pdf')
      expect(fileKey).toBeInstanceOf(Uint8Array)
      expect(fileKey.length).toBe(32)
    })

    it('is deterministic', async () => {
      const podKey = derivePodKey(testPrivKeyHex, 'documents')
      const key1 = await deriveFileKey(podKey, 'documents', '/report.pdf')
      const key2 = await deriveFileKey(podKey, 'documents', '/report.pdf')
      expect(Buffer.from(key1).toString('hex')).toBe(Buffer.from(key2).toString('hex'))
    })

    it('different paths produce different keys', async () => {
      const podKey = derivePodKey(testPrivKeyHex, 'documents')
      const key1 = await deriveFileKey(podKey, 'documents', '/a.txt')
      const key2 = await deriveFileKey(podKey, 'documents', '/b.txt')
      expect(Buffer.from(key1).toString('hex')).not.toBe(Buffer.from(key2).toString('hex'))
    })

    it('different pods produce different keys for same path', async () => {
      const podKey1 = derivePodKey(testPrivKeyHex, 'docs')
      const podKey2 = derivePodKey(testPrivKeyHex, 'photos')
      const key1 = await deriveFileKey(podKey1, 'docs', '/file.txt')
      const key2 = await deriveFileKey(podKey2, 'photos', '/file.txt')
      expect(Buffer.from(key1).toString('hex')).not.toBe(Buffer.from(key2).toString('hex'))
    })
  })

  describe('validatePodName', () => {
    it('accepts valid pod names', () => {
      expect(validatePodName('documents')).toBe(true)
      expect(validatePodName('my-pod')).toBe(true)
      expect(validatePodName('pod123')).toBe(true)
    })

    it('rejects pod names with colons (S11 — KDF ambiguity)', () => {
      expect(validatePodName('x:pod:y')).toBe(false)
      expect(validatePodName('has:colon')).toBe(false)
    })

    it('rejects empty names', () => {
      expect(validatePodName('')).toBe(false)
    })

    it('rejects names with path separators', () => {
      expect(validatePodName('a/b')).toBe(false)
      expect(validatePodName('../escape')).toBe(false)
    })
  })
})
