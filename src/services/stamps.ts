/**
 * StampService — postage stamp management.
 *
 * Stamps are auto-checked by StorageService before upload.
 * This service exposes manual stamp management for power users.
 *
 * On Swarm: stamps pay for storage. On other backends: no-op.
 */

import type { StampInfo } from '../types.js'
import type { StorageAdapter } from '../adapters/interface.js'
import { FdsError, FdsErrorCode } from '../errors.js'

interface BeeLike {
  getAllPostageBatch?(): Promise<any[]>
  getPostageBatch?(batchId: string): Promise<any>
  topUpBatch?(batchId: string, amount: bigint | string): Promise<unknown>
  diluteBatch?(batchId: string, depth: number): Promise<unknown>
  createPostageBatch?(amount: bigint | string, depth: number, opts?: any): Promise<{ batchID: string }>
}

export class StampService {
  private adapter?: StorageAdapter
  private assignedBatchId?: string
  private bee?: BeeLike

  init(adapter: StorageAdapter, bee?: BeeLike, batchId?: string): void {
    this.adapter = adapter
    this.bee = bee
    if (batchId) this.assignedBatchId = batchId
  }

  /** Get stamp status. With Bee, queries the assigned batch; otherwise infers from adapter. */
  async status(): Promise<StampInfo> {
    if (this.bee && this.assignedBatchId && this.bee.getPostageBatch) {
      try {
        const batch = await this.bee.getPostageBatch(this.assignedBatchId)
        return {
          available: !!batch,
          batchId: this.assignedBatchId,
          balance: Number(batch?.amount ?? 0),
          ttl: Number(batch?.batchTTL ?? 0),
          depth: Number(batch?.depth ?? 0),
          canUpload: !!batch?.usable,
        }
      } catch {
        return { available: false, canUpload: false, batchId: this.assignedBatchId }
      }
    }
    if (this.assignedBatchId) {
      return { available: true, batchId: this.assignedBatchId, canUpload: true }
    }
    // Non-Swarm adapters don't need stamps
    if (this.adapter && this.adapter.name !== 'swarm') {
      return { available: true, canUpload: true }
    }
    return { available: false, canUpload: false }
  }

  /** Assign a specific postage batch ID. */
  async assign(batchId: string): Promise<void> {
    this.assignedBatchId = batchId
  }

  /** Get first usable stamp from the configured Bee node. */
  async getUsable(): Promise<string | null> {
    if (this.assignedBatchId) return this.assignedBatchId
    if (!this.bee?.getAllPostageBatch) return null
    try {
      const batches = await this.bee.getAllPostageBatch()
      const usable = batches.find((b: any) => b.usable && BigInt(b.amount ?? 0) > 0n)
      return usable?.batchID ?? null
    } catch {
      return null
    }
  }

  /** Top up an existing stamp. Requires Bee. */
  async topup(batchId: string, amount: bigint | string): Promise<void> {
    if (!this.bee?.topUpBatch) {
      throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Stamp topup requires Bee node configuration')
    }
    await this.bee.topUpBatch(batchId, amount)
  }

  /** Dilute (increase depth of) a stamp to expand its capacity. Requires Bee. */
  async dilute(batchId: string, depth: number): Promise<void> {
    if (!this.bee?.diluteBatch) {
      throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Stamp dilute requires Bee node configuration')
    }
    await this.bee.diluteBatch(batchId, depth)
  }

  /**
   * Buy a new postage batch.
   * @param amount - Plur per chunk
   * @param depth - log2(chunks). Minimum 17 (≈4MB), typical 20 (≈32MB).
   */
  async buy(amount: bigint | string, depth: number, opts?: { label?: string }): Promise<string> {
    if (!this.bee?.createPostageBatch) {
      throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Stamp purchase requires Bee node configuration')
    }
    const result = await this.bee.createPostageBatch(amount, depth, opts)
    this.assignedBatchId = result.batchID
    return result.batchID
  }
}
