/**
 * Pod management for Fairdrive
 *
 * Pods are virtual drives on Swarm - the primary organizational unit.
 * Each pod has its own encryption context and can be shared independently.
 *
 * Implementation uses Swarm feeds for pod metadata storage.
 */

import { Bee, FeedWriter, Reference } from '@ethersphere/bee-js';
import { keccak256, toUtf8Bytes, computeAddress } from 'ethers';
import { ACT } from '../access/ACT.js';
import type { EncryptResult, ACTConfig } from '../access/ACT.js';
import type { StamperUploader } from '../upload/StamperUploader.js';

export interface Pod {
  name: string;
  createdAt: Date;
  swarmRef?: string;
  feedTopic?: string;
  isShared?: boolean;
  sharedBy?: string;
}

/**
 * Desktop format - PodsListIndex from feed.go
 */
interface PodsListIndex {
  version: number;
  updatedAt: number; // Unix timestamp
  pods: PodMeta[];
}

interface PodMeta {
  name: string;
  createdAt: number; // Unix timestamp
  isShared: boolean;
  sharedBy?: string;
}

export interface PodManagerConfig {
  beeUrl: string;
  postageBatchId?: string;
  // Private key as hex string for signing feed updates
  privateKey?: string;
  /** Optional Bee instance for dependency injection (testing) */
  bee?: Bee;
  /** Optional StamperUploader for client-side chunk stamping */
  stamperUploader?: StamperUploader;
}

// Topic prefix for pod feeds - must match desktop (feed.go)
const POD_TOPIC_PREFIX = 'fairdrive:pod:';
const POD_INDEX_TOPIC = 'fairdrive:pods'; // Must match desktop

export class PodManager {
  private config: PodManagerConfig;
  private bee: Bee;
  private stamperUploader?: StamperUploader;
  private pods: Map<string, Pod> = new Map();
  private initialized: boolean = false;

  constructor(config: PodManagerConfig) {
    this.config = config;
    this.bee = config.bee ?? new Bee(config.beeUrl);
    this.stamperUploader = config.stamperUploader;
  }

  /**
   * Initialize pod manager - load existing pods from feed
   * Parses desktop's PodsListIndex format from feed.go
   */
  async initialize(ownerAddress: string): Promise<void> {
    if (this.initialized) return;

    try {
      // Try to load pod index from feed
      const topic = this.getTopicHash(POD_INDEX_TOPIC);
      // bee-js v10: makeFeedReader(topic, owner)
      const feedReader = this.bee.makeFeedReader(topic, ownerAddress);

      try {
        // bee-js v10: downloadPayload() returns { reference, payload }
        const result = await feedReader.downloadPayload();
        const data = result.payload.toUint8Array();
        const jsonData = JSON.parse(new TextDecoder().decode(data));

        // Parse desktop format (PodsListIndex)
        if (jsonData.version && jsonData.pods && Array.isArray(jsonData.pods)) {
          const podsListIndex = jsonData as PodsListIndex;
          for (const podMeta of podsListIndex.pods) {
            const pod: Pod = {
              name: podMeta.name,
              createdAt: new Date(podMeta.createdAt * 1000), // Unix timestamp to Date
              feedTopic: this.getTopicHash(POD_TOPIC_PREFIX + podMeta.name),
              isShared: podMeta.isShared,
              sharedBy: podMeta.sharedBy,
            };
            this.pods.set(pod.name, pod);
          }
        } else if (Array.isArray(jsonData)) {
          // Legacy format: direct array of pods
          for (const item of jsonData) {
            const pod: Pod = {
              name: item.name,
              createdAt: new Date(item.createdAt),
              feedTopic: item.feedTopic,
            };
            this.pods.set(pod.name, pod);
          }
        }
      } catch (e) {
        // No existing pod index - start fresh
        console.log('No existing pod index found, starting fresh');
      }

      this.initialized = true;
    } catch (e) {
      // Feed doesn't exist yet - start fresh
      this.initialized = true;
    }
  }

  /**
   * Create a new pod
   */
  async create(name: string): Promise<Pod> {
    if (this.pods.has(name)) {
      throw new Error(`Pod "${name}" already exists`);
    }

    const pod: Pod = {
      name,
      createdAt: new Date(),
      feedTopic: this.getTopicHash(POD_TOPIC_PREFIX + name),
    };

    this.pods.set(name, pod);

    // Persist pod index if we have a postage batch
    if (this.config.postageBatchId && this.config.privateKey) {
      await this.persistPodIndex();
    }

    return pod;
  }

  /**
   * List all pods
   */
  async list(): Promise<Pod[]> {
    return Array.from(this.pods.values());
  }

  /**
   * Get a specific pod
   */
  async get(name: string): Promise<Pod | undefined> {
    return this.pods.get(name);
  }

  /**
   * Delete a pod (marks as deleted, doesn't remove data from Swarm)
   */
  async delete(name: string): Promise<boolean> {
    const deleted = this.pods.delete(name);

    if (deleted && this.config.postageBatchId && this.config.privateKey) {
      await this.persistPodIndex();
    }

    return deleted;
  }

  /**
   * Share pod with another user using ACT encryption.
   * Encrypts the pod encryption key with the recipient's public key and stores
   * the grant on Swarm.
   *
   * @param name - Pod name
   * @param recipientPublicKey - Recipient's public key (hex, with or without 0x)
   * @param ownerPrivateKey - Owner's private key (hex, with or without 0x)
   * @param podEncryptionKey - Pod's per-pod encryption key
   * @param ownerAddress - Owner's Ethereum address
   * @param ownerPublicKey - Owner's public key (hex)
   * @returns Object with actRef and feedTopic for the recipient
   */
  async share(
    name: string,
    recipientPublicKey: string,
    ownerPrivateKey?: string,
    podEncryptionKey?: Buffer,
    ownerAddress?: string,
    ownerPublicKey?: string
  ): Promise<{ actRef: string; feedTopic: string }> {
    const pod = this.pods.get(name);
    if (!pod) {
      throw new Error(`Pod "${name}" not found`);
    }

    const feedTopic = pod.feedTopic || this.getTopicHash(POD_TOPIC_PREFIX + name);

    // If we have ACT params, do full ACT sharing
    if (ownerPrivateKey && podEncryptionKey && this.config.postageBatchId && ownerAddress && ownerPublicKey) {
      const actConfig: ACTConfig = {
        beeUrl: this.config.beeUrl,
        postageBatchId: this.config.postageBatchId,
        bee: this.bee,
      };
      const act = new ACT(actConfig);

      // Convert owner private key hex to Uint8Array
      const privKeyHex = ownerPrivateKey.startsWith('0x') ? ownerPrivateKey.slice(2) : ownerPrivateKey;
      const privKeyBytes = new Uint8Array(Buffer.from(privKeyHex, 'hex'));

      // Derive recipient address from public key
      const recipientPubHex = recipientPublicKey.startsWith('0x') ? recipientPublicKey : '0x' + recipientPublicKey;
      const recipientAddress = computeAddress(recipientPubHex);

      // Encrypt the pod encryption key using ACT
      const result: EncryptResult = await act.encrypt(
        podEncryptionKey,
        ownerAddress,
        ownerPublicKey,
        privKeyBytes,
        [{ address: recipientAddress, publicKey: recipientPublicKey }]
      );

      // Mark pod as shared
      pod.isShared = true;
      if (this.config.postageBatchId && this.config.privateKey) {
        await this.persistPodIndex();
      }

      return { actRef: result.actRef, feedTopic };
    }

    // Fallback: return just the feed topic (no encryption)
    return { actRef: '', feedTopic };
  }

  /**
   * Receive a shared pod from another user.
   * Decrypts the pod encryption key using ACT and creates a local pod entry.
   *
   * @param actRef - ACT reference from the sharer
   * @param feedTopic - Feed topic of the shared pod
   * @param ownerAddress - Sharer's Ethereum address
   * @param callerPrivateKey - Receiver's private key for decryption (hex)
   * @param localName - Local name for the received pod
   * @param callerAddress - Receiver's Ethereum address
   * @returns The pod encryption key (for decrypting files)
   */
  async receive(
    actRef: string,
    feedTopic: string,
    ownerAddress: string,
    callerPrivateKey: string,
    localName: string,
    callerAddress?: string
  ): Promise<{ pod: Pod; podEncryptionKey: Buffer }> {
    if (!actRef) {
      throw new Error('ACT reference required for receiving shared pods');
    }

    const actConfig: ACTConfig = {
      beeUrl: this.config.beeUrl,
      postageBatchId: this.config.postageBatchId,
      bee: this.bee,
    };
    const act = new ACT(actConfig);

    // Convert private key hex to Uint8Array
    const privKeyHex = callerPrivateKey.startsWith('0x') ? callerPrivateKey.slice(2) : callerPrivateKey;
    const privKeyBytes = new Uint8Array(Buffer.from(privKeyHex, 'hex'));

    // Use provided address or derive a placeholder (the grant lookup uses address)
    const address = callerAddress || '0x0000000000000000000000000000000000000000';

    // Decrypt the pod encryption key
    const podEncryptionKey = await act.decrypt(actRef, address, privKeyBytes);

    // Create local pod entry
    const pod: Pod = {
      name: localName,
      createdAt: new Date(),
      feedTopic,
      isShared: true,
      sharedBy: ownerAddress,
    };

    this.pods.set(localName, pod);

    // Persist updated pod index
    if (this.config.postageBatchId && this.config.privateKey) {
      await this.persistPodIndex();
    }

    return { pod, podEncryptionKey: Buffer.from(podEncryptionKey) };
  }

  /**
   * Get feed writer for a pod
   * @param podName Pod name
   * @param privateKey Private key as hex string
   */
  getFeedWriter(podName: string, privateKey: string): FeedWriter {
    const topic = this.getTopicHash(POD_TOPIC_PREFIX + podName);
    // bee-js v10: makeFeedWriter(topic, signer)
    return this.bee.makeFeedWriter(topic, privateKey);
  }

  /**
   * Generate topic hash from string
   * @returns Topic hash as hex string (64 chars without 0x prefix)
   */
  private getTopicHash(topic: string): string {
    const hash = keccak256(toUtf8Bytes(topic));
    // Return first 32 bytes (64 hex chars) without 0x prefix
    return hash.slice(2, 66);
  }

  /**
   * Persist pod index to Swarm feed in desktop-compatible format
   */
  private async persistPodIndex(): Promise<void> {
    if (!this.config.postageBatchId || !this.config.privateKey) {
      return;
    }

    // Build desktop-compatible PodsListIndex
    const podsListIndex: PodsListIndex = {
      version: 1,
      updatedAt: Math.floor(Date.now() / 1000),
      pods: Array.from(this.pods.values()).map((pod) => ({
        name: pod.name,
        createdAt: Math.floor(pod.createdAt.getTime() / 1000),
        isShared: pod.isShared ?? false,
        sharedBy: pod.sharedBy,
      })),
    };

    const data = new TextEncoder().encode(JSON.stringify(podsListIndex));

    // Upload pod index data and update feed
    const topic = this.getTopicHash(POD_INDEX_TOPIC);

    if (this.stamperUploader) {
      // Client-side stamping path
      const ref = await this.stamperUploader.upload(new Uint8Array(data));
      await this.stamperUploader.writeFeedReference(
        topic,
        ref,
        this.config.privateKey!,
      );
    } else {
      // Legacy server-side stamping path
      const result = await this.bee.uploadData(
        this.config.postageBatchId!,
        data
      );

      // bee-js v10: makeFeedWriter(topic, signer)
      const writer = this.bee.makeFeedWriter(topic, this.config.privateKey!);

      try {
        // bee-js v10: uploadReference(postageBatchId, reference)
        await writer.uploadReference(this.config.postageBatchId!, result.reference);
      } catch (e: unknown) {
        // Handle first write case - feed doesn't exist yet
        if (e instanceof Error && e.message.includes('404')) {
          await writer.uploadReference(this.config.postageBatchId!, result.reference, {
            index: 0,
          });
        } else {
          throw e;
        }
      }
    }
  }
}
