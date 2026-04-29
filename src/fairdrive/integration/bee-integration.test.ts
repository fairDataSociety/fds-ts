/**
 * Bee Integration Tests
 *
 * Tests actual Bee API calls with a real Bee node.
 * Requires:
 * - Bee node running at http://localhost:1633
 * - Valid postage batch available
 *
 * Run: npm test -- bee-integration.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Bee, Utils } from '@ethersphere/bee-js';
import { FileManager } from '../file/FileManager.js';
import { WalletManager } from '../identity/WalletManager.js';
import { ethers, keccak256, toUtf8Bytes } from 'ethers';

// Helper to create valid 64-char hex topic
function makeValidTopic(str: string): string {
  const hash = keccak256(toUtf8Bytes(str));
  return hash.slice(2, 66); // Remove 0x and get first 64 chars
}

const BEE_URL = 'http://localhost:1633';
const TEST_TIMEOUT = 30000; // 30 seconds for network operations

describe('Bee Integration Tests', () => {
  let bee: Bee;
  let postageBatchId: string | undefined;
  let beeAvailable = false;

  beforeAll(async () => {
    // Check if Bee is available
    try {
      bee = new Bee(BEE_URL);
      const health = await fetch(`${BEE_URL}/health`);
      const data = await health.json();

      if (data.status === 'ok') {
        beeAvailable = true;
        console.log(`✓ Bee ${data.version} available (API v${data.apiVersion})`);

        // Get or create a usable postage batch
        postageBatchId = await getUsablePostageBatch(bee);

        if (postageBatchId) {
          console.log(`✓ Using postage batch: ${postageBatchId}`);
        } else {
          console.warn('⚠ No valid postage batch available - some tests will be skipped');
        }
      }
    } catch (e) {
      console.warn('⚠ Bee node not available at', BEE_URL);
      console.warn('  Start Bee with: bee dev');
      beeAvailable = false;
    }
  }, TEST_TIMEOUT);

  describe('Bee Node Health', () => {
    it('should connect to Bee node', async () => {
      if (!beeAvailable) {
        console.log('⊘ Skipping - Bee not available');
        return;
      }

      const response = await fetch(`${BEE_URL}/health`);
      const data = await response.json();

      expect(data.status).toBe('ok');
      expect(data.version).toBeDefined();
      expect(data.apiVersion).toBeDefined();
    });

    it('should have postage batch available or skip tests gracefully', async () => {
      if (!beeAvailable) {
        console.log('⊘ Skipping - Bee not available');
        return;
      }

      if (!postageBatchId) {
        console.log('⊘ No postage batch - integration tests will be skipped');
        console.log('  This is OK for testing without stamps');
        return; // Don't fail, just skip
      }

      expect(postageBatchId).toBeDefined();
      expect(typeof postageBatchId).toBe('string');
    });
  });

  describe('Postage Batch Validation', () => {
    it('should have usable postage batch with sufficient depth and amount', async () => {
      if (!beeAvailable || !postageBatchId) {
        console.log('⊘ Skipping - Bee not available or no batch');
        return;
      }

      const response = await fetch(`${BEE_URL}/stamps/${postageBatchId}`);
      const stamp = await response.json();

      console.log('Stamp details:', {
        batchID: stamp.batchID,
        depth: stamp.depth,
        bucketDepth: stamp.bucketDepth,
        utilization: stamp.utilization,
        usable: stamp.usable,
        batchTTL: stamp.batchTTL,
      });

      expect(stamp.usable).toBe(true);
      expect(stamp.depth).toBeGreaterThanOrEqual(17); // Minimum depth (adjusted for available stamps)
      expect(stamp.batchTTL).toBeGreaterThan(0); // Should have time remaining
    });
  });

  describe('Basic Bee Operations', () => {
    it('should upload and download raw data', async () => {
      if (!beeAvailable || !postageBatchId) {
        console.log('⊘ Skipping - Bee not available or no batch');
        return;
      }

      const testData = new Uint8Array([1, 2, 3, 4, 5]);

      // Upload
      const uploadResult = await bee.uploadData(postageBatchId, testData);
      expect(uploadResult.reference).toBeDefined();

      console.log(`✓ Uploaded data, reference: ${uploadResult.reference}`);

      // Download - bee-js v10+: reference is an object, convert to string
      const refString = typeof uploadResult.reference === 'string'
        ? uploadResult.reference
        : uploadResult.reference.toString();
      const downloadedBytes = await bee.downloadData(refString);
      // v10 returns Bytes object, need to convert to Uint8Array
      const downloadedData = downloadedBytes.toUint8Array();
      expect(Buffer.from(downloadedData)).toEqual(Buffer.from(testData));

      console.log('✓ Downloaded and verified data');
    }, TEST_TIMEOUT);
  });

  describe('Feed Operations', () => {
    it('should create feed writer and reader with wallet', async () => {
      if (!beeAvailable || !postageBatchId) {
        console.log('⊘ Skipping - Bee not available or no batch');
        return;
      }

      // Create test wallet
      const wallet = ethers.Wallet.createRandom();
      const topic = makeValidTopic('test-feed-topic');

      console.log('Test wallet address:', wallet.address);
      console.log('Test topic:', topic);

      // Create feed writer - bee-js v10+: no type parameter
      const writer = bee.makeFeedWriter(topic, wallet.privateKey);
      expect(writer).toBeDefined();

      // Upload test data
      const testData = new Uint8Array([10, 20, 30]);
      const uploadResult = await bee.uploadData(postageBatchId, testData);

      console.log(`✓ Uploaded feed data, reference: ${uploadResult.reference}`);

      // Write reference to feed - pass hex string directly
      try {
        await writer.upload(postageBatchId, uploadResult.reference);
        console.log('✓ Feed write successful');
      } catch (e: any) {
        // First write might need index: 0
        if (e.message.includes('404')) {
          await writer.upload(postageBatchId, uploadResult.reference, { index: 0 });
          console.log('✓ Feed write successful (first write with index: 0)');
        } else {
          throw e;
        }
      }

      // Create feed reader - bee-js v10+: no type parameter
      const reader = bee.makeFeedReader(topic, wallet.address);
      expect(reader).toBeDefined();

      // Read from feed - bee-js v10+ has proper binary handling
      const result = await reader.downloadPayload();
      const feedData: Uint8Array = result.payload.bytes;

      console.log('Feed data:', feedData);
      console.log('Expected data:', testData);

      // The feed should return the original test data
      expect(Buffer.from(feedData)).toEqual(Buffer.from(testData));

      console.log('✓ Feed returned original data correctly');
    }, TEST_TIMEOUT);

    it('should update feed and retrieve latest', async () => {
      if (!beeAvailable || !postageBatchId) {
        console.log('⊘ Skipping - Bee not available or no batch');
        return;
      }

      const wallet = ethers.Wallet.createRandom();
      const topic = makeValidTopic('test-feed-update');
      // bee-js v10+: no type parameter
      const writer = bee.makeFeedWriter(topic, wallet.privateKey);

      // Write first update
      const data1 = new Uint8Array([1, 1, 1]);
      const upload1 = await bee.uploadData(postageBatchId, data1);
      await writer.upload(postageBatchId, upload1.reference, { index: 0 });

      console.log('✓ First feed update written');

      // Write second update
      const data2 = new Uint8Array([2, 2, 2]);
      const upload2 = await bee.uploadData(postageBatchId, data2);
      await writer.upload(postageBatchId, upload2.reference);

      console.log('✓ Second feed update written');

      // Read - should get latest (second update) DATA directly
      // bee-js v10+: no type parameter
      const reader = bee.makeFeedReader(topic, wallet.address);
      const result = await reader.downloadPayload();
      const feedData: Uint8Array = result.payload.bytes;

      // Feed returns the data at upload2.reference (which is data2)
      expect(Buffer.from(feedData)).toEqual(Buffer.from(data2));

      console.log('✓ Retrieved latest feed update');
    }, TEST_TIMEOUT);
  });

  describe('FileManager with Real Bee', () => {
    it('should upload and download encrypted file', async () => {
      if (!beeAvailable || !postageBatchId) {
        console.log('⊘ Skipping - Bee not available or no batch');
        return;
      }

      // Create wallet for feed operations
      const walletManager = new WalletManager();
      const { wallet, mnemonic } = await walletManager.create();
      const hdNode = walletManager.getHDNode();

      console.log('Created wallet:', wallet.address);

      // Create FileManager with wallet credentials
      const fileManager = new FileManager({
        beeUrl: BEE_URL,
        postageBatchId: postageBatchId,
        ownerAddress: wallet.address,
        privateKey: hdNode!.privateKey.slice(2), // Remove 0x prefix
      });

      // Derive pod key
      const podKey = await walletManager.deriveKey('testpod');

      // Upload file
      const testContent = Buffer.from('Integration test secret data');
      const fileInfo = await fileManager.upload(
        'testpod',
        '/integration-test.txt',
        testContent,
        podKey,
        { contentType: 'text/plain' }
      );

      console.log('✓ File uploaded');
      console.log('  - Path:', fileInfo.path);
      console.log('  - Encrypted:', fileInfo.encrypted);
      console.log('  - Swarm ref:', fileInfo.swarmRef);

      expect(fileInfo.encrypted).toBe(true);
      expect(fileInfo.encryptionVersion).toBe(1);
      expect(fileInfo.swarmRef).toBeDefined();

      // Download file
      const downloaded = await fileManager.download('testpod', '/integration-test.txt', podKey);

      expect(Buffer.from(downloaded)).toEqual(testContent);

      console.log('✓ File downloaded and decrypted successfully');

      // Verify raw data on Bee is encrypted (not plaintext)
      const rawDataBytes = await bee.downloadData(fileInfo.swarmRef!);
      const rawData = rawDataBytes.toUint8Array();
      expect(Buffer.from(rawData)).not.toEqual(testContent);

      console.log('✓ Verified data on Bee is encrypted');

      // Clean up
      podKey.fill(0);
    }, TEST_TIMEOUT);

    it('should persist and load file index via feeds', async () => {
      if (!beeAvailable || !postageBatchId) {
        console.log('⊘ Skipping - Bee not available or no batch');
        return;
      }

      // Create wallet
      const walletManager = new WalletManager();
      const { wallet } = await walletManager.create();
      const hdNode = walletManager.getHDNode();

      // Create FileManager with feed support
      const fileManager = new FileManager({
        beeUrl: BEE_URL,
        postageBatchId: postageBatchId,
        ownerAddress: wallet.address,
        privateKey: hdNode!.privateKey.slice(2),
      });

      const podKey = await walletManager.deriveKey('indexpod');

      // Upload multiple files
      await fileManager.upload('indexpod', '/file1.txt', Buffer.from('data1'), podKey);
      await fileManager.upload('indexpod', '/file2.txt', Buffer.from('data2'), podKey);
      await fileManager.upload('indexpod', '/subdir/file3.txt', Buffer.from('data3'), podKey);

      console.log('✓ Uploaded 3 files');

      // Create new FileManager instance (simulates app restart)
      const fileManager2 = new FileManager({
        beeUrl: BEE_URL,
        postageBatchId: postageBatchId,
        ownerAddress: wallet.address,
        privateKey: hdNode!.privateKey.slice(2),
      });

      // List files - should load from feed
      const files = await fileManager2.listAll('indexpod', podKey);

      expect(files).toHaveLength(3);
      expect(files.map(f => f.path)).toContain('/file1.txt');
      expect(files.map(f => f.path)).toContain('/file2.txt');
      expect(files.map(f => f.path)).toContain('/subdir/file3.txt');

      console.log('✓ Index loaded from feed successfully');
      console.log('  Files found:', files.map(f => f.path));

      // Clean up
      podKey.fill(0);
    }, TEST_TIMEOUT);
  });
});

/**
 * Get a usable postage batch from Bee node
 */
async function getUsablePostageBatch(bee: Bee): Promise<string | undefined> {
  try {
    // Get all postage batches
    const response = await fetch(`${BEE_URL}/stamps`);
    const data = await response.json();
    const stamps = data.stamps || [];

    if (stamps.length === 0) {
      console.warn('⚠ No postage batches found');
      console.warn('  Create one with: curl -X POST http://localhost:1633/stamps/10000000/20');
      return undefined;
    }

    // Find a usable batch
    for (const stamp of stamps) {
      if (stamp.usable && stamp.batchTTL > 0) {
        return stamp.batchID;
      }
    }

    console.warn('⚠ No usable postage batches found');
    console.warn('  All batches are either full or expired');
    return undefined;
  } catch (e) {
    console.error('Error getting postage batches:', e);
    return undefined;
  }
}
