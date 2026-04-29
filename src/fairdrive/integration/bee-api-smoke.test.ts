/**
 * Bee API Smoke Tests (No Postage Required)
 *
 * Tests that verify our Bee API usage is correct without needing postage stamps.
 * These tests check API method existence and basic functionality.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Bee } from '@ethersphere/bee-js';
import { ethers } from 'ethers';
import { keccak256, toUtf8Bytes } from 'ethers';

// Helper to create valid 64-char hex topic (same as FileManager.getFeedTopic)
function makeValidTopic(str: string): string {
  const hash = keccak256(toUtf8Bytes(str));
  return hash.slice(2, 66); // Remove 0x and get first 64 chars
}

const BEE_URL = 'http://localhost:1633';

describe('Bee API Smoke Tests (No Stamps)', () => {
  let bee: Bee;
  let beeAvailable = false;

  beforeAll(async () => {
    try {
      bee = new Bee(BEE_URL);
      const health = await fetch(`${BEE_URL}/health`);
      const data = await health.json();
      if (data.status === 'ok') {
        beeAvailable = true;
        console.log(`✓ Bee ${data.version} available`);
      }
    } catch (e) {
      console.warn('⚠ Bee not available - tests will be skipped');
      beeAvailable = false;
    }
  });

  describe('API Method Existence', () => {
    it('should have makeFeedReader method', () => {
      if (!beeAvailable) {
        console.log('⊘ Skipping - Bee not available');
        return;
      }

      expect(bee.makeFeedReader).toBeDefined();
      expect(typeof bee.makeFeedReader).toBe('function');
    });

    it('should have makeFeedWriter method', () => {
      if (!beeAvailable) {
        console.log('⊘ Skipping - Bee not available');
        return;
      }

      expect(bee.makeFeedWriter).toBeDefined();
      expect(typeof bee.makeFeedWriter).toBe('function');
    });

    it('should have uploadData method', () => {
      if (!beeAvailable) {
        console.log('⊘ Skipping - Bee not available');
        return;
      }

      expect(bee.uploadData).toBeDefined();
      expect(typeof bee.uploadData).toBe('function');
    });

    it('should have downloadData method', () => {
      if (!beeAvailable) {
        console.log('⊘ Skipping - Bee not available');
        return;
      }

      expect(bee.downloadData).toBeDefined();
      expect(typeof bee.downloadData).toBe('function');
    });
  });

  describe('Feed Writer/Reader Creation', () => {
    it('should create FeedWriter with wallet private key', () => {
      if (!beeAvailable) {
        console.log('⊘ Skipping - Bee not available');
        return;
      }

      const wallet = ethers.Wallet.createRandom();
      const topic = makeValidTopic('test-topic');

      // Should not throw
      const writer = bee.makeFeedWriter(topic, wallet.privateKey);

      expect(writer).toBeDefined();
      expect(writer.upload).toBeDefined();
      expect(typeof writer.upload).toBe('function');

      console.log('✓ FeedWriter created successfully');
      console.log('  - Has upload method');
    });

    it('should create FeedReader with wallet address', () => {
      if (!beeAvailable) {
        console.log('⊘ Skipping - Bee not available');
        return;
      }

      const wallet = ethers.Wallet.createRandom();
      const topic = makeValidTopic('test-topic');

      // Should not throw
      const reader = bee.makeFeedReader(topic, wallet.address);

      expect(reader).toBeDefined();
      expect(reader.download).toBeDefined();
      expect(typeof reader.download).toBe('function');

      console.log('✓ FeedReader created successfully');
      console.log('  - Has download method');
    });

    it('should accept string topic for feed operations', () => {
      if (!beeAvailable) {
        console.log('⊘ Skipping - Bee not available');
        return;
      }

      const wallet = ethers.Wallet.createRandom();

      // Test with properly hashed topic (64-char hex)
      const validTopic = makeValidTopic('my-string-topic');

      expect(() => {
        bee.makeFeedWriter(validTopic, wallet.privateKey);
      }).not.toThrow();

      expect(() => {
        bee.makeFeedReader(validTopic, wallet.address);
      }).not.toThrow();

      console.log('✓ String topics accepted');
    });
  });

  describe('API Signatures Match Our Usage', () => {
    it('makeFeedReader should accept (type, topic, owner)', () => {
      if (!beeAvailable) {
        console.log('⊘ Skipping - Bee not available');
        return;
      }

      const wallet = ethers.Wallet.createRandom();

      // This is how we call it in FileManager (with hashed topic)
      const topic = makeValidTopic('test-topic');
      const reader = bee.makeFeedReader(
        topic,                 // topic (64-char hex)
        wallet.address         // owner
      );

      expect(reader).toBeDefined();
      console.log('✓ makeFeedReader signature matches our usage');
    });

    it('makeFeedWriter should accept (type, topic, signer)', () => {
      if (!beeAvailable) {
        console.log('⊘ Skipping - Bee not available');
        return;
      }

      const wallet = ethers.Wallet.createRandom();

      // This is how we call it in FileManager (with hashed topic)
      const topic = makeValidTopic('test-topic');
      const writer = bee.makeFeedWriter(
        topic,                  // topic (64-char hex)
        wallet.privateKey       // signer (can be string)
      );

      expect(writer).toBeDefined();
      console.log('✓ makeFeedWriter signature matches our usage');
    });

    it('should accept privateKey without 0x prefix', () => {
      if (!beeAvailable) {
        console.log('⊘ Skipping - Bee not available');
        return;
      }

      const wallet = ethers.Wallet.createRandom();

      // Test with 0x prefix removed (as we do in CoreStorageAdapter)
      const privateKeyWithoutPrefix = wallet.privateKey.slice(2);
      const topic = makeValidTopic('test');

      expect(() => {
        bee.makeFeedWriter(topic, privateKeyWithoutPrefix);
      }).not.toThrow();

      console.log('✓ Private key without 0x prefix accepted');
    });
  });

  describe('Type Compatibility', () => {
    it('should work with ethers v6 wallet', () => {
      if (!beeAvailable) {
        console.log('⊘ Skipping - Bee not available');
        return;
      }

      // Create wallet using ethers v6 (same as WalletManager)
      const wallet = ethers.Wallet.createRandom();

      expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(wallet.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);

      // Should work with bee-js (using properly hashed topic)
      const topic = makeValidTopic('test');
      expect(() => {
        bee.makeFeedReader(topic, wallet.address);
        bee.makeFeedWriter(topic, wallet.privateKey);
      }).not.toThrow();

      console.log('✓ Compatible with ethers v6 Wallet');
    });
  });
});
