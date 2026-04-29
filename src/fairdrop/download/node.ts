/**
 * Node.js DownloadProvider Implementation
 *
 * Uses fs.writeFile for file output.
 * DOM-based methods throw errors (use writeFile instead).
 */

import { writeFileSync } from 'fs'
import type { DownloadProvider } from '../adapters/types.js'

/**
 * Node.js download provider
 */
export class NodeDownloadProvider implements DownloadProvider {
  createObjectURL(_blob: Blob): string {
    throw new Error('createObjectURL is not supported in Node.js. Use writeFile instead.')
  }

  revokeObjectURL(_url: string): void {
    // No-op in Node.js
  }

  triggerDownload(_blob: Blob, _filename: string): void {
    throw new Error('triggerDownload is not supported in Node.js. Use writeFile instead.')
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    writeFileSync(path, data)
  }
}
