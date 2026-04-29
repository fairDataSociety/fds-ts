/**
 * WalletManager Tests — ported from
 * fairdrive/tests/core/identity/WalletManager.test.ts
 *
 * Tests HD wallet management for the SDK:
 * - Wallet creation with mnemonic
 * - Wallet import from mnemonic
 * - Pod encryption key derivation
 * - Determinism across instances
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { WalletManager } from '../../../src/fairdrive/identity/WalletManager.js'

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('WalletManager', () => {
  let wm: WalletManager

  beforeEach(() => {
    wm = new WalletManager()
  })

  describe('constructor', () => {
    it('creates instance', () => {
      expect(wm).toBeDefined()
    })

    it('starts with no wallet loaded', () => {
      expect(wm.getWallet()).toBeUndefined()
      expect(wm.getHDNode()).toBeUndefined()
    })
  })

  describe('create', () => {
    it('returns wallet + 12-word mnemonic', async () => {
      const { wallet, mnemonic } = await wm.create()
      expect(wallet.address).toBeDefined()
      expect(wallet.publicKey).toBeDefined()
      expect(mnemonic.split(' ')).toHaveLength(12)
    })

    it('generates valid Ethereum address', async () => {
      const { wallet } = await wm.create()
      expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    })

    it('generates valid public key', async () => {
      const { wallet } = await wm.create()
      // Compressed (33 bytes = 0x02/0x03 + 32) or uncompressed (65 bytes = 0x04 + 64)
      expect(wallet.publicKey).toMatch(/^0x(02|03)[0-9a-fA-F]{64}$|^0x04[0-9a-fA-F]{128}$/)
    })

    it('sets the wallet as current', async () => {
      const { wallet } = await wm.create()
      expect(wm.getWallet()).toEqual(wallet)
    })

    it('generates unique wallets each time', async () => {
      const wm1 = new WalletManager()
      const wm2 = new WalletManager()
      const { wallet: w1 } = await wm1.create()
      const { wallet: w2 } = await wm2.create()
      expect(w1.address).not.toBe(w2.address)
    })
  })

  describe('import', () => {
    it('imports from valid mnemonic', async () => {
      const wallet = await wm.import(TEST_MNEMONIC)
      expect(wallet.address).toBeDefined()
      expect(wallet.publicKey).toBeDefined()
    })

    it('produces deterministic address from mnemonic', async () => {
      const wm1 = new WalletManager()
      const wm2 = new WalletManager()
      const w1 = await wm1.import(TEST_MNEMONIC)
      const w2 = await wm2.import(TEST_MNEMONIC)
      expect(w1.address).toBe(w2.address)
      expect(w1.publicKey).toBe(w2.publicKey)
    })

    it('throws on invalid mnemonic', async () => {
      await expect(wm.import('invalid mnemonic phrase')).rejects.toThrow(/[Ii]nvalid mnemonic/)
    })

    it('throws on empty mnemonic', async () => {
      await expect(wm.import('')).rejects.toThrow()
    })

    it('throws on partial mnemonic', async () => {
      await expect(wm.import('abandon abandon abandon')).rejects.toThrow()
    })

    it('sets wallet as current after import', async () => {
      const wallet = await wm.import(TEST_MNEMONIC)
      expect(wm.getWallet()).toEqual(wallet)
    })
  })

  describe('export', () => {
    it('exports mnemonic after create', async () => {
      const { mnemonic } = await wm.create()
      expect(await wm.export()).toBe(mnemonic)
    })

    it('exports mnemonic after import', async () => {
      await wm.import(TEST_MNEMONIC)
      expect(await wm.export()).toBe(TEST_MNEMONIC)
    })

    it('throws when no wallet loaded', async () => {
      await expect(wm.export()).rejects.toThrow(/No wallet/)
    })
  })

  describe('deriveKey', () => {
    beforeEach(async () => {
      await wm.import(TEST_MNEMONIC)
    })

    it('derives 32-byte encryption key for pod', async () => {
      const key = await wm.deriveKey('my-pod')
      expect(key).toBeInstanceOf(Uint8Array)
      expect(key.length).toBe(32)
    })

    it('is deterministic for same pod', async () => {
      const k1 = await wm.deriveKey('test-pod')
      const k2 = await wm.deriveKey('test-pod')
      expect(Buffer.from(k1)).toEqual(Buffer.from(k2))
    })

    it('different pods produce different keys', async () => {
      const k1 = await wm.deriveKey('pod1')
      const k2 = await wm.deriveKey('pod2')
      expect(Buffer.from(k1)).not.toEqual(Buffer.from(k2))
    })

    it('agrees across WalletManager instances with same mnemonic', async () => {
      const wm2 = new WalletManager()
      await wm2.import(TEST_MNEMONIC)
      const k1 = await wm.deriveKey('shared-pod')
      const k2 = await wm2.deriveKey('shared-pod')
      expect(Buffer.from(k1)).toEqual(Buffer.from(k2))
    })

    it('throws when no wallet loaded', async () => {
      const fresh = new WalletManager()
      await expect(fresh.deriveKey('pod')).rejects.toThrow(/No wallet/)
    })

    it('handles special characters in pod name', async () => {
      const key = await wm.deriveKey('my-pod_v2.0 (test)')
      expect(key.length).toBe(32)
    })

    it('handles unicode pod names', async () => {
      const key = await wm.deriveKey('世界-pod')
      expect(key.length).toBe(32)
    })

    it('handles empty pod name', async () => {
      const key = await wm.deriveKey('')
      expect(key.length).toBe(32)
    })
  })
})
