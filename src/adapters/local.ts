/**
 * LocalAdapter — filesystem-based StorageAdapter for development and desktop apps.
 *
 * Buckets = directories. Objects = files. Simple and predictable.
 * No encryption at this layer (SDK handles encryption above).
 */

import { readFile, writeFile, mkdir, rm, rename, stat, readdir } from 'fs/promises'
import { join, dirname, relative, sep } from 'path'
import { existsSync } from 'fs'
import type { StorageAdapter, AdapterCapabilities } from './interface.js'
import type { ObjectMeta, ListResult, BucketInfo, PutOptions, PutResult } from '../types.js'
import { FdsError, FdsErrorCode } from '../errors.js'

export interface LocalAdapterConfig {
  /** Root directory for all storage */
  path: string
}

export class LocalAdapter implements StorageAdapter {
  readonly name = 'local'
  readonly capabilities: AdapterCapabilities = {
    nativeEncryption: false,
    nativeSharing: false,
    versioning: false,
    streaming: false,
    publicUrls: false,
    contentAddressed: false,
  }

  private rootPath: string
  private connected = false

  constructor(config: LocalAdapterConfig) {
    this.rootPath = config.path
  }

  async connect(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true })
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  async isConnected(): Promise<boolean> {
    return this.connected
  }

  // ── Objects ────────────────────────────────────────────

  async put(bucket: string, key: string, data: Uint8Array, opts?: PutOptions): Promise<PutResult> {
    this.ensureConnected()
    const filePath = this.objectPath(bucket, key)

    if (opts?.onConflict === 'skip' && existsSync(filePath)) {
      const s = await stat(filePath)
      return { key, bucket, size: s.size }
    }

    if (opts?.onConflict === 'rename' && existsSync(filePath)) {
      const ext = key.includes('.') ? '.' + key.split('.').pop() : ''
      const base = ext ? key.slice(0, -ext.length) : key
      let i = 1
      let newKey = `${base}-${i}${ext}`
      while (existsSync(this.objectPath(bucket, newKey))) {
        i++
        newKey = `${base}-${i}${ext}`
      }
      key = newKey
    }

    const finalPath = this.objectPath(bucket, key)
    await mkdir(dirname(finalPath), { recursive: true })
    await writeFile(finalPath, data)
    return { key, bucket, size: data.length }
  }

  async get(bucket: string, key: string): Promise<Uint8Array> {
    this.ensureConnected()
    const filePath = this.objectPath(bucket, key)
    try {
      return await readFile(filePath)
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new FdsError(FdsErrorCode.OBJECT_NOT_FOUND, `Object not found: ${bucket}/${key}`)
      }
      throw err
    }
  }

  async head(bucket: string, key: string): Promise<ObjectMeta | null> {
    this.ensureConnected()
    const filePath = this.objectPath(bucket, key)
    try {
      const s = await stat(filePath)
      return {
        key,
        size: s.size,
        contentType: 'application/octet-stream',
        createdAt: s.birthtime,
        modifiedAt: s.mtime,
        encrypted: false,
      }
    } catch {
      return null
    }
  }

  async delete(bucket: string, key: string): Promise<void> {
    this.ensureConnected()
    const filePath = this.objectPath(bucket, key)
    try {
      await rm(filePath)
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new FdsError(FdsErrorCode.OBJECT_NOT_FOUND, `Object not found: ${bucket}/${key}`)
      }
      throw err
    }
  }

  async list(bucket: string, prefix?: string): Promise<ListResult> {
    this.ensureConnected()
    const bucketPath = this.bucketPath(bucket)
    const searchDir = prefix ? join(bucketPath, prefix) : bucketPath

    if (!existsSync(searchDir)) {
      return { objects: [], prefixes: [] }
    }

    const entries = await readdir(searchDir, { withFileTypes: true })
    const objects: ListResult['objects'] = []
    const prefixes: string[] = []

    for (const entry of entries) {
      const entryKey = prefix ? prefix + entry.name : entry.name
      if (entry.isDirectory()) {
        prefixes.push(entryKey + '/')
      } else {
        const s = await stat(join(searchDir, entry.name))
        objects.push({
          key: entryKey,
          size: s.size,
          lastModified: s.mtime,
        })
      }
    }

    return { objects, prefixes }
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    return existsSync(this.objectPath(bucket, key))
  }

  async move(bucket: string, fromKey: string, toKey: string): Promise<void> {
    this.ensureConnected()
    const from = this.objectPath(bucket, fromKey)
    const to = this.objectPath(bucket, toKey)
    await mkdir(dirname(to), { recursive: true })
    await rename(from, to)
  }

  // ── Buckets ────────────────────────────────────────────

  async createBucket(name: string): Promise<void> {
    this.ensureConnected()
    const bp = this.bucketPath(name)
    if (existsSync(bp)) {
      throw new FdsError(FdsErrorCode.BUCKET_EXISTS, `Bucket already exists: ${name}`)
    }
    await mkdir(bp, { recursive: true })
  }

  async listBuckets(): Promise<BucketInfo[]> {
    this.ensureConnected()
    if (!existsSync(this.rootPath)) return []
    const entries = await readdir(this.rootPath, { withFileTypes: true })
    const buckets: BucketInfo[] = []
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const s = await stat(join(this.rootPath, entry.name))
        buckets.push({
          name: entry.name,
          createdAt: s.birthtime,
          isShared: false,
        })
      }
    }
    return buckets
  }

  async deleteBucket(name: string): Promise<void> {
    this.ensureConnected()
    const bp = this.bucketPath(name)
    if (!existsSync(bp)) {
      throw new FdsError(FdsErrorCode.BUCKET_NOT_FOUND, `Bucket not found: ${name}`)
    }
    const entries = await readdir(bp)
    if (entries.length > 0) {
      throw new FdsError(FdsErrorCode.BUCKET_NOT_EMPTY, `Bucket not empty: ${name}`)
    }
    await rm(bp, { recursive: true })
  }

  async bucketExists(name: string): Promise<boolean> {
    return existsSync(this.bucketPath(name))
  }

  // ── Private ────────────────────────────────────────────

  private bucketPath(bucket: string): string {
    return join(this.rootPath, bucket)
  }

  private objectPath(bucket: string, key: string): string {
    return join(this.rootPath, bucket, key)
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new FdsError(FdsErrorCode.NO_STORAGE, 'Local adapter not connected. Call connect() first.')
    }
  }
}
