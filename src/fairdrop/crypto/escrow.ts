/**
 * Escrow Encryption Layer
 *
 * Provides cryptographic functions for the DataEscrow system:
 * - Key commitment (salted hash for on-chain verification)
 * - Buyer-specific key encryption (ECDH + AES-GCM)
 *
 * The plaintext key NEVER appears on-chain - only encrypted versions.
 */

import * as secp256k1 from '@noble/secp256k1'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'
import { keccak256, hexToBytes } from 'viem'
import type { CryptoProvider } from '../adapters/types.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Key commitment for on-chain verification
 * commitment = keccak256(key || salt)
 */
export interface EscrowKeyCommitment {
  /** The commitment hash to store on-chain */
  commitment: Uint8Array
  /** Random salt (keep secret until reveal) */
  salt: Uint8Array
}

/**
 * Encrypted key for buyer
 * Uses ECDH key agreement + AES-GCM encryption
 */
export interface BuyerEncryptedKey {
  /** Encrypted key ciphertext */
  encryptedKey: Uint8Array
  /** IV for AES-GCM */
  iv: Uint8Array
  /** Ephemeral public key for ECDH */
  ephemeralPubkey: Uint8Array
}

/**
 * Serialized encrypted key (for on-chain storage)
 * Format: [33 bytes ephemeral pubkey][12 bytes iv][ciphertext]
 */
export type SerializedEncryptedKey = Uint8Array

// ============================================================================
// Key Commitment Functions
// ============================================================================

/**
 * Create a key commitment for on-chain storage
 *
 * The commitment is: keccak256(key || salt)
 * This prevents rainbow table attacks on the key.
 *
 * @param crypto - CryptoProvider for hashing
 * @param key - The 32-byte encryption key
 * @returns Commitment and salt (keep salt secret until reveal)
 */
export async function createKeyCommitment(
  crypto: CryptoProvider,
  key: Uint8Array
): Promise<EscrowKeyCommitment> {
  if (key.length !== 32) {
    throw new Error('Key must be exactly 32 bytes')
  }

  // Generate random salt
  const salt = crypto.randomBytes(32)

  // Create commitment: keccak256(key || salt)
  const combined = new Uint8Array(key.length + salt.length)
  combined.set(key, 0)
  combined.set(salt, key.length)

  // Use keccak256 (same as Solidity) for on-chain verification
  const commitmentHex = keccak256(combined)
  const commitment = hexToBytes(commitmentHex)

  return { commitment, salt }
}

/**
 * Verify a key against its commitment
 *
 * @param crypto - CryptoProvider for hashing
 * @param key - The claimed key
 * @param salt - The salt used in commitment
 * @param commitment - The expected commitment
 * @returns true if key is valid
 */
export async function verifyKeyCommitment(
  _crypto: CryptoProvider,
  key: Uint8Array,
  salt: Uint8Array,
  commitment: Uint8Array
): Promise<boolean> {
  if (key.length !== 32) {
    return false
  }

  // Recreate commitment
  const combined = new Uint8Array(key.length + salt.length)
  combined.set(key, 0)
  combined.set(salt, key.length)

  const expectedCommitmentHex = keccak256(combined)
  const expectedCommitment = hexToBytes(expectedCommitmentHex)

  // Compare commitments
  if (expectedCommitment.length !== commitment.length) {
    return false
  }
  for (let i = 0; i < expectedCommitment.length; i++) {
    if (expectedCommitment[i] !== commitment[i]) {
      return false
    }
  }
  return true
}

// ============================================================================
// Buyer Key Encryption Functions
// ============================================================================

/**
 * Encrypt a key for a specific buyer using ECDH + AES-GCM
 *
 * Uses ephemeral keypair for forward secrecy.
 * Only the buyer with the corresponding private key can decrypt.
 *
 * @param crypto - CryptoProvider for encryption
 * @param key - The 32-byte encryption key to encrypt
 * @param buyerPubkey - Buyer's secp256k1 public key (33 or 65 bytes)
 * @returns Encrypted key package
 */
export async function encryptKeyForBuyer(
  crypto: CryptoProvider,
  key: Uint8Array,
  buyerPubkey: Uint8Array
): Promise<BuyerEncryptedKey> {
  if (key.length !== 32) {
    throw new Error('Key must be exactly 32 bytes')
  }

  // Generate ephemeral keypair for this encryption
  const ephemeralPrivate = secp256k1.utils.randomSecretKey()
  const ephemeralPubkey = secp256k1.getPublicKey(ephemeralPrivate)

  // Derive shared secret via ECDH
  const sharedPoint = secp256k1.getSharedSecret(ephemeralPrivate, buyerPubkey)
  // Hash the shared point (excluding prefix byte) to get AES key
  const aesKey = await crypto.sha256(sharedPoint.slice(1))

  // Encrypt the key with AES-GCM
  const iv = crypto.randomBytes(12)
  const encryptedKey = await crypto.aesGcmEncrypt(key, aesKey, iv)

  return {
    encryptedKey,
    iv,
    ephemeralPubkey,
  }
}

/**
 * Decrypt a key as the buyer using ECDH + AES-GCM
 *
 * @param crypto - CryptoProvider for decryption
 * @param encrypted - The encrypted key package
 * @param buyerPrivkey - Buyer's secp256k1 private key
 * @returns The decrypted 32-byte key
 */
export async function decryptKeyAsBuyer(
  crypto: CryptoProvider,
  encrypted: BuyerEncryptedKey,
  buyerPrivkey: Uint8Array
): Promise<Uint8Array> {
  const { encryptedKey, iv, ephemeralPubkey } = encrypted

  // Derive shared secret via ECDH
  const sharedPoint = secp256k1.getSharedSecret(buyerPrivkey, ephemeralPubkey)
  // Hash the shared point (excluding prefix byte) to get AES key
  const aesKey = await crypto.sha256(sharedPoint.slice(1))

  // Decrypt the key with AES-GCM
  const key = await crypto.aesGcmDecrypt(encryptedKey, aesKey, iv)

  if (key.length !== 32) {
    throw new Error('Decrypted key is not 32 bytes')
  }

  return key
}

// ============================================================================
// Serialization Functions
// ============================================================================

/**
 * Serialize encrypted key for on-chain storage
 * Format: [33 bytes ephemeral pubkey][12 bytes iv][ciphertext]
 */
export function serializeEncryptedKey(encrypted: BuyerEncryptedKey): SerializedEncryptedKey {
  const { ephemeralPubkey, iv, encryptedKey } = encrypted
  const result = new Uint8Array(ephemeralPubkey.length + iv.length + encryptedKey.length)

  result.set(ephemeralPubkey, 0)
  result.set(iv, ephemeralPubkey.length)
  result.set(encryptedKey, ephemeralPubkey.length + iv.length)

  return result
}

/**
 * Deserialize encrypted key from on-chain storage
 * Format: [33 bytes ephemeral pubkey][12 bytes iv][ciphertext]
 */
export function deserializeEncryptedKey(data: SerializedEncryptedKey): BuyerEncryptedKey {
  if (data.length < 33 + 12 + 32) {
    throw new Error('Invalid encrypted key: too short')
  }

  const ephemeralPubkey = data.slice(0, 33)
  const iv = data.slice(33, 33 + 12)
  const encryptedKey = data.slice(33 + 12)

  return { ephemeralPubkey, iv, encryptedKey }
}

// ============================================================================
// Encrypted Key Commitment Functions
// ============================================================================

/**
 * Create commitment for encrypted key (for mempool-safe reveal)
 *
 * The seller commits to: keccak256(serializedEncryptedKey || salt)
 * Then reveals the encrypted key (never the plaintext key).
 *
 * @param crypto - CryptoProvider for hashing
 * @param serializedEncryptedKey - The serialized encrypted key
 * @returns Commitment and salt
 */
export async function createEncryptedKeyCommitment(
  crypto: CryptoProvider,
  serializedEncryptedKey: SerializedEncryptedKey
): Promise<EscrowKeyCommitment> {
  const salt = crypto.randomBytes(32)

  const combined = new Uint8Array(serializedEncryptedKey.length + salt.length)
  combined.set(serializedEncryptedKey, 0)
  combined.set(salt, serializedEncryptedKey.length)

  const commitmentHex = keccak256(combined)
  const commitment = hexToBytes(commitmentHex)

  return { commitment, salt }
}

/**
 * Verify encrypted key against commitment
 */
export async function verifyEncryptedKeyCommitment(
  _crypto: CryptoProvider,
  serializedEncryptedKey: SerializedEncryptedKey,
  salt: Uint8Array,
  commitment: Uint8Array
): Promise<boolean> {
  const combined = new Uint8Array(serializedEncryptedKey.length + salt.length)
  combined.set(serializedEncryptedKey, 0)
  combined.set(salt, serializedEncryptedKey.length)

  const expectedCommitmentHex = keccak256(combined)
  const expectedCommitment = hexToBytes(expectedCommitmentHex)

  if (expectedCommitment.length !== commitment.length) {
    return false
  }
  for (let i = 0; i < expectedCommitment.length; i++) {
    if (expectedCommitment[i] !== commitment[i]) {
      return false
    }
  }
  return true
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a random 32-byte encryption key
 */
export function generateEncryptionKey(crypto: CryptoProvider): Uint8Array {
  return crypto.randomBytes(32)
}

// ============================================================================
// Deterministic Key Derivation (Multi-Copy Escrow)
// ============================================================================

/**
 * Derive a deterministic encryption key from seller's private key and plaintext hash.
 *
 * Uses HKDF-SHA256 so the same content always produces the same key,
 * meaning the same ciphertext and Swarm reference — single upload for N escrows.
 *
 * @param privateKey - Seller's secp256k1 private key (32 bytes)
 * @param plaintextHash - Hash of the plaintext content (32 bytes, e.g. keccak256)
 * @returns 32-byte deterministic AES-256 key
 */
export function deriveEncryptionKey(privateKey: Uint8Array, plaintextHash: Uint8Array): Uint8Array {
  if (privateKey.length !== 32) {
    throw new Error('Private key must be exactly 32 bytes')
  }
  if (plaintextHash.length !== 32) {
    throw new Error('Plaintext hash must be exactly 32 bytes')
  }

  const enc = new TextEncoder()

  // Step 1: Derive a derivation key from seller's private key
  const derivationKey = hkdf(nobleSha256, privateKey, undefined, enc.encode('fairdrop-content-encryption'), 32)

  // Step 2: Derive the encryption key from derivation key + plaintext hash
  return hkdf(nobleSha256, derivationKey, plaintextHash, enc.encode('content-key'), 32)
}

/**
 * Derive a deterministic IV from seller's private key and plaintext hash.
 *
 * @param privateKey - Seller's secp256k1 private key (32 bytes)
 * @param plaintextHash - Hash of the plaintext content (32 bytes)
 * @returns 12-byte deterministic IV for AES-GCM
 */
export function deriveEncryptionIV(privateKey: Uint8Array, plaintextHash: Uint8Array): Uint8Array {
  if (privateKey.length !== 32) {
    throw new Error('Private key must be exactly 32 bytes')
  }
  if (plaintextHash.length !== 32) {
    throw new Error('Plaintext hash must be exactly 32 bytes')
  }

  const enc = new TextEncoder()
  const derivationKey = hkdf(nobleSha256, privateKey, undefined, enc.encode('fairdrop-content-encryption'), 32)
  return hkdf(nobleSha256, derivationKey, plaintextHash, enc.encode('content-iv'), 12)
}

// ============================================================================
// Encrypted Swarm Reference Functions
// ============================================================================

/**
 * Encrypted Swarm reference for privacy-preserving links
 * The actual Swarm location is hidden from anyone without the recipient's private key
 */
export interface EncryptedSwarmRef {
  /** Encrypted reference ciphertext */
  encryptedRef: Uint8Array
  /** IV for AES-GCM */
  iv: Uint8Array
  /** Ephemeral public key for ECDH */
  ephemeralPubkey: Uint8Array
}

/**
 * Encrypt a Swarm reference for a specific recipient
 *
 * This adds a privacy layer: even if someone intercepts the link,
 * they cannot locate the content on Swarm without the recipient's private key.
 *
 * @param crypto - CryptoProvider for encryption
 * @param swarmRef - The Swarm reference (32 bytes or 64-char hex string)
 * @param recipientPubkey - Recipient's secp256k1 public key (33 or 65 bytes)
 * @returns Encrypted Swarm reference package
 */
export async function encryptSwarmRef(
  crypto: CryptoProvider,
  swarmRef: Uint8Array | string,
  recipientPubkey: Uint8Array
): Promise<EncryptedSwarmRef> {
  // Convert hex string to bytes if needed
  const refBytes = typeof swarmRef === 'string'
    ? hexToBytes(swarmRef.startsWith('0x') ? swarmRef as `0x${string}` : `0x${swarmRef}`)
    : swarmRef

  if (refBytes.length !== 32) {
    throw new Error('Swarm reference must be exactly 32 bytes')
  }

  // Generate ephemeral keypair for this encryption
  const ephemeralPrivate = secp256k1.utils.randomSecretKey()
  const ephemeralPubkey = secp256k1.getPublicKey(ephemeralPrivate)

  // Derive shared secret via ECDH
  const sharedPoint = secp256k1.getSharedSecret(ephemeralPrivate, recipientPubkey)
  const aesKey = await crypto.sha256(sharedPoint.slice(1))

  // Encrypt the reference with AES-GCM
  const iv = crypto.randomBytes(12)
  const encryptedRef = await crypto.aesGcmEncrypt(refBytes, aesKey, iv)

  return {
    encryptedRef,
    iv,
    ephemeralPubkey,
  }
}

/**
 * Decrypt a Swarm reference with recipient's private key
 *
 * @param crypto - CryptoProvider for decryption
 * @param encrypted - The encrypted Swarm reference package
 * @param recipientPrivkey - Recipient's secp256k1 private key
 * @returns The decrypted Swarm reference as hex string (without 0x prefix)
 */
export async function decryptSwarmRef(
  crypto: CryptoProvider,
  encrypted: EncryptedSwarmRef,
  recipientPrivkey: Uint8Array
): Promise<string> {
  const { encryptedRef, iv, ephemeralPubkey } = encrypted

  // Derive shared secret via ECDH
  const sharedPoint = secp256k1.getSharedSecret(recipientPrivkey, ephemeralPubkey)
  const aesKey = await crypto.sha256(sharedPoint.slice(1))

  // Decrypt the reference with AES-GCM
  const refBytes = await crypto.aesGcmDecrypt(encryptedRef, aesKey, iv)

  if (refBytes.length !== 32) {
    throw new Error('Decrypted reference is not 32 bytes')
  }

  // Return as hex string (Swarm reference format)
  return bytesToHex(refBytes)
}

/**
 * Serialize encrypted Swarm ref for URL transport
 * Format: [33 bytes ephemeral pubkey][12 bytes iv][ciphertext]
 * Returns base64url-encoded string for shorter URLs
 */
export function serializeEncryptedSwarmRef(encrypted: EncryptedSwarmRef): string {
  const { ephemeralPubkey, iv, encryptedRef } = encrypted
  const combined = new Uint8Array(ephemeralPubkey.length + iv.length + encryptedRef.length)

  combined.set(ephemeralPubkey, 0)
  combined.set(iv, ephemeralPubkey.length)
  combined.set(encryptedRef, ephemeralPubkey.length + iv.length)

  // Use base64url encoding for URL-safe transport
  return base64urlEncode(combined)
}

/**
 * Deserialize encrypted Swarm ref from URL
 * Expects base64url-encoded string
 */
export function deserializeEncryptedSwarmRef(encoded: string): EncryptedSwarmRef {
  const data = base64urlDecode(encoded)

  // Minimum size: 33 (pubkey) + 12 (iv) + 32 (encrypted ref) + 16 (auth tag) = 93 bytes
  if (data.length < 93) {
    throw new Error('Invalid encrypted Swarm ref: too short')
  }

  const ephemeralPubkey = data.slice(0, 33)
  const iv = data.slice(33, 33 + 12)
  const encryptedRef = data.slice(33 + 12)

  return { ephemeralPubkey, iv, encryptedRef }
}

// ============================================================================
// Base64url Encoding (URL-safe base64)
// ============================================================================

/**
 * Encode bytes to base64url (URL-safe, no padding)
 */
function base64urlEncode(data: Uint8Array): string {
  // Convert to regular base64
  let base64 = ''
  const bytes = new Uint8Array(data)
  const len = bytes.length

  for (let i = 0; i < len; i += 3) {
    const a = bytes[i]
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0

    const triplet = (a << 16) | (b << 8) | c

    base64 += BASE64_CHARS[(triplet >> 18) & 0x3f]
    base64 += BASE64_CHARS[(triplet >> 12) & 0x3f]
    base64 += i + 1 < len ? BASE64_CHARS[(triplet >> 6) & 0x3f] : ''
    base64 += i + 2 < len ? BASE64_CHARS[triplet & 0x3f] : ''
  }

  // Convert to base64url (replace + with -, / with _, remove padding)
  return base64.replace(/\+/g, '-').replace(/\//g, '_')
}

/**
 * Decode base64url to bytes
 */
function base64urlDecode(str: string): Uint8Array {
  // Convert from base64url to regular base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')

  // Add padding if needed
  while (base64.length % 4 !== 0) {
    base64 += '='
  }

  // Decode
  const binaryStr = atob(base64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }
  return bytes
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Convert bytes to hex string (without 0x prefix)
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
