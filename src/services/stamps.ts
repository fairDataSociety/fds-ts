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

export class StampService {
  private adapter?: StorageAdapter
  private assignedBatchId?: string

  init(adapter: StorageAdapter): void {
    this.adapter = adapter
  }

  /** Get stamp status. */
  async status(): Promise<StampInfo> {
    if (this.assignedBatchId) {
      return {
        available: true,
        batchId: this.assignedBatchId,
        canUpload: true,
      }
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

  /** Get first usable stamp. */
  async getUsable(): Promise<string | null> {
    return this.assignedBatchId ?? null
  }

  /** Top up an existing stamp. */
  async topup(batchId: string, amount: number): Promise<void> {
    // Requires Bee API: POST /stamps/topup/{id}/{amount}
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Stamp topup requires direct Bee API access')
  }
}
