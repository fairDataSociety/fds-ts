/**
 * Node.js EncodingProvider Implementation
 *
 * Uses Buffer for base64 and @noble/hashes for hex.
 */

import { bytesToHex as nobleBytesToHex, hexToBytes as nobleHexToBytes } from '@noble/hashes/utils.js'
import type { EncodingProvider } from '../adapters/types.js'

/**
 * Node.js encoding provider
 */
export class NodeEncodingProvider implements EncodingProvider {
  /**
   * Encode bytes to base64 string
   */
  base64Encode(data: Uint8Array): string {
    return Buffer.from(data).toString('base64')
  }

  /**
   * Decode base64 string to bytes
   */
  base64Decode(str: string): Uint8Array {
    return new Uint8Array(Buffer.from(str, 'base64'))
  }

  /**
   * Encode bytes to hex string (without 0x prefix)
   */
  bytesToHex(data: Uint8Array): string {
    return nobleBytesToHex(data)
  }

  /**
   * Decode hex string to bytes
   */
  hexToBytes(hex: string): Uint8Array {
    // Remove 0x prefix if present
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
    return nobleHexToBytes(cleanHex)
  }
}
