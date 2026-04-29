/**
 * StamperUploader - Client-side chunk stamping and upload
 *
 * Enables device-agnostic uploads through any public Swarm gateway by
 * signing chunks client-side with a Stamper instead of requiring the
 * Bee node to own the postage batch.
 *
 * Supports:
 * - Arbitrary data upload (any size, automatic BMT tree construction)
 * - Feed reference writes (SOC-based, replaces feedWriter.uploadReference)
 */

import {
  Bee,
  Stamper,
  Reference,
  PrivateKey,
  Topic,
  FeedIndex,
  Identifier,
  Bytes,
} from '@ethersphere/bee-js';
import type {
  Chunk as BeeChunk,
  SingleOwnerChunk,
} from '@ethersphere/bee-js';
import { buildTree, type StampableChunk } from './bmt.js';

/** Concatenate multiple Uint8Arrays into one */
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/** Encode a bigint as 8-byte big-endian Uint8Array */
function uint64BE(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, value, false);
  return bytes;
}

/**
 * Compute the feed identifier for a given topic and index.
 * Equivalent to bee-js internal `makeFeedIdentifier(topic, index)`.
 *
 * identifier = keccak256(topic || index)
 */
function makeFeedIdentifier(topic: Topic, index: FeedIndex): Identifier {
  const data = concatBytes(topic.toUint8Array(), index.toUint8Array());
  return new Identifier(Bytes.keccak256(data));
}

export interface WriteFeedOptions {
  /** Explicit feed index. If omitted, the next index is found automatically. */
  index?: number | FeedIndex;
}

export class StamperUploader {
  constructor(
    private readonly bee: Bee,
    private readonly stamper: Stamper,
  ) {}

  /**
   * Upload arbitrary data to Swarm, returning its content reference.
   *
   * Splits data into 4096-byte chunks, builds the BMT tree, stamps each
   * chunk client-side, and uploads via the chunks API. The returned
   * reference can be downloaded with `bee.downloadData(ref)`.
   *
   * @param data Raw bytes to upload (any size)
   * @returns The Swarm reference (root hash of the BMT tree)
   */
  async upload(data: Uint8Array): Promise<Reference> {
    return buildTree(data, async (chunk: StampableChunk) => {
      const envelope = this.stamper.stamp(chunk as any);
      await this.bee.uploadChunk(envelope, chunk.build());
    });
  }

  /**
   * Write a reference to a Swarm feed.
   *
   * Creates a SOC (Single Owner Chunk) containing a timestamped reference,
   * stamps it client-side, and uploads it. This replaces the pattern:
   *
   *   feedWriter.uploadReference(batchId, reference)
   *
   * The resulting feed entry is readable by standard feed readers
   * (`bee.makeFeedReader(topic, owner).downloadReference()`).
   *
   * @param topic   Feed topic (32 bytes or string)
   * @param reference The Swarm reference to store in the feed
   * @param signer  Private key for signing the SOC
   * @param options Optional: explicit feed index
   */
  async writeFeedReference(
    topic: Topic | string,
    reference: Reference,
    signer: PrivateKey | string,
    options?: WriteFeedOptions,
  ): Promise<void> {
    const signerKey = typeof signer === 'string' ? new PrivateKey(signer) : signer;
    const topicBytes = typeof topic === 'string' ? Topic.fromString(topic) : topic;
    const ownerAddress = signerKey.publicKey().address();

    // 1. Determine feed index
    let feedIndex: FeedIndex;
    if (options?.index !== undefined) {
      feedIndex = typeof options.index === 'number'
        ? FeedIndex.fromBigInt(BigInt(options.index))
        : options.index;
    } else {
      // Find the latest feed index and use the next one
      const reader = this.bee.makeFeedReader(topicBytes, ownerAddress);
      try {
        const latest = await reader.downloadReference();
        feedIndex = latest.feedIndexNext ?? latest.feedIndex.next();
      } catch {
        // Feed doesn't exist yet - start at 0
        feedIndex = FeedIndex.fromBigInt(0n);
      }
    }

    // 2. Create feed identifier = keccak256(topic || index)
    const identifier = makeFeedIdentifier(topicBytes, feedIndex);

    // 3. Build payload: timestamp (8 bytes BE) + reference (32 bytes)
    //    This matches the format that feedReader.downloadReference() expects.
    const timestamp = uint64BE(BigInt(Math.floor(Date.now() / 1000)));
    const payloadBytes = concatBytes(timestamp, reference.toUint8Array());

    // 4. Create CAC from payload
    const cac = this.bee.makeContentAddressedChunk(payloadBytes);

    // 5. Convert to SOC
    const soc: SingleOwnerChunk = cac.toSingleOwnerChunk(identifier, signerKey);

    // 6. Stamp the SOC using its address for bucket selection
    const stampable: StampableChunk = {
      span: 0n, // unused by stamp()
      build: () => new Uint8Array(0), // unused by stamp()
      hash: () => soc.address.toUint8Array(),
    };
    const envelope = this.stamper.stamp(stampable as any);

    // 7. Upload the SOC
    await this.bee.uploadChunk(envelope, soc);
  }
}
