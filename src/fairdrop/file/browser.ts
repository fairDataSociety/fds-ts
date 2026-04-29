/**
 * Browser FileProvider Implementation
 *
 * Uses native Blob and File APIs.
 */

import type { FileProvider } from '../adapters/types.js'

/**
 * Browser file provider using native APIs
 */
export class BrowserFileProvider implements FileProvider {
  createBlob(data: Uint8Array, options?: { type?: string }): Blob {
    return new Blob([data], { type: options?.type ?? 'application/octet-stream' })
  }

  async readAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return blob.arrayBuffer()
  }

  async readFile(_path: string): Promise<Uint8Array> {
    throw new Error('readFile is not supported in browser. Use File input instead.')
  }

  createFile(data: Uint8Array, name: string, options?: { type?: string }): File {
    return new File([data], name, { type: options?.type ?? 'application/octet-stream' })
  }
}
