/**
 * Node.js FileProvider Implementation
 *
 * Uses fs module for file operations and Buffer for Blob-like behavior.
 */

import { readFileSync } from 'fs'
import type { FileProvider } from '../adapters/types.js'

/**
 * Simple Blob polyfill for Node.js
 * Node 18+ has native Blob, but this provides consistent behavior
 */
class NodeBlob {
  private readonly _data: Uint8Array
  readonly type: string
  readonly size: number

  constructor(parts: (Uint8Array | ArrayBuffer | string)[], options?: { type?: string }) {
    // Concatenate all parts into single Uint8Array
    const totalLength = parts.reduce((acc, part) => {
      if (typeof part === 'string') return acc + new TextEncoder().encode(part).length
      return acc + part.byteLength
    }, 0)

    this._data = new Uint8Array(totalLength)
    let offset = 0

    for (const part of parts) {
      if (typeof part === 'string') {
        const bytes = new TextEncoder().encode(part)
        this._data.set(bytes, offset)
        offset += bytes.length
      } else if (part instanceof ArrayBuffer) {
        this._data.set(new Uint8Array(part), offset)
        offset += part.byteLength
      } else {
        this._data.set(part, offset)
        offset += part.byteLength
      }
    }

    this.type = options?.type ?? 'application/octet-stream'
    this.size = totalLength
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this._data.buffer.slice(
      this._data.byteOffset,
      this._data.byteOffset + this._data.byteLength
    )
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this._data)
  }

  slice(start?: number, end?: number, type?: string): NodeBlob {
    const sliced = this._data.slice(start, end)
    return new NodeBlob([sliced], { type: type ?? this.type })
  }

  // Make it behave like a Blob for type checking
  get [Symbol.toStringTag](): string {
    return 'Blob'
  }
}

/**
 * Node.js file provider
 */
export class NodeFileProvider implements FileProvider {
  createBlob(data: Uint8Array, options?: { type?: string }): Blob {
    // Use native Blob if available (Node 18+), otherwise use polyfill
    if (typeof Blob !== 'undefined') {
      return new Blob([data], { type: options?.type ?? 'application/octet-stream' })
    }
    return new NodeBlob([data], options) as unknown as Blob
  }

  async readAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return blob.arrayBuffer()
  }

  async readFile(path: string): Promise<Uint8Array> {
    const buffer = readFileSync(path)
    return new Uint8Array(buffer)
  }

  // File class not available in Node.js, return undefined
  createFile = undefined
}
