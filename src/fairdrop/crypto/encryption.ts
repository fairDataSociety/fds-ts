/**
 * Isomorphic Encryption Layer
 *
 * Uses secp256k1 ECDH for key agreement and AES-GCM for encryption.
 * Works in both Node.js and browser environments via CryptoProvider.
 */

import * as secp256k1 from '@noble/secp256k1'
import type { CryptoProvider } from '../adapters/types.js'

// Type definitions
export interface KeyPair {
  privateKey: Uint8Array
  publicKey: Uint8Array
}

export interface EncryptedData {
  ciphertext: Uint8Array
  iv: Uint8Array
}

export interface EncryptedFile extends EncryptedData {
  ephemeralPublicKey: Uint8Array
}

export interface FileMetadata {
  name: string
  type: string
  size: number
  timestamp: number
}

export interface DecryptedFile {
  data: Uint8Array
  metadata: FileMetadata
}

/**
 * Generate a new keypair for encryption
 */
export function generateKeyPair(): KeyPair {
  const privateKey = secp256k1.utils.randomSecretKey()
  const publicKey = secp256k1.getPublicKey(privateKey)
  return { privateKey, publicKey }
}

/**
 * Derive a shared secret using ECDH
 * Uses CryptoProvider for SHA-256 hashing
 */
export async function deriveSharedSecret(
  crypto: CryptoProvider,
  privateKey: Uint8Array,
  publicKey: Uint8Array
): Promise<Uint8Array> {
  const sharedPoint = secp256k1.getSharedSecret(privateKey, publicKey)
  // Hash the shared point (excluding the prefix byte) to get a symmetric key
  return crypto.sha256(sharedPoint.slice(1))
}

/**
 * Encrypt data using AES-GCM with a shared secret
 * Uses CryptoProvider for IV generation and encryption
 */
export async function encryptData(
  crypto: CryptoProvider,
  data: Uint8Array,
  sharedSecret: Uint8Array
): Promise<EncryptedData> {
  const iv = crypto.randomBytes(12)
  const ciphertext = await crypto.aesGcmEncrypt(data, sharedSecret, iv)

  return {
    ciphertext,
    iv,
  }
}

/**
 * Decrypt data using AES-GCM with a shared secret
 * Uses CryptoProvider for decryption
 */
export async function decryptData(
  crypto: CryptoProvider,
  ciphertext: Uint8Array,
  iv: Uint8Array,
  sharedSecret: Uint8Array
): Promise<Uint8Array> {
  return crypto.aesGcmDecrypt(ciphertext, sharedSecret, iv)
}

/**
 * Encrypt file data for a recipient
 *
 * @param crypto - CryptoProvider instance
 * @param fileData - Raw file data as Uint8Array
 * @param metadata - File metadata (name, type, size)
 * @param recipientPublicKey - Recipient's public key
 * @returns Encrypted file with ephemeral public key
 */
export async function encryptFile(
  crypto: CryptoProvider,
  fileData: Uint8Array,
  metadata: Omit<FileMetadata, 'timestamp'>,
  recipientPublicKey: Uint8Array
): Promise<EncryptedFile> {
  // Generate ephemeral keypair for this message
  const ephemeral = generateKeyPair()

  // Derive shared secret
  const sharedSecret = await deriveSharedSecret(crypto, ephemeral.privateKey, recipientPublicKey)

  // Create full metadata with timestamp
  const fullMetadata: FileMetadata = {
    ...metadata,
    timestamp: Date.now(),
  }
  const metadataBytes = new TextEncoder().encode(JSON.stringify(fullMetadata))

  // Combine metadata length + metadata + file data
  const metadataLength = new Uint32Array([metadataBytes.length])
  const combined = new Uint8Array(4 + metadataBytes.length + fileData.length)
  combined.set(new Uint8Array(metadataLength.buffer), 0)
  combined.set(metadataBytes, 4)
  combined.set(fileData, 4 + metadataBytes.length)

  // Encrypt combined data
  const { ciphertext, iv } = await encryptData(crypto, combined, sharedSecret)

  return {
    ephemeralPublicKey: ephemeral.publicKey,
    ciphertext,
    iv,
  }
}

/**
 * Decrypt file data with your private key
 *
 * @param crypto - CryptoProvider instance
 * @param encryptedFile - Encrypted file data
 * @param privateKey - Recipient's private key
 * @returns Decrypted file data and metadata
 */
export async function decryptFile(
  crypto: CryptoProvider,
  encryptedFile: EncryptedFile,
  privateKey: Uint8Array
): Promise<DecryptedFile> {
  const { ephemeralPublicKey, ciphertext, iv } = encryptedFile

  // Derive shared secret
  const sharedSecret = await deriveSharedSecret(crypto, privateKey, ephemeralPublicKey)

  // Decrypt
  const decrypted = await decryptData(crypto, ciphertext, iv, sharedSecret)

  // Parse metadata length
  const metadataLengthView = new DataView(decrypted.buffer, decrypted.byteOffset, 4)
  const metadataLength = metadataLengthView.getUint32(0, true) // little-endian

  if (metadataLength > decrypted.length - 4) {
    throw new Error('Invalid encrypted data format: metadata length exceeds data size')
  }

  // Parse metadata
  const metadataBytes = decrypted.slice(4, 4 + metadataLength)
  const metadata = JSON.parse(new TextDecoder().decode(metadataBytes)) as FileMetadata

  // Extract file data
  const data = decrypted.slice(4 + metadataLength)

  return { data, metadata }
}

/**
 * Serialize encrypted file for storage/transmission
 * Format: [33 bytes pubkey][12 bytes iv][ciphertext]
 *
 * This format is compatible with the Fairdrop web app.
 */
export function serializeEncryptedFile(encryptedFile: EncryptedFile): Uint8Array {
  const { ephemeralPublicKey, iv, ciphertext } = encryptedFile
  const result = new Uint8Array(ephemeralPublicKey.length + iv.length + ciphertext.length)

  result.set(ephemeralPublicKey, 0)
  result.set(iv, ephemeralPublicKey.length)
  result.set(ciphertext, ephemeralPublicKey.length + iv.length)

  return result
}

/**
 * Deserialize encrypted file from storage/transmission
 * Format: [33 bytes pubkey][12 bytes iv][ciphertext]
 */
export function deserializeEncryptedFile(data: Uint8Array): EncryptedFile {
  if (data.length < 33 + 12) {
    throw new Error('Invalid encrypted file: too short')
  }

  const ephemeralPublicKey = data.slice(0, 33)
  const iv = data.slice(33, 33 + 12)
  const ciphertext = data.slice(33 + 12)

  return { ephemeralPublicKey, iv, ciphertext }
}
