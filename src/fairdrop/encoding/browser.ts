/**
 * Browser EncodingProvider Implementation
 *
 * Uses btoa/atob for base64 and manual conversion for hex.
 */

import type { EncodingProvider } from '../adapters/types.js'

/**
 * Browser-based encoding provider
 */
export class BrowserEncodingProvider implements EncodingProvider {
  /**
   * Encode bytes to base64 string
   */
  base64Encode(data: Uint8Array): string {
    // Convert Uint8Array to binary string, then to base64
    const binaryString = Array.from(data)
      .map((byte) => String.fromCharCode(byte))
      .join('')
    return btoa(binaryString)
  }

  /**
   * Decode base64 string to bytes
   */
  base64Decode(str: string): Uint8Array {
    const binaryString = atob(str)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes
  }

  /**
   * Encode bytes to hex string
   */
  bytesToHex(data: Uint8Array): string {
    return Array.from(data)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Decode hex string to bytes
   */
  hexToBytes(hex: string): Uint8Array {
    // Remove 0x prefix if present
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
    const bytes = new Uint8Array(cleanHex.length / 2)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16)
    }
    return bytes
  }
}
