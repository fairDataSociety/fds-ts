/**
 * PublishService — public (unencrypted) data on Swarm.
 *
 * publish() uploads WITHOUT encryption. Anyone with the reference can read.
 * This is the explicit opt-out from encryption-by-default.
 */

import type { StorageAdapter } from '../adapters/interface.js'
import { FdsError, FdsErrorCode } from '../errors.js'

export interface PublishOptions {
  filename?: string
  contentType?: string
  directory?: boolean
}

export interface PublishResult {
  reference: string
  url?: string
}

export class PublishService {
  private adapter?: StorageAdapter

  init(adapter: StorageAdapter): void {
    this.adapter = adapter
  }

  /** Publish data publicly (unencrypted). Stores in __public bucket. */
  async upload(data: string | Buffer | Uint8Array, opts?: PublishOptions): Promise<PublishResult> {
    if (!this.adapter) {
      throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'PublishService not initialized')
    }

    const bytes = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array ? data : new Uint8Array(data)

    const filename = opts?.filename || `pub-${Date.now()}`

    if (!(await this.adapter.bucketExists('__public'))) {
      await this.adapter.createBucket('__public')
    }

    // Store UNENCRYPTED — this is the publish path
    const result = await this.adapter.put('__public', filename, bytes, {
      contentType: opts?.contentType,
    })

    return {
      reference: result.reference || `__public/${filename}`,
    }
  }

  /** Batch publish multiple items. */
  async batch(items: Array<{ data: string | Buffer | Uint8Array; filename: string }>): Promise<PublishResult[]> {
    const results: PublishResult[] = []
    for (const item of items) {
      results.push(await this.upload(item.data, { filename: item.filename }))
    }
    return results
  }
}
