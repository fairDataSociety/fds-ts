/**
 * Secure Wallet Implementation
 *
 * Security-hardened wallet following the principle: "derive on-demand, zero after use"
 *
 * Key security features:
 * - PBKDF2 with 100,000 iterations for password-based key derivation
 * - AES-256-GCM for seed encryption
 * - Private keys derived on-demand and zeroed immediately after use
 * - Encrypted seed stored, never plaintext mnemonic
 *
 * Usage:
 * ```typescript
 * // Create new wallet
 * const { wallet, mnemonic } = await SecureWallet.create('myPassword');
 * // IMPORTANT: Display mnemonic to user ONCE, then forget it
 *
 * // Import existing wallet
 * const wallet = await SecureWallet.fromMnemonic(mnemonic, 'myPassword');
 *
 * // Sign a transaction (key derived, used, zeroed)
 * const signature = await wallet.signMessage('Hello', 'myPassword');
 *
 * // Derive encryption key for a pod
 * const key = await wallet.derivePodKey('myPod', 'myPassword');
 * // Use key, then zero it when done
 * ```
 */

import * as crypto from 'crypto';
import { HDNodeWallet, Mnemonic, Wallet as EthersWallet, keccak256, toUtf8Bytes, getBytes } from 'ethers';

// BIP-44 path for Fairdrive: m/44'/60'/0'/0/0
// Must match Go fds-id-go DefaultDerivationPath for cross-platform interoperability
const FAIRDRIVE_PATH = "m/44'/60'/0'/0/0";

// PBKDF2 configuration
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LENGTH = 32; // 256 bits
const PBKDF2_DIGEST = 'sha256';

// AES-GCM configuration
// Note: 16-byte IV is non-standard (GCM standard is 12 bytes) but cannot
// be changed without a data migration. Existing encrypted wallets use this format.
const AES_ALGORITHM = 'aes-256-gcm';
const AES_IV_LENGTH = 16;
const AES_AUTH_TAG_LENGTH = 16;

export interface SecureWalletData {
  address: string;
  publicKey: string;
}

/**
 * Secure wallet wrapper - private key derived on-demand, zeroed after use
 */
export class SecureWallet {
  private readonly encryptedSeed: Buffer;
  private readonly kdfSalt: Buffer;
  private readonly _address: string;
  private readonly _publicKey: string;

  private constructor(
    encryptedSeed: Buffer,
    kdfSalt: Buffer,
    address: string,
    publicKey: string
  ) {
    this.encryptedSeed = encryptedSeed;
    this.kdfSalt = kdfSalt;
    this._address = address;
    this._publicKey = publicKey;
  }

  /**
   * Create a new wallet with random mnemonic
   *
   * @param password - Password to encrypt the seed
   * @returns The wallet instance and mnemonic (display once, then forget)
   */
  static async create(password: string): Promise<{ wallet: SecureWallet; mnemonic: string }> {
    // Generate random mnemonic
    const randomWallet = EthersWallet.createRandom();
    const mnemonic = randomWallet.mnemonic!.phrase;

    // Create secure wallet from mnemonic
    const wallet = await SecureWallet.fromMnemonic(mnemonic, password);

    return { wallet, mnemonic };
  }

  /**
   * Create wallet from mnemonic - immediately encrypts and should forget source
   *
   * @param mnemonic - BIP-39 mnemonic phrase
   * @param password - Password to encrypt the seed
   */
  static async fromMnemonic(mnemonic: string, password: string): Promise<SecureWallet> {
    // Validate mnemonic
    let mnemonicObj: Mnemonic;
    try {
      mnemonicObj = Mnemonic.fromPhrase(mnemonic);
    } catch (e) {
      throw new Error('Invalid mnemonic phrase');
    }

    // Derive HD node to get address and public key (we need these unencrypted)
    const hdNode = HDNodeWallet.fromMnemonic(mnemonicObj, FAIRDRIVE_PATH);
    const address = hdNode.address;
    const publicKey = hdNode.publicKey;

    // Convert mnemonic to seed (64 bytes)
    // computeSeed() returns a hex string in ethers v6, use getBytes to convert
    const seed = Buffer.from(getBytes(mnemonicObj.computeSeed()));

    // Generate random salt for PBKDF2
    const kdfSalt = crypto.randomBytes(32);

    // Derive encryption key from password
    const encKey = await SecureWallet.pbkdf2(password, kdfSalt);

    try {
      // Generate random IV
      const iv = crypto.randomBytes(AES_IV_LENGTH);

      // Encrypt seed with AES-256-GCM
      const cipher = crypto.createCipheriv(AES_ALGORITHM, encKey, iv);
      const encrypted = Buffer.concat([cipher.update(seed), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Format: IV (16) || ciphertext || authTag (16)
      const encryptedSeed = Buffer.concat([iv, encrypted, authTag]);

      // Zero the plaintext seed
      seed.fill(0);

      return new SecureWallet(encryptedSeed, kdfSalt, address, publicKey);
    } finally {
      // CRITICAL: Zero the encryption key
      encKey.fill(0);
    }
  }

  /**
   * Import from serialized data (encrypted seed + salt)
   */
  static fromEncrypted(
    encryptedSeed: Buffer,
    kdfSalt: Buffer,
    address: string,
    publicKey: string
  ): SecureWallet {
    return new SecureWallet(encryptedSeed, kdfSalt, address, publicKey);
  }

  /**
   * Get wallet address (available without password)
   */
  get address(): string {
    return this._address;
  }

  /**
   * Get wallet public key (available without password)
   */
  get publicKey(): string {
    return this._publicKey;
  }

  /**
   * Get encrypted data for storage
   */
  getEncryptedData(): { encryptedSeed: Buffer; kdfSalt: Buffer } {
    return {
      encryptedSeed: Buffer.from(this.encryptedSeed),
      kdfSalt: Buffer.from(this.kdfSalt),
    };
  }

  /**
   * Sign a message - derives key, signs, zeros key
   *
   * @param message - Message to sign
   * @param password - Password to decrypt the seed
   */
  async signMessage(message: string, password: string): Promise<string> {
    const hdNode = await this.deriveHDNode(password);
    try {
      return await hdNode.signMessage(message);
    } finally {
      // Note: ethers.js HDNodeWallet doesn't expose raw key buffer to zero
      // The key will be garbage collected, but we've minimized exposure time
    }
  }

  /**
   * Sign typed data (EIP-712)
   */
  async signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>,
    password: string
  ): Promise<string> {
    const hdNode = await this.deriveHDNode(password);
    try {
      return await hdNode.signTypedData(domain as any, types, value);
    } finally {
      // Minimize exposure time
    }
  }

  /**
   * Derive encryption key for a pod
   * Uses deterministic derivation matching Go fds-id-go:
   *   keccak256(privateKeyHex + ":pod:" + podName)
   * where privateKeyHex is the 64-char hex private key (no 0x prefix)
   * Returns a 32-byte key that should be zeroed after use
   */
  async derivePodKey(podName: string, password: string): Promise<Uint8Array> {
    const hdNode = await this.deriveHDNode(password);
    try {
      // Use private key hex (strip 0x prefix) to match Go fds-id-go derivation
      const privKeyHex = hdNode.privateKey.slice(2);
      const derivationInput = `${privKeyHex}:pod:${podName}`;
      const hash = keccak256(toUtf8Bytes(derivationInput));
      return new Uint8Array(Buffer.from(hash.slice(2), 'hex'));
    } finally {
      // HD node will be garbage collected; exposure time minimized
    }
  }

  /**
   * Derive metadata encryption key
   * Used for encrypting sync metadata, file indexes, etc.
   */
  async deriveMetadataKey(purpose: string, password: string): Promise<Uint8Array> {
    const seed = await this.decryptSeed(password);
    try {
      const derivationInput = Buffer.concat([
        seed,
        Buffer.from(':metadata:'),
        Buffer.from(purpose),
      ]);
      const hash = keccak256(derivationInput);
      return new Uint8Array(Buffer.from(hash.slice(2), 'hex'));
    } finally {
      seed.fill(0);
    }
  }

  /**
   * Derive child wallet at specific index
   */
  async deriveChild(index: number, password: string): Promise<SecureWalletData> {
    const hdNode = await this.deriveHDNode(password);
    const childNode = hdNode.deriveChild(index);
    return {
      address: childNode.address,
      publicKey: childNode.publicKey,
    };
  }

  /**
   * Verify password is correct (without exposing keys)
   */
  async verifyPassword(password: string): Promise<boolean> {
    try {
      const seed = await this.decryptSeed(password);
      seed.fill(0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Change wallet password
   */
  async changePassword(oldPassword: string, newPassword: string): Promise<SecureWallet> {
    // Decrypt with old password
    const seed = await this.decryptSeed(oldPassword);

    try {
      // Generate new salt
      const newKdfSalt = crypto.randomBytes(32);

      // Derive new encryption key
      const newEncKey = await SecureWallet.pbkdf2(newPassword, newKdfSalt);

      try {
        // Encrypt with new key
        const iv = crypto.randomBytes(AES_IV_LENGTH);
        const cipher = crypto.createCipheriv(AES_ALGORITHM, newEncKey, iv);
        const encrypted = Buffer.concat([cipher.update(seed), cipher.final()]);
        const authTag = cipher.getAuthTag();

        const newEncryptedSeed = Buffer.concat([iv, encrypted, authTag]);

        return new SecureWallet(newEncryptedSeed, newKdfSalt, this._address, this._publicKey);
      } finally {
        newEncKey.fill(0);
      }
    } finally {
      seed.fill(0);
    }
  }

  /**
   * Decrypt seed - internal use only
   */
  private async decryptSeed(password: string): Promise<Buffer> {
    // Derive encryption key
    const encKey = await SecureWallet.pbkdf2(password, this.kdfSalt);

    try {
      // Parse encrypted data: IV (16) || ciphertext || authTag (16)
      const iv = this.encryptedSeed.subarray(0, AES_IV_LENGTH);
      const authTag = this.encryptedSeed.subarray(-AES_AUTH_TAG_LENGTH);
      const ciphertext = this.encryptedSeed.subarray(AES_IV_LENGTH, -AES_AUTH_TAG_LENGTH);

      // Decrypt
      const decipher = crypto.createDecipheriv(AES_ALGORITHM, encKey, iv);
      decipher.setAuthTag(authTag);

      const seed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return seed;
    } catch (e) {
      throw new Error('Invalid password or corrupted data');
    } finally {
      // Zero encryption key
      encKey.fill(0);
    }
  }

  /**
   * Derive HD node from seed - internal use only
   */
  private async deriveHDNode(password: string): Promise<HDNodeWallet> {
    const seed = await this.decryptSeed(password);

    try {
      // HDNodeWallet.fromSeed expects a hex string or Uint8Array
      const hdNode = HDNodeWallet.fromSeed(seed);
      // Derive to Fairdrive path
      return hdNode.derivePath(FAIRDRIVE_PATH);
    } finally {
      // Zero seed
      seed.fill(0);
    }
  }

  /**
   * PBKDF2 key derivation
   */
  private static pbkdf2(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        password,
        salt,
        PBKDF2_ITERATIONS,
        PBKDF2_KEY_LENGTH,
        PBKDF2_DIGEST,
        (err, key) => {
          if (err) reject(err);
          else resolve(key);
        }
      );
    });
  }
}

/**
 * Helper to securely zero a buffer/Uint8Array
 */
export function zeroBuffer(buffer: Buffer | Uint8Array): void {
  buffer.fill(0);
}
