/**
 * @fds/crypto - FDS Shared Cryptographic Primitives
 *
 * This library provides standardized encryption for all FDS applications.
 * All apps using these primitives can interoperate:
 * - Keystores can be exchanged between apps
 * - Files encrypted in one app can be decrypted in another
 *
 * Standards:
 * - File encryption: AES-256-GCM (NIST SP 800-38D)
 * - Keystore encryption: AES-128-CTR (Ethereum Web3 Secret Storage v3)
 * - Key derivation: scrypt (RFC 7914)
 * - Hashing: Keccak-256 (for Ethereum MAC), SHA-256 (general)
 */

export {
  // Core encryption functions
  encrypt,
  decrypt,
  encryptWithPassword,
  decryptWithPassword,
  // AES-CTR for Ethereum keystore compatibility
  aesCtrEncrypt,
  aesCtrDecrypt,
  // Key derivation
  deriveKey,
  deriveKeyWithParams,
  // Hashing
  keccak256,
  sha256,
  // Security utilities
  constantTimeEqual,
  randomBytes,
  // Types
  type ScryptParams,
  type EncryptedData,
  // Constants
  DEFAULT_SCRYPT_PARAMS,
  ETHEREUM_SCRYPT_PARAMS,
} from './crypto.js'

// Re-export browser-specific implementation
export { BrowserCrypto } from './browser.js'
