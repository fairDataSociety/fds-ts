/**
 * SecureWallet Tests — ported from
 * fairdrive/tests/core/identity/SecureWallet.test.ts
 *
 * Tests password-protected, AES-256-GCM-encrypted wallet:
 * - Creation + import
 * - Address derivation matches Go fds-id-go (cross-platform interop)
 * - Pod key derivation requires correct password
 * - Sign messages
 */

import { describe, it, expect } from 'vitest'
import { SecureWallet } from '../../../src/fairdrive/identity/SecureWallet.js'

const TEST_PASSWORD = 'test-password-123!'
const WRONG_PASSWORD = 'wrong-password-456!'

const TEST_MNEMONIC_12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const TEST_MNEMONIC_24 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'

// Known address for TEST_MNEMONIC_12 at m/44'/60'/0'/0/0
// Matches Go fds-id-go DefaultDerivationPath for cross-platform interop
const EXPECTED_ADDRESS_12 = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'

describe('SecureWallet', () => {
  describe('create()', () => {
    it('creates a new wallet with random mnemonic', async () => {
      const { wallet, mnemonic } = await SecureWallet.create(TEST_PASSWORD)
      expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(wallet.publicKey).toMatch(/^0x[a-fA-F0-9]+$/)
      expect(mnemonic.split(' ')).toHaveLength(12)
    })

    it('creates different wallets on each call', async () => {
      const r1 = await SecureWallet.create(TEST_PASSWORD)
      const r2 = await SecureWallet.create(TEST_PASSWORD)
      expect(r1.wallet.address).not.toBe(r2.wallet.address)
      expect(r1.mnemonic).not.toBe(r2.mnemonic)
    })

    it('returns a valid BIP-39 mnemonic that can be re-imported', async () => {
      const { mnemonic } = await SecureWallet.create(TEST_PASSWORD)
      const reImported = await SecureWallet.fromMnemonic(mnemonic, TEST_PASSWORD)
      expect(reImported.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    it('encrypts the seed immediately (encrypted blob > raw seed)', async () => {
      const { wallet } = await SecureWallet.create(TEST_PASSWORD)
      const encrypted = wallet.getEncryptedData()
      // Raw seed = 64 bytes; encrypted = IV + ciphertext + authTag > 64
      expect(encrypted.encryptedSeed.length).toBeGreaterThan(64)
      expect(encrypted.kdfSalt.length).toBe(32)
    })
  })

  describe('fromMnemonic()', () => {
    it('imports wallet from 12-word mnemonic with known Go-compatible address', async () => {
      const wallet = await SecureWallet.fromMnemonic(TEST_MNEMONIC_12, TEST_PASSWORD)
      expect(wallet.address.toLowerCase()).toBe(EXPECTED_ADDRESS_12.toLowerCase())
    })

    it('imports wallet from 24-word mnemonic', async () => {
      const wallet = await SecureWallet.fromMnemonic(TEST_MNEMONIC_24, TEST_PASSWORD)
      expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    it('derives same address regardless of password', async () => {
      const w1 = await SecureWallet.fromMnemonic(TEST_MNEMONIC_12, 'password1')
      const w2 = await SecureWallet.fromMnemonic(TEST_MNEMONIC_12, 'password2')
      expect(w1.address).toBe(w2.address)
    })

    it('rejects invalid mnemonic', async () => {
      const invalidPhrase = 'invalid words that are not valid bip39 mnemonic words at all'
      await expect(SecureWallet.fromMnemonic(invalidPhrase, TEST_PASSWORD)).rejects.toThrow()
    })
  })

  describe('derivePodKey()', () => {
    it('derives 32-byte pod key with correct password', async () => {
      const wallet = await SecureWallet.fromMnemonic(TEST_MNEMONIC_12, TEST_PASSWORD)
      const key = await wallet.derivePodKey('Home', TEST_PASSWORD)
      expect(key).toBeInstanceOf(Uint8Array)
      expect(key.length).toBe(32)
    })

    it('throws on wrong password', async () => {
      const wallet = await SecureWallet.fromMnemonic(TEST_MNEMONIC_12, TEST_PASSWORD)
      await expect(wallet.derivePodKey('Home', WRONG_PASSWORD)).rejects.toThrow()
    })

    it('is deterministic for same pod', async () => {
      const wallet = await SecureWallet.fromMnemonic(TEST_MNEMONIC_12, TEST_PASSWORD)
      const k1 = await wallet.derivePodKey('Home', TEST_PASSWORD)
      const k2 = await wallet.derivePodKey('Home', TEST_PASSWORD)
      expect(Buffer.from(k1)).toEqual(Buffer.from(k2))
    })

    it('produces different keys for different pods', async () => {
      const wallet = await SecureWallet.fromMnemonic(TEST_MNEMONIC_12, TEST_PASSWORD)
      const homeKey = await wallet.derivePodKey('Home', TEST_PASSWORD)
      const workKey = await wallet.derivePodKey('Work', TEST_PASSWORD)
      expect(Buffer.from(homeKey)).not.toEqual(Buffer.from(workKey))
    })

    it('agrees across instances with same mnemonic + password', async () => {
      const w1 = await SecureWallet.fromMnemonic(TEST_MNEMONIC_12, TEST_PASSWORD)
      const w2 = await SecureWallet.fromMnemonic(TEST_MNEMONIC_12, TEST_PASSWORD)
      const k1 = await w1.derivePodKey('shared', TEST_PASSWORD)
      const k2 = await w2.derivePodKey('shared', TEST_PASSWORD)
      expect(Buffer.from(k1)).toEqual(Buffer.from(k2))
    })
  })

  describe('lock state', () => {
    it('exposes address + publicKey when unlocked', async () => {
      const wallet = await SecureWallet.fromMnemonic(TEST_MNEMONIC_12, TEST_PASSWORD)
      expect(wallet.address).toBeDefined()
      expect(wallet.publicKey).toBeDefined()
    })
  })
})
