/**
 * FDS Wallet Implementation
 *
 * Provides Ethereum wallet functionality:
 * - Create wallet from private key
 * - Sign messages and typed data
 * - Get address and public key
 *
 * This is a lightweight wrapper around secp256k1 operations.
 */

import * as secp256k1 from '@noble/secp256k1'
import { keccak256 } from '../crypto/web3/index.js'

/**
 * Represents an Ethereum wallet
 */
export class Wallet {
  private readonly _privateKey: Uint8Array
  private readonly _publicKey: Uint8Array
  private readonly _address: string

  /**
   * Create wallet from private key bytes
   * Use static factory methods instead of constructor directly
   */
  private constructor(privateKey: Uint8Array) {
    if (privateKey.length !== 32) {
      throw new Error('Private key must be 32 bytes')
    }

    this._privateKey = privateKey
    this._publicKey = secp256k1.getPublicKey(privateKey, false) // Uncompressed
    this._address = this._computeAddress()
  }

  /**
   * Generate a new random wallet
   */
  static generate(): Wallet {
    const privateKey = secp256k1.etc.randomBytes(32)
    return new Wallet(privateKey)
  }

  /**
   * Create wallet from private key hex string
   *
   * @param privateKeyHex - Private key as hex string (with or without 0x prefix)
   */
  static fromPrivateKey(privateKeyHex: string): Wallet {
    const hex = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex

    if (hex.length !== 64) {
      throw new Error('Invalid private key length')
    }

    const privateKey = hexToBytes(hex)
    return new Wallet(privateKey)
  }

  /**
   * Create wallet from private key bytes
   */
  static fromPrivateKeyBytes(privateKey: Uint8Array): Wallet {
    return new Wallet(privateKey)
  }

  /**
   * Get wallet address (checksummed)
   */
  get address(): string {
    return this._address
  }

  /**
   * Get wallet address (lowercase, no checksum)
   */
  get addressLower(): string {
    return '0x' + this._address.slice(2).toLowerCase()
  }

  /**
   * Get private key as hex string (without 0x prefix)
   */
  get privateKeyHex(): string {
    return bytesToHex(this._privateKey)
  }

  /**
   * Get private key as bytes
   * WARNING: Handle with care - do not log or expose
   */
  get privateKey(): Uint8Array {
    return new Uint8Array(this._privateKey)
  }

  /**
   * Get public key as bytes (uncompressed, 65 bytes)
   */
  get publicKey(): Uint8Array {
    return new Uint8Array(this._publicKey)
  }

  /**
   * Get public key as hex string (without 0x prefix)
   */
  get publicKeyHex(): string {
    return bytesToHex(this._publicKey)
  }

  /**
   * Get compressed public key (33 bytes)
   */
  get compressedPublicKey(): Uint8Array {
    return secp256k1.getPublicKey(this._privateKey, true)
  }

  /**
   * Sign a 32-byte message hash
   *
   * @param hash - 32-byte message hash
   * @returns 65-byte signature (r || s || v)
   */
  async sign(hash: Uint8Array): Promise<Uint8Array> {
    if (hash.length !== 32) {
      throw new Error('Hash must be 32 bytes')
    }

    // Sign with recovered format (65 bytes: r[32] || s[32] || recovery[1])
    const signature = await secp256k1.signAsync(hash, this._privateKey, {
      prehash: false, // hash is already computed
      format: 'recovered',
    })

    // Convert recovery byte from 0/1 to 27/28 (Ethereum format)
    const result = new Uint8Array(65)
    result.set(signature.slice(0, 64), 0)
    result[64] = signature[64] + 27

    return result
  }

  /**
   * Sign a message with Ethereum prefix
   * "\x19Ethereum Signed Message:\n" + length + message
   *
   * @param message - Message to sign (string or bytes)
   * @returns 65-byte signature
   */
  async signMessage(message: string | Uint8Array): Promise<Uint8Array> {
    const messageBytes = typeof message === 'string'
      ? new TextEncoder().encode(message)
      : message

    const prefix = `\x19Ethereum Signed Message:\n${messageBytes.length}`
    const prefixBytes = new TextEncoder().encode(prefix)

    const combined = new Uint8Array(prefixBytes.length + messageBytes.length)
    combined.set(prefixBytes, 0)
    combined.set(messageBytes, prefixBytes.length)

    const hash = keccak256(combined)
    return this.sign(hash)
  }

  /**
   * Verify a signature against a message hash
   *
   * @param hash - 32-byte message hash
   * @param signature - 65-byte signature (r || s || v)
   * @returns true if signature is valid
   */
  verify(hash: Uint8Array, signature: Uint8Array): boolean {
    if (hash.length !== 32 || signature.length !== 65) {
      return false
    }

    try {
      // Extract compact signature (r || s)
      const compactSig = signature.slice(0, 64)
      return secp256k1.verify(compactSig, hash, this._publicKey, { prehash: false })
    } catch {
      return false
    }
  }

  /**
   * Compute Ethereum address from public key
   */
  private _computeAddress(): string {
    // Take last 64 bytes of uncompressed public key (skip 0x04 prefix)
    const pubKeyNoPrefix = this._publicKey.slice(1)
    const hash = keccak256(pubKeyNoPrefix)
    // Take last 20 bytes
    const addressBytes = hash.slice(-20)
    const addressHex = bytesToHex(addressBytes)

    // Apply EIP-55 checksum
    return toChecksumAddress('0x' + addressHex)
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert hex string to bytes
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Convert bytes to hex string (lowercase, no prefix)
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Apply EIP-55 checksum to address
 */
function toChecksumAddress(address: string): string {
  const addressLower = address.toLowerCase().replace('0x', '')
  const hash = bytesToHex(keccak256(new TextEncoder().encode(addressLower)))

  let checksumAddress = '0x'
  for (let i = 0; i < addressLower.length; i++) {
    if (parseInt(hash[i], 16) >= 8) {
      checksumAddress += addressLower[i].toUpperCase()
    } else {
      checksumAddress += addressLower[i]
    }
  }

  return checksumAddress
}

/**
 * Recover address from signature and message hash
 */
export function recoverAddress(hash: Uint8Array, signature: Uint8Array): string {
  if (hash.length !== 32 || signature.length !== 65) {
    throw new Error('Invalid hash or signature length')
  }

  // Convert v from 27/28 to 0/1 for recovery
  const v = signature[64]
  const recovery = v >= 27 ? v - 27 : v

  // Create signature with recovery byte at end (noble format)
  const recoveredSig = new Uint8Array(65)
  recoveredSig.set(signature.slice(0, 64), 0)
  recoveredSig[64] = recovery

  // Recover public key
  const publicKey = secp256k1.recoverPublicKey(recoveredSig, hash, { prehash: false })

  // Compute address from recovered public key
  const pubKeyNoPrefix = publicKey.slice(1)
  const addressHash = keccak256(pubKeyNoPrefix)
  const addressBytes = addressHash.slice(-20)
  const addressHex = bytesToHex(addressBytes)

  return toChecksumAddress('0x' + addressHex)
}

/**
 * Check if address is valid Ethereum address
 */
export function isValidAddress(address: string): boolean {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return false
  }
  return true
}
