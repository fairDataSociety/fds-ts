/**
 * ECDH Encryption — for send/receive (one-off encrypted transfers).
 *
 * Uses secp256k1 ECDH + HKDF + AES-256-GCM.
 * Each send generates an ephemeral keypair (forward secrecy).
 *
 * Format: ephemeralPubKey(33) || IV(12) || authTag(16) || ciphertext
 *
 * Key derivation: HKDF-SHA256(sharedSecret, salt="fds-send-v1", info="encryption")
 * Fixes S14: uses HKDF with domain separation instead of raw SHA-256.
 */

import * as secp256k1 from '@noble/secp256k1'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { gcm } from '@noble/ciphers/aes'
import { randomBytes } from '@noble/ciphers/webcrypto'

const COMPRESSED_PUBKEY_LENGTH = 33
const IV_LENGTH = 12
const TAG_LENGTH = 16
const HKDF_SALT = new TextEncoder().encode('fds-send-v1')
const HKDF_INFO = new TextEncoder().encode('encryption')

export interface KeyPair {
  privateKey: Uint8Array  // 32 bytes
  publicKey: Uint8Array   // 33 bytes (compressed)
}

/**
 * Generate an ephemeral secp256k1 keypair.
 */
export function generateEphemeralKeyPair(): KeyPair {
  const privateKey = secp256k1.utils.randomSecretKey()
  const publicKey = secp256k1.getPublicKey(privateKey, true)  // compressed
  return { privateKey, publicKey }
}

/**
 * Encrypt data for a recipient using ECDH.
 *
 * @param plaintext - Data to encrypt
 * @param recipientPublicKey - Recipient's compressed public key (33 bytes)
 * @returns ephemeralPubKey(33) || IV(12) || authTag(16) || ciphertext
 */
export function encryptForRecipient(plaintext: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  // Generate ephemeral keypair for forward secrecy
  const ephemeral = generateEphemeralKeyPair()

  // ECDH: compute shared secret
  const sharedPoint = secp256k1.getSharedSecret(ephemeral.privateKey, recipientPublicKey)

  // Derive encryption key via HKDF (S14 fix: domain separation)
  const encKey = hkdf(sha256, sharedPoint.slice(1), HKDF_SALT, HKDF_INFO, 32)

  // Encrypt with AES-256-GCM
  const iv = randomBytes(IV_LENGTH)
  const cipher = gcm(encKey, iv)
  const ciphertext = cipher.encrypt(plaintext)
  // noble format: ciphertext = encrypted + authTag(16)

  const encrypted = ciphertext.slice(0, ciphertext.length - TAG_LENGTH)
  const authTag = ciphertext.slice(ciphertext.length - TAG_LENGTH)

  // Pack: ephemeralPubKey(33) + IV(12) + authTag(16) + encrypted
  const result = new Uint8Array(
    COMPRESSED_PUBKEY_LENGTH + IV_LENGTH + TAG_LENGTH + encrypted.length
  )
  result.set(ephemeral.publicKey, 0)
  result.set(iv, COMPRESSED_PUBKEY_LENGTH)
  result.set(authTag, COMPRESSED_PUBKEY_LENGTH + IV_LENGTH)
  result.set(encrypted, COMPRESSED_PUBKEY_LENGTH + IV_LENGTH + TAG_LENGTH)
  return result
}

/**
 * Decrypt data from a sender using ECDH.
 *
 * @param data - ephemeralPubKey(33) || IV(12) || authTag(16) || ciphertext
 * @param recipientPrivateKey - Recipient's private key (32 bytes)
 * @returns Decrypted plaintext
 */
export function decryptFromSender(data: Uint8Array, recipientPrivateKey: Uint8Array): Uint8Array {
  const minLength = COMPRESSED_PUBKEY_LENGTH + IV_LENGTH + TAG_LENGTH
  if (data.length < minLength) {
    throw new Error('Encrypted data too short')
  }

  // Unpack
  const ephemeralPubKey = data.slice(0, COMPRESSED_PUBKEY_LENGTH)
  const iv = data.slice(COMPRESSED_PUBKEY_LENGTH, COMPRESSED_PUBKEY_LENGTH + IV_LENGTH)
  const authTag = data.slice(
    COMPRESSED_PUBKEY_LENGTH + IV_LENGTH,
    COMPRESSED_PUBKEY_LENGTH + IV_LENGTH + TAG_LENGTH
  )
  const encrypted = data.slice(COMPRESSED_PUBKEY_LENGTH + IV_LENGTH + TAG_LENGTH)

  // ECDH: compute same shared secret
  const sharedPoint = secp256k1.getSharedSecret(recipientPrivateKey, ephemeralPubKey)

  // Derive same key via HKDF
  const encKey = hkdf(sha256, sharedPoint.slice(1), HKDF_SALT, HKDF_INFO, 32)

  // Reconstruct noble format: encrypted + authTag
  const ciphertext = new Uint8Array(encrypted.length + TAG_LENGTH)
  ciphertext.set(encrypted, 0)
  ciphertext.set(authTag, encrypted.length)

  // Decrypt
  const cipher = gcm(encKey, iv)
  return cipher.decrypt(ciphertext)
}
