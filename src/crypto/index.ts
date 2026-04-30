/**
 * @fairdatasociety/fds/crypto — low-level crypto primitives.
 *
 * Used by Fairdrop, Fairdrive, and any consumer that needs direct
 * access to crypto building blocks beyond the high-level FdsClient.
 */

// SDK-native primitives (ECDH for send/receive, AES-GCM, key derivation)
export { encryptForRecipient, decryptFromSender, generateEphemeralKeyPair } from './ecdh.js'
export type { KeyPair as EcdhKeyPair } from './ecdh.js'
export { encrypt, decrypt } from './encryption.js'
export { derivePodKey, deriveFileKey, validatePodName } from './keys.js'

// Re-exports from fairdrop port (BrowserCryptoProvider, NodeCryptoProvider, etc.)
export {
  BrowserCryptoProvider,
  NodeCryptoProvider,
  generateKeyPair,
  deriveSharedSecret,
  encryptData,
  decryptData,
  encryptFile,
  decryptFile,
  serializeEncryptedFile,
  deserializeEncryptedFile,
  // Escrow crypto
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
} from '../fairdrop/crypto/index.js'

export type {
  KeyPair,
  EncryptedData,
  EncryptedFile,
  FileMetadata,
  DecryptedFile,
  EscrowKeyCommitment,
  BuyerEncryptedKey,
  SerializedEncryptedKey,
  EncryptedSwarmRef,
} from '../fairdrop/crypto/index.js'

// Web3 keystore crypto primitives (ported from fairdrop/packages/fds-crypto)
// AES-128-CTR, scrypt KDF, keccak256 — for Web3 Secret Storage v3 keystores.
export {
  aesCtrEncrypt,
  aesCtrDecrypt,
  deriveKeyWithParams,
  keccak256,
  constantTimeEqual,
  randomBytes,
  ETHEREUM_SCRYPT_PARAMS,
} from './web3/index.js'
