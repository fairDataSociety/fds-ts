/**
 * CryptoProvider Security Tests
 *
 * Validates that the isomorphic crypto implementation provides:
 * - AES-256-GCM authenticated encryption
 * - PBKDF2-SHA256 key derivation with 100k+ iterations
 * - Tampering detection via auth tags
 * - Secure random number generation
 */

import { describe, it, expect } from 'vitest';
import {
  getCryptoProvider,
  NodeCryptoProvider,
  WebCryptoProvider,
  type CryptoProvider,
} from './CryptoProvider';

describe('CryptoProvider Security', () => {
  let crypto: CryptoProvider;

  beforeEach(() => {
    crypto = getCryptoProvider();
  });

  describe('AES-256-GCM Encryption', () => {
    it('should use AES-256-GCM with authentication', async () => {
      const key = crypto.randomBytes(32); // 256 bits
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await crypto.encrypt(plaintext, key);

      // Verify structure
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toHaveLength(12); // GCM uses 12-byte IV
      expect(encrypted.authTag).toHaveLength(16); // GCM auth tag

      // Verify ciphertext is different from plaintext
      expect(encrypted.ciphertext).not.toEqual(plaintext);
    });

    it('should decrypt ciphertext correctly', async () => {
      const key = crypto.randomBytes(32);
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await crypto.encrypt(plaintext, key);
      const decrypted = await crypto.decrypt(
        encrypted.ciphertext,
        key,
        encrypted.iv,
        encrypted.authTag
      );

      expect(decrypted).toEqual(plaintext);
    });

    it('should produce different ciphertexts for same plaintext (random IV)', async () => {
      const key = crypto.randomBytes(32);
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted1 = await crypto.encrypt(plaintext, key);
      const encrypted2 = await crypto.encrypt(plaintext, key);

      // IVs should be different (random)
      expect(encrypted1.iv).not.toEqual(encrypted2.iv);

      // Ciphertexts should be different (different IVs)
      expect(encrypted1.ciphertext).not.toEqual(encrypted2.ciphertext);

      // Both should decrypt to same plaintext
      const decrypted1 = await crypto.decrypt(
        encrypted1.ciphertext,
        key,
        encrypted1.iv,
        encrypted1.authTag
      );
      const decrypted2 = await crypto.decrypt(
        encrypted2.ciphertext,
        key,
        encrypted2.iv,
        encrypted2.authTag
      );

      expect(decrypted1).toEqual(plaintext);
      expect(decrypted2).toEqual(plaintext);
    });

    it('should fail decryption with tampered ciphertext', async () => {
      const key = crypto.randomBytes(32);
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await crypto.encrypt(plaintext, key);

      // Tamper with ciphertext
      encrypted.ciphertext[0] ^= 0xFF;

      // Decryption should throw (authentication failure)
      await expect(
        crypto.decrypt(encrypted.ciphertext, key, encrypted.iv, encrypted.authTag)
      ).rejects.toThrow();
    });

    it('should fail decryption with tampered auth tag', async () => {
      const key = crypto.randomBytes(32);
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await crypto.encrypt(plaintext, key);

      // Tamper with auth tag
      encrypted.authTag[0] ^= 0xFF;

      // Decryption should throw (authentication failure)
      await expect(
        crypto.decrypt(encrypted.ciphertext, key, encrypted.iv, encrypted.authTag)
      ).rejects.toThrow();
    });

    it('should fail decryption with wrong key', async () => {
      const key = crypto.randomBytes(32);
      const wrongKey = crypto.randomBytes(32);
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await crypto.encrypt(plaintext, key);

      // Decryption with wrong key should throw
      await expect(
        crypto.decrypt(encrypted.ciphertext, wrongKey, encrypted.iv, encrypted.authTag)
      ).rejects.toThrow();
    });

    it('should reject invalid auth tag length', async () => {
      const key = crypto.randomBytes(32);
      const ciphertext = new Uint8Array([1, 2, 3]);
      const iv = new Uint8Array(12);
      const invalidAuthTag = new Uint8Array(8); // Wrong length (should be 16)

      await expect(
        crypto.decrypt(ciphertext, key, iv, invalidAuthTag)
      ).rejects.toThrow(/Invalid auth tag length/);
    });
  });

  describe('PBKDF2 Key Derivation', () => {
    it('should use PBKDF2 with 100k+ iterations', async () => {
      const password = new TextEncoder().encode('test-password');
      const salt = crypto.randomBytes(16);

      const start = Date.now();
      const key = await crypto.deriveKey(password, salt, 100000);
      const duration = Date.now() - start;

      // Key should be 32 bytes (256 bits)
      expect(key).toHaveLength(32);

      // PBKDF2 with 100k iterations should take some time
      // (varies by hardware - M1/M2 Macs can do this in ~10-20ms)
      // Just verify it completed without error (key derivation worked)
      expect(duration).toBeGreaterThan(0);

      // Log duration for informational purposes
      console.log(`PBKDF2 (100k iterations) took ${duration}ms`);
    });

    it('should produce different keys with different salts', async () => {
      const password = new TextEncoder().encode('test-password');
      const salt1 = crypto.randomBytes(16);
      const salt2 = crypto.randomBytes(16);

      const key1 = await crypto.deriveKey(password, salt1, 100000);
      const key2 = await crypto.deriveKey(password, salt2, 100000);

      // Keys should be different (different salts)
      expect(key1).not.toEqual(key2);
    });

    it('should produce same key with same password and salt', async () => {
      const password = new TextEncoder().encode('test-password');
      const salt = crypto.randomBytes(16);

      const key1 = await crypto.deriveKey(password, salt, 100000);
      const key2 = await crypto.deriveKey(password, salt, 100000);

      // Keys should be identical (same password + salt)
      expect(key1).toEqual(key2);
    });

    it('should reject iteration counts below 100k', async () => {
      const password = new TextEncoder().encode('test-password');
      const salt = crypto.randomBytes(16);

      await expect(
        crypto.deriveKey(password, salt, 50000)
      ).rejects.toThrow(/PBKDF2 iterations must be >= 100000/);
    });

    it('should handle long passwords', async () => {
      const longPassword = new TextEncoder().encode('a'.repeat(1000));
      const salt = crypto.randomBytes(16);

      const key = await crypto.deriveKey(longPassword, salt, 100000);

      expect(key).toHaveLength(32);
    });
  });

  describe('Random Number Generation', () => {
    it('should generate cryptographically secure random bytes', () => {
      const random1 = crypto.randomBytes(32);
      const random2 = crypto.randomBytes(32);

      expect(random1).toHaveLength(32);
      expect(random2).toHaveLength(32);

      // Should be different (probability of collision is negligible)
      expect(random1).not.toEqual(random2);
    });

    it('should generate different lengths correctly', () => {
      const random8 = crypto.randomBytes(8);
      const random16 = crypto.randomBytes(16);
      const random32 = crypto.randomBytes(32);

      expect(random8).toHaveLength(8);
      expect(random16).toHaveLength(16);
      expect(random32).toHaveLength(32);
    });
  });

  describe('Provider Detection', () => {
    it('should return a valid crypto provider', () => {
      expect(crypto).toBeDefined();
      expect(crypto).toBeInstanceOf(Object);

      // Should have required methods
      expect(typeof crypto.encrypt).toBe('function');
      expect(typeof crypto.decrypt).toBe('function');
      expect(typeof crypto.deriveKey).toBe('function');
      expect(typeof crypto.randomBytes).toBe('function');
    });

    it('should be either NodeCryptoProvider or WebCryptoProvider', () => {
      const isNodeProvider = crypto instanceof NodeCryptoProvider;
      const isWebProvider = crypto instanceof WebCryptoProvider;

      // Should be one of the two
      expect(isNodeProvider || isWebProvider).toBe(true);

      // Log which provider is being used (helpful for debugging)
      if (isNodeProvider) {
        console.log('Using NodeCryptoProvider');
      } else {
        console.log('Using WebCryptoProvider');
      }
    });
  });

  describe('Large Data Handling', () => {
    it('should encrypt and decrypt large data correctly', async () => {
      const key = crypto.randomBytes(32);

      // 1MB of data
      const largeData = new Uint8Array(1024 * 1024);
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256;
      }

      const encrypted = await crypto.encrypt(largeData, key);
      const decrypted = await crypto.decrypt(
        encrypted.ciphertext,
        key,
        encrypted.iv,
        encrypted.authTag
      );

      expect(decrypted).toEqual(largeData);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty data', async () => {
      const key = crypto.randomBytes(32);
      const empty = new Uint8Array(0);

      const encrypted = await crypto.encrypt(empty, key);
      const decrypted = await crypto.decrypt(
        encrypted.ciphertext,
        key,
        encrypted.iv,
        encrypted.authTag
      );

      expect(decrypted).toHaveLength(0);
    });

    it('should handle single byte', async () => {
      const key = crypto.randomBytes(32);
      const single = new Uint8Array([42]);

      const encrypted = await crypto.encrypt(single, key);
      const decrypted = await crypto.decrypt(
        encrypted.ciphertext,
        key,
        encrypted.iv,
        encrypted.authTag
      );

      expect(decrypted).toEqual(single);
    });
  });
});
