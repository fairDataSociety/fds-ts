/**
 * FairdropKeystore - FDS Portable Account Format
 *
 * Creates and parses Fairdrop-compatible keystore files that are
 * interoperable between Go (fds-id-go) and TypeScript implementations.
 *
 * Format:
 * - KDF: scrypt (N=262144, r=8, p=1, dkLen=32)
 * - Cipher: AES-128-CTR (first 16 bytes of derived key)
 * - MAC: keccak256(derivedKey[16:32] || ciphertext)
 *
 * Encrypted payload contains: subdomain, publicKey, privateKey (0x-prefixed),
 * mnemonic (if HD wallet), walletAddress, created timestamp.
 *
 * This matches fds-id-go's wallet/export.go exactly.
 */

import * as crypto from 'crypto';
import { keccak256 as ethersKeccak256 } from 'ethers';

// Scrypt parameters (Ethereum standard, matches Go fds-id-go)
const SCRYPT_N = 262144; // 2^18
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 32;

const SALT_LENGTH = 32;
const IV_LENGTH = 16;

// ============================================================================
// Types (matching Go fds-id-go export.go JSON tags exactly)
// ============================================================================

export interface FairdropKeystore {
  version: number;
  type: 'fairdrop' | 'fairdrive';
  address: string;
  crypto: {
    cipher: string;
    ciphertext: string;
    cipherparams: { iv: string };
    kdf: string;
    kdfparams: {
      dklen: number;
      n: number;
      r: number;
      p: number;
      salt: string;
    };
    mac: string;
  };
}

export interface FairdropPayload {
  subdomain: string;
  publicKey: string;
  privateKey: string; // hex with 0x prefix (matching Go)
  mnemonic?: string; // 12/24 word phrase (omitted if not HD wallet)
  walletAddress?: string; // 0x... format
  created: number; // Unix milliseconds
  // Optional stamp/inbox fields (for Go compatibility)
  inboxParams?: Record<string, unknown>;
  stampId?: string;
  stamps?: Array<Record<string, unknown>>;
}

// ============================================================================
// Keystore Creation
// ============================================================================

/**
 * Create a Fairdrop-compatible keystore.
 * Uses scrypt + AES-128-CTR + keccak256 MAC (matching Go fds-id-go).
 */
export async function createFairdropKeystore(
  payload: FairdropPayload,
  password: string,
  ensDomain?: string
): Promise<string> {
  // Serialize payload (matching Go json.Marshal)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');

  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  // Derive key using scrypt
  const derivedKey = await scryptAsync(password, salt);

  // Encrypt with AES-128-CTR (first 16 bytes of derived key)
  const encryptionKey = derivedKey.subarray(0, 16);
  const cipher = crypto.createCipheriv('aes-128-ctr', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  // MAC: keccak256(derivedKey[16:32] || ciphertext)
  const macInput = Buffer.concat([derivedKey.subarray(16, 32), ciphertext]);
  const mac = keccak256Bytes(macInput);

  // Build ENS address
  let address = payload.subdomain;
  if (ensDomain) {
    address = `${payload.subdomain}.${ensDomain}`;
  }

  const keystore: FairdropKeystore = {
    version: 1,
    type: 'fairdrop',
    address,
    crypto: {
      cipher: 'aes-128-ctr',
      ciphertext: ciphertext.toString('hex'),
      cipherparams: { iv: iv.toString('hex') },
      kdf: 'scrypt',
      kdfparams: {
        dklen: SCRYPT_DKLEN,
        n: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        salt: salt.toString('hex'),
      },
      mac: mac.toString('hex'),
    },
  };

  return JSON.stringify(keystore, null, 2);
}

// ============================================================================
// Keystore Parsing
// ============================================================================

/**
 * Parse and decrypt a Fairdrop/Fairdrive keystore.
 * Accepts both 'fairdrop' and 'fairdrive' type keystores.
 */
export async function parseFairdropKeystore(
  keystoreJson: string,
  password: string
): Promise<FairdropPayload> {
  const keystore: FairdropKeystore = JSON.parse(keystoreJson);

  // Validate format
  if (keystore.version !== 1) {
    throw new Error('Invalid keystore version');
  }
  if (keystore.type !== 'fairdrop' && keystore.type !== 'fairdrive') {
    throw new Error('Invalid keystore type');
  }
  if (keystore.crypto.cipher !== 'aes-128-ctr') {
    throw new Error('Unsupported cipher');
  }
  if (keystore.crypto.kdf !== 'scrypt') {
    throw new Error('Unsupported KDF');
  }

  const { ciphertext, cipherparams, kdfparams, mac } = keystore.crypto;
  const salt = Buffer.from(kdfparams.salt, 'hex');
  const iv = Buffer.from(cipherparams.iv, 'hex');
  const encryptedData = Buffer.from(ciphertext, 'hex');
  const storedMac = Buffer.from(mac, 'hex');

  // Derive key using scrypt (use params from keystore for compatibility)
  const derivedKey = await scryptAsync(password, salt, {
    N: kdfparams.n,
    r: kdfparams.r,
    p: kdfparams.p,
  });

  // Verify MAC
  const macInput = Buffer.concat([derivedKey.subarray(16, 32), encryptedData]);
  const computedMac = keccak256Bytes(macInput);

  if (!crypto.timingSafeEqual(computedMac, storedMac)) {
    throw new Error('Invalid password');
  }

  // Decrypt with AES-128-CTR
  const encryptionKey = derivedKey.subarray(0, 16);
  const decipher = crypto.createDecipheriv('aes-128-ctr', encryptionKey, iv);
  const plaintext = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

  return JSON.parse(plaintext.toString('utf8'));
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate keystore format without decrypting.
 */
export function validateKeystoreFormat(keystoreJson: string): boolean {
  try {
    const keystore = JSON.parse(keystoreJson);
    return (
      keystore.version === 1 &&
      (keystore.type === 'fairdrop' || keystore.type === 'fairdrive') &&
      keystore.crypto?.cipher === 'aes-128-ctr' &&
      keystore.crypto?.kdf === 'scrypt' &&
      typeof keystore.crypto?.ciphertext === 'string' &&
      typeof keystore.crypto?.mac === 'string' &&
      typeof keystore.crypto?.kdfparams?.salt === 'string'
    );
  } catch {
    return false;
  }
}

/**
 * Extract subdomain from keystore address field.
 * "alice.fairdrop.eth" → "alice"
 */
export function getSubdomainFromAddress(address: string): string {
  const parts = address.split('.');
  return parts[0] || address;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Async scrypt key derivation
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  params?: { N?: number; r?: number; p?: number }
): Promise<Buffer> {
  const N = params?.N ?? SCRYPT_N;
  const r = params?.r ?? SCRYPT_R;
  const p = params?.p ?? SCRYPT_P;

  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_DKLEN,
      { N, r, p, maxmem: N * r * 256 },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      }
    );
  });
}

/**
 * Keccak-256 hash returning Buffer (matching Go's sha3.NewLegacyKeccak256)
 */
function keccak256Bytes(data: Buffer): Buffer {
  const hex = ethersKeccak256(data);
  return Buffer.from(hex.slice(2), 'hex');
}
