/**
 * Secure Storage via OS Keychain
 *
 * Uses the OS-native secure storage mechanism:
 * - macOS: Keychain
 * - Windows: Credential Manager
 * - Linux: Secret Service API (libsecret)
 *
 * The keytar library provides cross-platform access to these stores.
 *
 * Data stored:
 * - Encrypted wallet seeds (already encrypted by SecureWallet)
 * - KDF salts for each wallet
 * - Wallet metadata (address, public key)
 *
 * Note: keytar is an optional peer dependency. When not available
 * (e.g., in browser environments), falls back to encrypted file storage.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const SERVICE_NAME = 'fairdrive';

// Type definition for keytar (loaded dynamically)
interface KeytarModule {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

/**
 * Wallet storage entry
 */
export interface StoredWallet {
  address: string;
  publicKey: string;
  encryptedSeed: string; // Base64
  kdfSalt: string; // Base64
  createdAt: string;
  lastUsed?: string;
}

/**
 * Secure store configuration
 */
export interface SecureStoreConfig {
  /** Fallback directory when keytar unavailable */
  fallbackDir?: string;
  /** Force fallback mode (for testing) */
  forceFallback?: boolean;
}

/**
 * Secure storage for wallet credentials
 */
export class SecureStore {
  private keytar: KeytarModule | null = null;
  private useFallback: boolean = false;
  private fallbackDir: string;

  constructor(config: SecureStoreConfig = {}) {
    this.fallbackDir = config.fallbackDir || this.getDefaultFallbackDir();
    this.useFallback = config.forceFallback || false;

    if (!this.useFallback) {
      this.initKeytar();
    }
  }

  /**
   * Initialize keytar (async to handle dynamic import)
   */
  private initKeytar(): void {
    try {
      // Attempt to require keytar (native module)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.keytar = require('keytar') as KeytarModule;
    } catch (e) {
      // H5: Make keytar fallback explicit - warn clearly about reduced security
      console.warn(
        '[SECURITY] OS keychain (keytar) not available. ' +
        'Falling back to file-based encrypted storage. ' +
        'This is less secure than the OS keychain and not portable across machines.'
      );
      this.useFallback = true;
    }
  }

  /**
   * Store a wallet
   */
  async setWallet(wallet: StoredWallet): Promise<void> {
    const key = `wallet:${wallet.address}`;
    const value = JSON.stringify(wallet);

    if (this.useFallback || !this.keytar) {
      await this.setFallback(key, value);
    } else {
      try {
        await this.keytar.setPassword(SERVICE_NAME, key, value);
      } catch (e) {
        // Fall back on keytar error
        console.warn('[SECURITY] Keytar write failed, using fallback storage');
        await this.setFallback(key, value);
      }
    }
  }

  /**
   * Retrieve a wallet by address
   */
  async getWallet(address: string): Promise<StoredWallet | null> {
    const key = `wallet:${address}`;

    let value: string | null = null;

    if (this.useFallback || !this.keytar) {
      value = await this.getFallback(key);
    } else {
      try {
        value = await this.keytar.getPassword(SERVICE_NAME, key);
      } catch (e) {
        value = await this.getFallback(key);
      }
    }

    if (!value) return null;

    try {
      const wallet = JSON.parse(value) as StoredWallet;
      // Update last used
      wallet.lastUsed = new Date().toISOString();
      // Don't save back here to avoid unnecessary writes
      return wallet;
    } catch {
      return null;
    }
  }

  /**
   * Delete a wallet
   */
  async deleteWallet(address: string): Promise<boolean> {
    const key = `wallet:${address}`;

    if (this.useFallback || !this.keytar) {
      return this.deleteFallback(key);
    }

    try {
      return await this.keytar.deletePassword(SERVICE_NAME, key);
    } catch {
      return this.deleteFallback(key);
    }
  }

  /**
   * List all stored wallet addresses
   */
  async listWallets(): Promise<string[]> {
    if (this.useFallback || !this.keytar) {
      return this.listFallback();
    }

    try {
      const credentials = await this.keytar.findCredentials(SERVICE_NAME);
      return credentials
        .filter(c => c.account.startsWith('wallet:'))
        .map(c => c.account.replace('wallet:', ''));
    } catch {
      return this.listFallback();
    }
  }

  /**
   * Check if a wallet exists
   */
  async hasWallet(address: string): Promise<boolean> {
    const wallet = await this.getWallet(address);
    return wallet !== null;
  }

  /**
   * Store arbitrary secret (for other secure data)
   */
  async setSecret(key: string, value: string): Promise<void> {
    const secretKey = `secret:${key}`;

    if (this.useFallback || !this.keytar) {
      await this.setFallback(secretKey, value);
    } else {
      try {
        await this.keytar.setPassword(SERVICE_NAME, secretKey, value);
      } catch {
        await this.setFallback(secretKey, value);
      }
    }
  }

  /**
   * Retrieve arbitrary secret
   */
  async getSecret(key: string): Promise<string | null> {
    const secretKey = `secret:${key}`;

    if (this.useFallback || !this.keytar) {
      return this.getFallback(secretKey);
    }

    try {
      return await this.keytar.getPassword(SERVICE_NAME, secretKey);
    } catch {
      return this.getFallback(secretKey);
    }
  }

  /**
   * Delete arbitrary secret
   */
  async deleteSecret(key: string): Promise<boolean> {
    const secretKey = `secret:${key}`;

    if (this.useFallback || !this.keytar) {
      return this.deleteFallback(secretKey);
    }

    try {
      return await this.keytar.deletePassword(SERVICE_NAME, secretKey);
    } catch {
      return this.deleteFallback(secretKey);
    }
  }

  // ============ Fallback Storage (Encrypted File) ============

  private getDefaultFallbackDir(): string {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, '.fairdrive', 'secure');
  }

  private getFallbackFilePath(key: string): string {
    // Hash the key to get a safe filename
    const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
    return path.join(this.fallbackDir, `${hash}.enc`);
  }

  private ensureFallbackDir(): void {
    if (!fs.existsSync(this.fallbackDir)) {
      fs.mkdirSync(this.fallbackDir, { recursive: true, mode: 0o700 });
    }
  }

  private getMachineKey(salt?: Buffer): Buffer {
    // Derive a machine-specific key for fallback encryption using PBKDF2
    // This provides some protection but is not as secure as OS keychain
    const machineId = this.getMachineId();
    const keySalt = salt || Buffer.alloc(32, 0); // fallback for legacy data without salt
    return crypto.pbkdf2Sync(machineId, keySalt, 100000, 32, 'sha256');
  }

  private getMachineId(): string {
    // Try to get a unique machine identifier
    // This is a best-effort approach for fallback security
    const os = require('os');
    const cpus = os.cpus();
    const networkInterfaces = os.networkInterfaces();

    const parts = [
      os.hostname(),
      os.platform(),
      os.arch(),
      cpus[0]?.model || '',
      Object.keys(networkInterfaces).join(','),
    ];

    return parts.join(':');
  }

  private async setFallback(key: string, value: string): Promise<void> {
    this.ensureFallbackDir();

    const filePath = this.getFallbackFilePath(key);
    const salt = crypto.randomBytes(32);
    const machineKey = this.getMachineKey(salt);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv('aes-256-gcm', machineKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Format v2: 0x02 || salt(32) || IV(16) || authTag(16) || ciphertext
    const data = Buffer.concat([Buffer.from([0x02]), salt, iv, authTag, encrypted]);

    fs.writeFileSync(filePath, data, { mode: 0o600 });
  }

  private async getFallback(key: string): Promise<string | null> {
    const filePath = this.getFallbackFilePath(key);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const data = fs.readFileSync(filePath);

      let machineKey: Buffer;
      let iv: Buffer;
      let authTag: Buffer;
      let ciphertext: Buffer;

      if (data[0] === 0x02) {
        // v2 format with salt: 0x02 || salt(32) || IV(16) || authTag(16) || ciphertext
        const salt = data.subarray(1, 33);
        machineKey = this.getMachineKey(salt);
        iv = data.subarray(33, 49);
        authTag = data.subarray(49, 65);
        ciphertext = data.subarray(65);
      } else {
        // Legacy format (no salt): IV(16) || authTag(16) || ciphertext
        machineKey = this.getMachineKey();
        iv = data.subarray(0, 16);
        authTag = data.subarray(16, 32);
        ciphertext = data.subarray(32);
      }

      const decipher = crypto.createDecipheriv('aes-256-gcm', machineKey, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch (e) {
      // Silently fail - expected if file doesn't exist or machine key changed
      return null;
    }
  }

  private async deleteFallback(key: string): Promise<boolean> {
    const filePath = this.getFallbackFilePath(key);

    if (!fs.existsSync(filePath)) {
      return false;
    }

    try {
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async listFallback(): Promise<string[]> {
    if (!fs.existsSync(this.fallbackDir)) {
      return [];
    }

    const addresses: string[] = [];
    const files = fs.readdirSync(this.fallbackDir);

    for (const file of files) {
      if (!file.endsWith('.enc')) continue;

      const filePath = path.join(this.fallbackDir, file);

      // Read and decrypt the file directly (can't reverse hash to get original key)
      try {
        const data = fs.readFileSync(filePath);

        let machineKey: Buffer;
        let iv: Buffer;
        let authTag: Buffer;
        let ciphertext: Buffer;

        if (data[0] === 0x02) {
          // v2 format with salt: 0x02 || salt(32) || IV(16) || authTag(16) || ciphertext
          const salt = data.subarray(1, 33);
          machineKey = this.getMachineKey(salt);
          iv = data.subarray(33, 49);
          authTag = data.subarray(49, 65);
          ciphertext = data.subarray(65);
        } else {
          // Legacy format (no salt): IV(16) || authTag(16) || ciphertext
          machineKey = this.getMachineKey();
          iv = data.subarray(0, 16);
          authTag = data.subarray(16, 32);
          ciphertext = data.subarray(32);
        }

        const decipher = crypto.createDecipheriv('aes-256-gcm', machineKey, iv);
        decipher.setAuthTag(authTag);

        const decrypted = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);

        const content = decrypted.toString('utf8');
        const parsed = JSON.parse(content);

        // Check if this is a wallet entry (has address field)
        if (parsed.address) {
          addresses.push(parsed.address);
        }
      } catch {
        // Ignore files that can't be decrypted or parsed
      }
    }

    return addresses;
  }
}

/**
 * Singleton instance for convenience
 */
let defaultStore: SecureStore | null = null;

export function getSecureStore(config?: SecureStoreConfig): SecureStore {
  if (!defaultStore) {
    defaultStore = new SecureStore(config);
  }
  return defaultStore;
}

export function resetSecureStore(): void {
  defaultStore = null;
}
