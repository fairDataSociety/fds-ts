/**
 * StampService — postage stamp management for Swarm uploads.
 *
 * Stamps are auto-checked by StorageService before upload.
 * This service exposes manual stamp management for power users.
 */

import type { StampInfo } from '../types.js'
import { FdsError, FdsErrorCode } from '../errors.js'

export class StampService {
  /** Get stamp status. */
  async status(): Promise<StampInfo> {
    // TODO: Wire to SwarmClient.getStamps
    return { available: false, canUpload: false }
  }

  /** Assign a specific postage batch ID. */
  async assign(batchId: string): Promise<void> {
    // TODO: Wire to adapter/Bee
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'StampService not yet wired')
  }

  /** Get first usable stamp from Bee node. */
  async getUsable(): Promise<string | null> {
    // TODO: Wire to SwarmClient.getUsableStamp
    return null
  }
}
