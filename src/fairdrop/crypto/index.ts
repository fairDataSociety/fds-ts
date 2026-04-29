/**
 * Crypto module exports
 *
 * Import specific implementations from:
 * - @fairdrop/core/crypto/browser
 * - @fairdrop/core/crypto/node
 */

export { BrowserCryptoProvider } from './browser.js'
export { NodeCryptoProvider } from './node.js'

// Encryption functions (isomorphic)
export {
  generateKeyPair,
  deriveSharedSecret,
  encryptData,
  decryptData,
  encryptFile,
  decryptFile,
  serializeEncryptedFile,
  deserializeEncryptedFile,
} from './encryption.js'

// Encryption types
export type {
  KeyPair,
  EncryptedData,
  EncryptedFile,
  FileMetadata,
  DecryptedFile,
} from './encryption.js'

// Escrow crypto functions
export {
  createKeyCommitment,
  verifyKeyCommitment,
  encryptKeyForBuyer,
  decryptKeyAsBuyer,
  serializeEncryptedKey,
  deserializeEncryptedKey,
  createEncryptedKeyCommitment,
  verifyEncryptedKeyCommitment,
  generateEncryptionKey,
  deriveEncryptionKey,
  deriveEncryptionIV,
  // Encrypted Swarm reference (privacy layer)
  encryptSwarmRef,
  decryptSwarmRef,
  serializeEncryptedSwarmRef,
  deserializeEncryptedSwarmRef,
} from './escrow.js'

// Escrow crypto types
export type {
  EscrowKeyCommitment,
  BuyerEncryptedKey,
  SerializedEncryptedKey,
  EncryptedSwarmRef,
} from './escrow.js'
