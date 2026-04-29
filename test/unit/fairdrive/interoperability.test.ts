/**
 * Interoperability Tests — ported from
 * fairdrive/tests/core/interop/interoperability.test.ts
 *
 * Verifies that the consolidated TS implementation produces formats
 * and keys compatible with Go fds-id-go and Fairdrop.
 */

import { describe, it, expect } from 'vitest'
import { WalletManager } from '../../../src/fairdrive/identity/WalletManager.js'
import { keccak256, toUtf8Bytes, Mnemonic, HDNodeWallet } from 'ethers'

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('interoperability', () => {
  describe('keystore format', () => {
    it('WalletManager produces deterministic wallet matching Go fds-id-go', async () => {
      const wm = new WalletManager()
      const wallet = await wm.import(TEST_MNEMONIC)
      // Go fds-id-go DefaultDerivationPath m/44'/60'/0'/0/0
      expect(wallet.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94')
    })

    it('matches Go DefaultDerivationPath wallet', async () => {
      const mnemonic = Mnemonic.fromPhrase(TEST_MNEMONIC)
      const goPathWallet = HDNodeWallet.fromMnemonic(mnemonic, "m/44'/60'/0'/0/0")
      const wm = new WalletManager()
      const tsWallet = await wm.import(TEST_MNEMONIC)
      expect(tsWallet.address).toBe(goPathWallet.address)
    })

    it('HD node has correct public/private key shape', async () => {
      const wm = new WalletManager()
      await wm.import(TEST_MNEMONIC)
      const hdNode = wm.getHDNode()
      expect(hdNode!.publicKey).toMatch(/^0x0[23]/) // ethers v6 compressed
      expect(hdNode!.privateKey).toMatch(/^0x/)
      expect(hdNode!.privateKey.length).toBe(66)
    })

    it('same mnemonic always produces same wallet', async () => {
      const wm1 = new WalletManager()
      const wm2 = new WalletManager()
      const w1 = await wm1.import(TEST_MNEMONIC)
      const w2 = await wm2.import(TEST_MNEMONIC)
      expect(w1.address).toBe(w2.address)
      expect(w1.publicKey).toBe(w2.publicKey)
    })
  })

  describe('pod encryption key compatibility', () => {
    it('derives deterministic pod key', async () => {
      const wm = new WalletManager()
      await wm.import(TEST_MNEMONIC)
      const k1 = await wm.deriveKey('Home')
      const k2 = await wm.deriveKey('Home')
      expect(k1).toEqual(k2)
      expect(k1.length).toBe(32)
    })

    it('matches Go formula: keccak256(privateKeyHex:pod:podName)', async () => {
      const wm = new WalletManager()
      await wm.import(TEST_MNEMONIC)
      const key = await wm.deriveKey('Home')

      // Manually compute expected via Go-compatible formula
      const mnemonic = Mnemonic.fromPhrase(TEST_MNEMONIC)
      const hdNode = HDNodeWallet.fromMnemonic(mnemonic, "m/44'/60'/0'/0/0")
      const privKeyHex = hdNode.privateKey.slice(2)
      const hash = keccak256(toUtf8Bytes(`${privKeyHex}:pod:Home`))
      const expected = new Uint8Array(Buffer.from(hash.slice(2), 'hex'))

      expect(key).toEqual(expected)
    })

    it('pod key is stable across instances', async () => {
      const wm1 = new WalletManager()
      const wm2 = new WalletManager()
      await wm1.import(TEST_MNEMONIC)
      await wm2.import(TEST_MNEMONIC)
      expect(await wm1.deriveKey('Documents')).toEqual(await wm2.deriveKey('Documents'))
    })

    it('child wallet derivation is deterministic', async () => {
      const wm = new WalletManager()
      await wm.import(TEST_MNEMONIC)
      const c0a = await wm.deriveChild(0)
      const c0b = await wm.deriveChild(0)
      const c1 = await wm.deriveChild(1)
      expect(c0a.address).toBe(c0b.address)
      expect(c0a.address).not.toBe(c1.address)
    })
  })
})
