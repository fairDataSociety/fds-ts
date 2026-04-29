/**
 * PublishService — public (unencrypted) data on Swarm.
 *
 * publish() uploads WITHOUT encryption. Anyone with the reference can read.
 * This is the explicit opt-out from encryption-by-default.
 *
 * With Bee: real /bzz upload, returns Swarm reference (immutable, content-addressed).
 * Without Bee: stores in __public bucket of the configured adapter (local mode).
 */

import type { StorageAdapter } from '../adapters/interface.js'
import { FdsError, FdsErrorCode } from '../errors.js'

export interface PublishOptions {
  filename?: string
  contentType?: string
  /** If true and Bee available, upload via /bzz (with manifest). Default: /bzz. */
  directory?: boolean
}

export interface PublishResult {
  reference: string
  url?: string
}

interface BeeLike {
  uploadData(batchId: string, data: Uint8Array, opts?: any): Promise<{ reference: { toString(): string } }>
  uploadFile?(
    batchId: string,
    data: Uint8Array | string,
    name?: string,
    opts?: any,
  ): Promise<{ reference: { toString(): string } }>
}

export class PublishService {
  private adapter?: StorageAdapter
  private bee?: BeeLike
  private batchId?: string

  init(adapter: StorageAdapter, bee?: BeeLike, batchId?: string): void {
    this.adapter = adapter
    this.bee = bee
    this.batchId = batchId
  }

  /**
   * Publish data publicly (unencrypted).
   *
   * Bee mode: uploads via /bzz endpoint, returns Swarm reference (mutable via feeds).
   * Local mode: stores in `__public` bucket as plaintext.
   */
  async upload(data: string | Buffer | Uint8Array, opts?: PublishOptions): Promise<PublishResult> {
    if (!this.adapter && !this.bee) {
      throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'PublishService not initialized')
    }

    const bytes = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array ? data : new Uint8Array(data)

    const filename = opts?.filename || `pub-${Date.now()}`

    // ── Bee mode: real Swarm upload ────────────────────────
    if (this.bee && this.batchId) {
      try {
        // Prefer uploadFile for content-typed access via /bzz; falls back to uploadData
        let ref: string
        if (this.bee.uploadFile && opts?.filename) {
          const result = await this.bee.uploadFile(this.batchId, bytes, opts.filename, {
            contentType: opts.contentType,
          })
          ref = result.reference.toString()
        } else {
          const result = await this.bee.uploadData(this.batchId, bytes)
          ref = result.reference.toString()
        }
        return { reference: ref, url: `bzz://${ref}` }
      } catch (e: any) {
        throw new FdsError(FdsErrorCode.NO_STORAGE, `Swarm upload failed: ${e?.message || e}`)
      }
    }

    // ── Local mode: write to __public bucket ───────────────
    if (!this.adapter) {
      throw new FdsError(FdsErrorCode.NO_STORAGE, 'No storage available for publish')
    }

    if (!(await this.adapter.bucketExists('__public'))) {
      try { await this.adapter.createBucket('__public') }
      catch (e: any) { if (e?.code !== 'BUCKET_EXISTS') throw e }
    }

    const result = await this.adapter.put('__public', filename, bytes, {
      contentType: opts?.contentType,
    })

    return {
      reference: result.reference || `__public/${filename}`,
    }
  }

  /** Batch publish multiple items. */
  async batch(items: Array<{ data: string | Buffer | Uint8Array; filename: string; contentType?: string }>): Promise<PublishResult[]> {
    const results: PublishResult[] = []
    for (const item of items) {
      results.push(await this.upload(item.data, { filename: item.filename, contentType: item.contentType }))
    }
    return results
  }
}
