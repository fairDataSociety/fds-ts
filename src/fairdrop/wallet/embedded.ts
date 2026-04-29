/**
 * Embedded WalletProvider Implementation
 *
 * Uses viem for wallet operations from a private key.
 * Works in both browser and Node.js.
 */

import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import type { WalletProvider, TypedData } from '../adapters/types.js'

/**
 * Embedded wallet provider using a private key
 */
export class EmbeddedWalletProvider implements WalletProvider {
  private readonly account: PrivateKeyAccount
  private readonly _privateKey: Uint8Array
  private readonly _publicKey: Uint8Array

  /**
   * Create wallet from private key
   * @param privateKey - 32-byte private key
   */
  constructor(privateKey: Uint8Array) {
    if (privateKey.length !== 32) {
      throw new Error('Private key must be 32 bytes')
    }

    this._privateKey = privateKey
    // Use bytesToHex from @noble/hashes (isomorphic)
    this.account = privateKeyToAccount(`0x${bytesToHex(privateKey)}`)

    // Extract public key (uncompressed, 65 bytes with 04 prefix)
    // viem's publicKey is a hex string with 0x prefix
    this._publicKey = hexToBytes(this.account.publicKey.slice(2))
  }

  /**
   * Create wallet from hex private key string
   */
  static fromHex(hexKey: string): EmbeddedWalletProvider {
    const cleanHex = hexKey.startsWith('0x') ? hexKey.slice(2) : hexKey
    return new EmbeddedWalletProvider(hexToBytes(cleanHex))
  }

  async getAddress(): Promise<string> {
    return this.account.address
  }

  getPublicKey(): Uint8Array {
    return this._publicKey
  }

  async signMessage(message: string): Promise<string> {
    return this.account.signMessage({ message })
  }

  async signTypedData(typedData: TypedData): Promise<string> {
    return this.account.signTypedData({
      domain: typedData.domain,
      types: typedData.types as Record<string, readonly { name: string; type: string }[]>,
      primaryType: typedData.primaryType,
      message: typedData.message,
    })
  }

  getPrivateKey(): Uint8Array {
    return this._privateKey
  }
}

/**
 * Generate a new random wallet
 */
export function generateWallet(): EmbeddedWalletProvider {
  // Use crypto.getRandomValues for secure random
  const privateKey = new Uint8Array(32)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(privateKey)
  } else {
    // Node.js fallback
    const { randomBytes } = require('crypto')
    const buf = randomBytes(32)
    privateKey.set(new Uint8Array(buf))
  }
  return new EmbeddedWalletProvider(privateKey)
}
