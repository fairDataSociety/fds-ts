/**
 * FileManager Encryption Tests
 *
 * Validates that FileManager correctly:
 * - Encrypts files before upload to Bee
 * - Derives unique keys per file
 * - Decrypts files on download
 * - Handles file index operations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileManager } from './FileManager';
import type { Bee } from '@ethersphere/bee-js';

// ============================================================================
// Mock Bee
// ============================================================================

/**
 * Mock Bee client for testing
 * Stores uploaded data in memory
 */
class MockBee implements Partial<Bee> {
  private storage: Map<string, Uint8Array> = new Map();
  private referenceCounter = 0;

  async uploadData(
    postageBatchId: string,
    data: string | Uint8Array
  ): Promise<{ reference: string }> {
    const dataArray = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const reference = `mock-ref-${this.referenceCounter++}`;
    this.storage.set(reference, new Uint8Array(dataArray));
    return { reference };
  }

  async downloadData(reference: string): Promise<{ toUint8Array(): Uint8Array }> {
    const data = this.storage.get(reference);
    if (!data) {
      throw new Error(`Reference not found: ${reference}`);
    }
    // Mock Bytes object from bee-js v10
    return {
      toUint8Array: () => data
    };
  }

  // Helper for tests
  getRawData(reference: string): Uint8Array | undefined {
    return this.storage.get(reference);
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('FileManager Encryption', () => {
  let fileManager: FileManager;
  let mockBee: MockBee;
  let podKey: Uint8Array;

  beforeEach(() => {
    mockBee = new MockBee();
    fileManager = new FileManager({
      beeUrl: 'http://localhost:1633',
      postageBatchId: 'test-batch-id',
      bee: mockBee as any,
    });

    // Test encryption key (32 bytes)
    podKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      podKey[i] = i;
    }
  });

  describe('Upload with Encryption', () => {
    it('should encrypt file with AES-GCM before upload to Bee', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const fileInfo = await fileManager.upload(
        'testpod',
        '/secret.txt',
        plaintext,
        podKey
      );

      // Verify file info
      expect(fileInfo.encrypted).toBe(true);
      expect(fileInfo.encryptionVersion).toBe(1);
      expect(fileInfo.iv).toBeDefined();
      expect(fileInfo.authTag).toBeDefined();
      expect(fileInfo.swarmRef).toBeDefined();

      // Verify raw data on Bee is encrypted (not plaintext)
      const rawData = mockBee.getRawData(fileInfo.swarmRef!);
      expect(rawData).toBeDefined();
      expect(rawData).not.toEqual(plaintext);

      console.log('Original plaintext:', plaintext);
      console.log('Encrypted ciphertext:', rawData);
    });

    it('should store encryption metadata in FileInfo', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const fileInfo = await fileManager.upload(
        'testpod',
        '/secret.txt',
        plaintext,
        podKey
      );

      // Check metadata
      expect(fileInfo.name).toBe('secret.txt');
      expect(fileInfo.path).toBe('/secret.txt');
      expect(fileInfo.size).toBe(5);
      expect(fileInfo.encrypted).toBe(true);
      expect(fileInfo.encryptionVersion).toBe(1);

      // Check encryption details
      expect(fileInfo.iv).toMatch(/^[0-9a-f]{24}$/); // 12 bytes = 24 hex chars
      expect(fileInfo.authTag).toMatch(/^[0-9a-f]{32}$/); // 16 bytes = 32 hex chars
    });

    it('should use different keys for different file paths', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const file1 = await fileManager.upload(
        'testpod',
        '/file1.txt',
        plaintext,
        podKey
      );

      const file2 = await fileManager.upload(
        'testpod',
        '/file2.txt',
        plaintext,
        podKey
      );

      // Get raw ciphertexts from Bee
      const cipher1 = mockBee.getRawData(file1.swarmRef!);
      const cipher2 = mockBee.getRawData(file2.swarmRef!);

      // Ciphertexts should be different (different per-file keys)
      expect(cipher1).not.toEqual(cipher2);

      console.log('File 1 ciphertext:', cipher1);
      console.log('File 2 ciphertext:', cipher2);
    });

    it('should support unencrypted uploads when explicitly disabled', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const fileInfo = await fileManager.upload(
        'testpod',
        '/public.txt',
        plaintext,
        podKey,
        { unencrypted: true }
      );

      // Verify not encrypted
      expect(fileInfo.encrypted).toBe(false);
      expect(fileInfo.encryptionVersion).toBeUndefined();
      expect(fileInfo.iv).toBeUndefined();
      expect(fileInfo.authTag).toBeUndefined();

      // Raw data should equal plaintext
      const rawData = mockBee.getRawData(fileInfo.swarmRef!);
      expect(rawData).toEqual(plaintext);
    });
  });

  describe('Download with Decryption', () => {
    it('should decrypt file correctly on download', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      // Upload
      await fileManager.upload('testpod', '/secret.txt', plaintext, podKey);

      // Download
      const downloaded = await fileManager.download('testpod', '/secret.txt', podKey);

      // Should match original plaintext
      expect(Buffer.from(downloaded)).toEqual(Buffer.from(plaintext));
    });

    it('should verify auth tag during decryption', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      // Upload
      const fileInfo = await fileManager.upload(
        'testpod',
        '/secret.txt',
        plaintext,
        podKey
      );

      // Tamper with ciphertext in Bee storage
      const rawData = mockBee.getRawData(fileInfo.swarmRef!);
      if (rawData) {
        rawData[0] ^= 0xFF; // Flip bits
      }

      // Download should fail (authentication error)
      await expect(
        fileManager.download('testpod', '/secret.txt', podKey)
      ).rejects.toThrow();
    });

    it('should throw error for non-existent file', async () => {
      await expect(
        fileManager.download('testpod', '/nonexistent.txt', podKey)
      ).rejects.toThrow(/File not found/);
    });
  });

  describe('File Listing', () => {
    beforeEach(async () => {
      // Upload test files
      await fileManager.upload(
        'testpod',
        '/file1.txt',
        new Uint8Array([1, 2, 3]),
        podKey
      );

      await fileManager.upload(
        'testpod',
        '/file2.txt',
        new Uint8Array([4, 5, 6]),
        podKey
      );

      await fileManager.upload(
        'testpod',
        '/subdir/file3.txt',
        new Uint8Array([7, 8, 9]),
        podKey
      );
    });

    it('should list files in root directory', async () => {
      const files = await fileManager.list('testpod', '/', podKey);

      // Should return root-level files only
      const filePaths = files.map(f => f.path);
      expect(filePaths).toContain('/file1.txt');
      expect(filePaths).toContain('/file2.txt');
      expect(filePaths).not.toContain('/subdir/file3.txt');
    });

    it('should list all files recursively', async () => {
      const files = await fileManager.listAll('testpod', podKey);

      expect(files).toHaveLength(3);
      const filePaths = files.map(f => f.path);
      expect(filePaths).toContain('/file1.txt');
      expect(filePaths).toContain('/file2.txt');
      expect(filePaths).toContain('/subdir/file3.txt');
    });
  });

  describe('File Deletion', () => {
    it('should delete file from index', async () => {
      // Upload
      await fileManager.upload(
        'testpod',
        '/temp.txt',
        new Uint8Array([1, 2, 3]),
        podKey
      );

      // Verify exists
      const existsBefore = await fileManager.exists('testpod', '/temp.txt', podKey);
      expect(existsBefore).toBe(true);

      // Delete
      const deleted = await fileManager.delete('testpod', '/temp.txt', podKey);
      expect(deleted).toBe(true);

      // Verify deleted
      const existsAfter = await fileManager.exists('testpod', '/temp.txt', podKey);
      expect(existsAfter).toBe(false);
    });

    it('should return false when deleting non-existent file', async () => {
      const deleted = await fileManager.delete('testpod', '/nonexistent.txt', podKey);
      expect(deleted).toBe(false);
    });
  });

  describe('File Info', () => {
    it('should retrieve file info without downloading', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      await fileManager.upload('testpod', '/test.txt', plaintext, podKey);

      const info = await fileManager.getInfo('testpod', '/test.txt', podKey);

      expect(info).not.toBeNull();
      expect(info!.path).toBe('/test.txt');
      expect(info!.size).toBe(5);
      expect(info!.encrypted).toBe(true);
      expect(info!.encryptionVersion).toBe(1);
    });

    it('should return null for non-existent file', async () => {
      const info = await fileManager.getInfo('testpod', '/nonexistent.txt', podKey);
      expect(info).toBeNull();
    });
  });

  describe('Path Normalization', () => {
    it('should normalize paths without leading slash', async () => {
      const plaintext = new Uint8Array([1, 2, 3]);

      const fileInfo = await fileManager.upload(
        'testpod',
        'test.txt', // No leading slash
        plaintext,
        podKey
      );

      // Path should be normalized to /test.txt
      expect(fileInfo.path).toBe('/test.txt');
    });

    it('should handle paths with leading slash', async () => {
      const plaintext = new Uint8Array([1, 2, 3]);

      const fileInfo = await fileManager.upload(
        'testpod',
        '/test.txt',
        plaintext,
        podKey
      );

      expect(fileInfo.path).toBe('/test.txt');
    });
  });

  describe('Large Files', () => {
    it('should handle 1MB file encryption', async () => {
      // Create 1MB of data
      const largeFile = new Uint8Array(1024 * 1024);
      for (let i = 0; i < largeFile.length; i++) {
        largeFile[i] = i % 256;
      }

      // Upload
      const fileInfo = await fileManager.upload(
        'testpod',
        '/large.bin',
        largeFile,
        podKey
      );

      expect(fileInfo.size).toBe(1024 * 1024);

      // Download
      const downloaded = await fileManager.download('testpod', '/large.bin', podKey);

      // Verify matches
      expect(Buffer.from(downloaded)).toEqual(Buffer.from(largeFile));
    });
  });

  describe('Content Types', () => {
    it('should preserve content type', async () => {
      const plaintext = new Uint8Array([1, 2, 3]);

      const fileInfo = await fileManager.upload(
        'testpod',
        '/image.png',
        plaintext,
        podKey,
        { contentType: 'image/png' }
      );

      expect(fileInfo.contentType).toBe('image/png');
    });

    it('should default to application/octet-stream', async () => {
      const plaintext = new Uint8Array([1, 2, 3]);

      const fileInfo = await fileManager.upload(
        'testpod',
        '/unknown',
        plaintext,
        podKey
      );

      expect(fileInfo.contentType).toBe('application/octet-stream');
    });
  });

  describe('Cache Management', () => {
    it('should clear cache for specific pod', async () => {
      // Upload file to populate cache
      await fileManager.upload(
        'testpod',
        '/test.txt',
        new Uint8Array([1, 2, 3]),
        podKey
      );

      // Verify file exists (in cache)
      const existsBefore = await fileManager.exists('testpod', '/test.txt', podKey);
      expect(existsBefore).toBe(true);

      // Clear cache
      fileManager.clearCache('testpod');

      // NOTE: Without feed persistence (Phase 4), clearing cache loses the index
      // This is expected behavior until we implement feed-based loading
      // For now, verify that cache was cleared (file no longer in memory)
      const existsAfter = await fileManager.exists('testpod', '/test.txt', podKey);
      expect(existsAfter).toBe(false); // Expected: cache cleared means file lost

      console.log('Note: File lost after cache clear (feed persistence not yet implemented)');
    });

    it('should clear all caches', () => {
      fileManager.clearCache();
      // Just verify it doesn't throw
      expect(true).toBe(true);
    });
  });
});
