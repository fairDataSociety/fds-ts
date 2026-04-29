/**
 * Pod Key Derivation Cross-Component Tests
 * Ported from fairdrive/tests/core/identity/podkey-derivation.test.ts
 *
 * Verifies WalletManager and SecureWallet produce SAME pod encryption key
 * matching the canonical Go fds-id-go formula:
 *   keccak256(privateKeyHex + ":pod:" + podName)
 */

import { describe, it, expect } from 'vitest'
import { WalletManager } from '../../../src/fairdrive/identity/WalletManager.js'
import { SecureWallet } from '../../../src/fairdrive/identity/SecureWallet.js'
import { keccak256, toUtf8Bytes, Mnemonic, HDNodeWallet } from 'ethers'

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const TEST_PASSWORD = 'test-password-123!'

// Pre-computed Go fds-id-go test vector for podName="Home"
const GO_EXPECTED_KEY_HEX = '0xb5ff3fcfd217a92b9f164cdc65be347b83ec04e6819964f274c62a73414cc9ab'
const GO_EXPECTED_KEY = new Uint8Array(Buffer.from(GO_EXPECTED_KEY_HEX.slice(2), 'hex'))

function referenceDerivation(privateKeyHex: string, podName: string): Uint8Array {
  const hash = keccak256(toUtf8Bytes(`${privateKeyHex}:pod:${podName}`))
  return new Uint8Array(Buffer.from(hash.slice(2), 'hex'))
}

describe('Pod Key Derivation — cross-component', () => {
  const mnemonic = Mnemonic.fromPhrase(TEST_MNEMONIC)
  const hdNode = HDNodeWallet.fromMnemonic(mnemonic, "m/44'/60'/0'/0/0")
  const privKeyHex = hdNode.privateKey.slice(2)

  describe('reference formula matches Go fds-id-go', () => {
    it('matches Go test vector for Home pod', () => {
      const key = referenceDerivation(privKeyHex, 'Home')
      expect(key).toEqual(GO_EXPECTED_KEY)
    })

    it('different pods produce different keys', () => {
      expect(referenceDerivation(privKeyHex, 'Home')).not.toEqual(referenceDerivation(privKeyHex, 'Work'))
    })

    it('produces 32-byte keys', () => {
      expect(referenceDerivation(privKeyHex, 'Home').length).toBe(32)
    })
  })

  describe('WalletManager matches Go', () => {
    it('produces same key as Go test vector', async () => {
      const wm = new WalletManager()
      await wm.import(TEST_MNEMONIC)
      const key = await wm.deriveKey('Home')
      expect(key).toEqual(GO_EXPECTED_KEY)
    })

    it('matches reference for multiple pods', async () => {
      const wm = new WalletManager()
      await wm.import(TEST_MNEMONIC)
      for (const podName of ['Home', 'Work', 'Photos', 'Documents']) {
        expect(await wm.deriveKey(podName)).toEqual(referenceDerivation(privKeyHex, podName))
      }
    })

    it('is deterministic across instances', async () => {
      const wm1 = new WalletManager()
      await wm1.import(TEST_MNEMONIC)
      const wm2 = new WalletManager()
      await wm2.import(TEST_MNEMONIC)
      expect(await wm1.deriveKey('Home')).toEqual(await wm2.deriveKey('Home'))
    })
  })

  describe('SecureWallet matches Go', () => {
    it('produces same key as Go test vector', async () => {
      const sw = await SecureWallet.fromMnemonic(TEST_MNEMONIC, TEST_PASSWORD)
      const key = await sw.derivePodKey('Home', TEST_PASSWORD)
      expect(key).toEqual(GO_EXPECTED_KEY)
    })

    it('matches reference for multiple pods', async () => {
      const sw = await SecureWallet.fromMnemonic(TEST_MNEMONIC, TEST_PASSWORD)
      for (const podName of ['Home', 'Work', 'Photos', 'Documents']) {
        const swKey = await sw.derivePodKey(podName, TEST_PASSWORD)
        expect(swKey).toEqual(referenceDerivation(privKeyHex, podName))
      }
    })
  })

  describe('WalletManager and SecureWallet produce identical keys', () => {
    it('agree on the same pod key', async () => {
      const wm = new WalletManager()
      await wm.import(TEST_MNEMONIC)
      const sw = await SecureWallet.fromMnemonic(TEST_MNEMONIC, TEST_PASSWORD)

      for (const pod of ['Home', 'Work', 'Photos']) {
        const wmKey = await wm.deriveKey(pod)
        const swKey = await sw.derivePodKey(pod, TEST_PASSWORD)
        expect(wmKey).toEqual(swKey)
      }
    })
  })
})
