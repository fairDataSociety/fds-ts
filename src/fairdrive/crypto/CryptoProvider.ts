/**
 * Isomorphic Cryptography Provider
 *
 * Provides AES-256-GCM encryption and PBKDF2 key derivation that works in:
 * - Node.js (using Node crypto module)
 * - Browsers (using Web Crypto API)
 * - Web Workers (using Web Crypto API)
 * - Edge runtimes (Cloudflare Workers, etc.)
 *
 * Security properties:
 * - AES-256-GCM: Authenticated encryption with AEAD
 * - PBKDF2-SHA256: 100,000+ iterations (OWASP 2023+ compliant)
 * - Random IV per encryption (12 bytes for GCM)
 * - 16-byte authentication tag for integrity verification
 */

import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface EncryptResult {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
}

export interface CryptoProvider {
  /**
   * Encrypt data with AES-256-GCM
   * @param data Plaintext data
   * @param key 32-byte encryption key
   * @returns Encrypted result with ciphertext, IV, and authentication tag
   */
  encrypt(data: Uint8Array, key: Uint8Array): Promise<EncryptResult>;

  /**
   * Decrypt data with AES-256-GCM
   * @param ciphertext Encrypted data
   * @param key 32-byte decryption key
   * @param iv 12-byte initialization vector
   * @param authTag 16-byte authentication tag
   * @returns Decrypted plaintext
   * @throws Error if authentication fails (tampering detected)
   */
  decrypt(
    ciphertext: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array,
    authTag: Uint8Array
  ): Promise<Uint8Array>;

  /**
   * Derive encryption key using PBKDF2-SHA256
   * @param password Input key material
   * @param salt Salt for key derivation
   * @param iterations Number of PBKDF2 iterations (min 100,000)
   * @returns 32-byte derived key
   */
  deriveKey(
    password: Uint8Array,
    salt: Uint8Array,
    iterations: number
  ): Promise<Uint8Array>;

  /**
   * Generate cryptographically secure random bytes
   * @param length Number of bytes to generate
   * @returns Random bytes
   */
  randomBytes(length: number): Uint8Array;
}

// ============================================================================
// Node.js Implementation
// ============================================================================

export class NodeCryptoProvider implements CryptoProvider {
  async encrypt(data: Uint8Array, key: Uint8Array): Promise<EncryptResult> {
    // GCM uses 12-byte IV (96 bits) - NIST recommended
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key), iv);

    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(data)),
      cipher.final(),
    ]);

    // Get authentication tag (16 bytes)
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: new Uint8Array(ciphertext),
      iv: new Uint8Array(iv),
      authTag: new Uint8Array(authTag),
    };
  }

  async decrypt(
    ciphertext: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array,
    authTag: Uint8Array
  ): Promise<Uint8Array> {
    // Validate auth tag length
    if (authTag.length !== 16) {
      throw new Error(
        `Invalid auth tag length: expected 16, got ${authTag.length}`
      );
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(key),
      Buffer.from(iv)
    );

    decipher.setAuthTag(Buffer.from(authTag));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext)),
      decipher.final(), // Throws if authentication fails
    ]);

    return new Uint8Array(plaintext);
  }

  async deriveKey(
    password: Uint8Array,
    salt: Uint8Array,
    iterations: number = 100000
  ): Promise<Uint8Array> {
    const MIN_ITERATIONS = 100000;
    if (iterations < MIN_ITERATIONS) {
      throw new Error(
        `PBKDF2 iterations must be >= ${MIN_ITERATIONS} (got ${iterations})`
      );
    }

    return new Promise<Uint8Array>((resolve, reject) => {
      crypto.pbkdf2(
        Buffer.from(password),
        Buffer.from(salt),
        iterations,
        32, // 256 bits
        'sha256',
        (err, key) => {
          if (err) reject(err);
          else resolve(new Uint8Array(key));
        }
      );
    });
  }

  randomBytes(length: number): Uint8Array {
    return new Uint8Array(crypto.randomBytes(length));
  }
}

// ============================================================================
// Web Crypto API Implementation (Browser, Web Workers, Edge Runtimes)
// ============================================================================

export class WebCryptoProvider implements CryptoProvider {
  private get webCrypto(): typeof globalThis.crypto {
    return globalThis.crypto;
  }

  async encrypt(data: Uint8Array, key: Uint8Array): Promise<EncryptResult> {
    // GCM uses 12-byte IV (96 bits)
    const iv = this.webCrypto.getRandomValues(new Uint8Array(12));

    const cryptoKey = await this.webCrypto.subtle.importKey(
      'raw',
      key as any,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    // Web Crypto API returns ciphertext + auth tag concatenated
    const encrypted = await this.webCrypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      data as any
    );

    const result = new Uint8Array(encrypted);
    const authTagLength = 16;

    // Split into ciphertext and auth tag
    const ciphertext = result.slice(0, -authTagLength);
    const authTag = result.slice(-authTagLength);

    return { ciphertext, iv, authTag };
  }

  async decrypt(
    ciphertext: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array,
    authTag: Uint8Array
  ): Promise<Uint8Array> {
    // Validate auth tag length
    if (authTag.length !== 16) {
      throw new Error(
        `Invalid auth tag length: expected 16, got ${authTag.length}`
      );
    }

    const cryptoKey = await this.webCrypto.subtle.importKey(
      'raw',
      key as any,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Combine ciphertext and auth tag (Web Crypto API expects concatenated)
    const combined = new Uint8Array(ciphertext.length + authTag.length);
    combined.set(ciphertext);
    combined.set(authTag, ciphertext.length);

    // Throws if authentication fails
    const decrypted = await this.webCrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as any },
      cryptoKey,
      combined
    );

    return new Uint8Array(decrypted);
  }

  async deriveKey(
    password: Uint8Array,
    salt: Uint8Array,
    iterations: number = 100000
  ): Promise<Uint8Array> {
    const MIN_ITERATIONS = 100000;
    if (iterations < MIN_ITERATIONS) {
      throw new Error(
        `PBKDF2 iterations must be >= ${MIN_ITERATIONS} (got ${iterations})`
      );
    }

    const baseKey = await this.webCrypto.subtle.importKey(
      'raw',
      password as any,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await this.webCrypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt as any,
        iterations,
        hash: 'SHA-256',
      },
      baseKey,
      256 // 256 bits
    );

    return new Uint8Array(derivedBits);
  }

  randomBytes(length: number): Uint8Array {
    return this.webCrypto.getRandomValues(new Uint8Array(length));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Get crypto provider for current environment
 *
 * Detects and returns appropriate implementation:
 * - Node.js: NodeCryptoProvider (using Node crypto module)
 * - Browser/Workers: WebCryptoProvider (using Web Crypto API)
 *
 * Supports:
 * - Node.js (process.versions.node exists)
 * - Browsers (window.crypto.subtle)
 * - Web Workers (self.crypto.subtle)
 * - Cloudflare Workers, Deno, etc. (globalThis.crypto.subtle)
 *
 * @throws Error if no crypto provider available
 */
export function getCryptoProvider(): CryptoProvider {
  // Check for Node.js first
  const g =
    typeof globalThis !== 'undefined'
      ? globalThis
      : typeof global !== 'undefined'
      ? global
      : {};

  if ((g as any).process?.versions?.node) {
    return new NodeCryptoProvider();
  }

  // Check for Web Crypto API (browser, Web Workers, Cloudflare Workers, etc.)
  // Access via globalThis to avoid TypeScript errors with window/self
  const cryptoObj = (g as any).crypto;

  if (cryptoObj?.subtle) {
    return new WebCryptoProvider();
  }

  throw new Error(
    'No crypto provider available (need Node.js or Web Crypto API)'
  );
}
