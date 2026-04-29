/**
 * BMT (Binary Merkle Tree) construction for Swarm uploads
 *
 * Uses cafe-utility's MerkleTree (re-exported by bee-js) to split data into
 * 4096-byte chunks, build intermediate tree nodes, and produce a root reference.
 *
 * Each chunk (leaf and intermediate) is passed to an onChunk callback for
 * stamping and uploading. The root chunk's hash is the Swarm reference.
 */

import { MerkleTree, Reference } from '@ethersphere/bee-js';

/** Swarm chunk payload capacity */
export const CHUNK_PAYLOAD_SIZE = 4096;

/** Max children per intermediate node (4096 / 32 = 128) */
export const BRANCHES = 128;

/**
 * Minimal interface matching what cafe-utility MerkleTree provides in its
 * onChunk callback and what Stamper.stamp() consumes.
 *
 * The full cafe-utility Chunk has more fields, but stamp() only calls hash().
 */
export interface StampableChunk {
  /** Total bytes this chunk covers (leaf: payload size, intermediate: sum of child spans) */
  span: bigint;
  /** Returns span (8 bytes LE) + payload as Uint8Array */
  build(): Uint8Array;
  /** Returns the BMT hash (chunk address) as 32-byte Uint8Array */
  hash(): Uint8Array;
}

export type OnChunkCallback = (chunk: StampableChunk) => Promise<void>;

/**
 * Build a BMT tree from data and call onChunk for every chunk produced.
 *
 * For data <= 4096 bytes, produces a single leaf chunk.
 * For larger data, produces leaf chunks, intermediate nodes, and a root.
 * The onChunk callback is called for ALL chunks including the root.
 *
 * @returns The root chunk's hash as a Reference (the Swarm content address)
 */
export async function buildTree(
  data: Uint8Array,
  onChunk: OnChunkCallback,
): Promise<Reference> {
  // MerkleTree from cafe-utility handles all tree construction.
  // Its onChunk callback fires for every completed chunk (leaves,
  // intermediates, and root). finalize() returns the root chunk.
  const tree = new MerkleTree(
    (chunk) => onChunk(chunk as unknown as StampableChunk),
    CHUNK_PAYLOAD_SIZE,
  );

  await tree.append(data);
  const root = await tree.finalize();

  return new Reference((root as unknown as StampableChunk).hash());
}
