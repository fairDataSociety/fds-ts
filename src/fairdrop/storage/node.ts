/**
 * Node.js StorageAdapter Implementation
 *
 * Uses file-based storage in ~/.fairdrop/storage/
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { StorageAdapter } from '../adapters/types.js'

/**
 * File-based storage adapter for Node.js
 */
export class FileStorageAdapter implements StorageAdapter {
  private readonly storageDir: string
  private readonly sessionCache = new Map<string, string>()

  /**
   * @param baseDir - Base directory for storage (default: ~/.fairdrop)
   */
  constructor(baseDir?: string) {
    this.storageDir = join(baseDir ?? join(homedir(), '.fairdrop'), 'storage')
    this.ensureDir()
  }

  private ensureDir(): void {
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true })
    }
  }

  private getFilePath(key: string): string {
    // Sanitize key for filesystem
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(this.storageDir, `${safeKey}.json`)
  }

  async get(key: string): Promise<string | null> {
    const path = this.getFilePath(key)
    if (!existsSync(path)) {
      return null
    }
    try {
      return readFileSync(path, 'utf-8')
    } catch {
      return null
    }
  }

  async set(key: string, value: string): Promise<void> {
    this.ensureDir()
    const path = this.getFilePath(key)
    writeFileSync(path, value, 'utf-8')
  }

  async remove(key: string): Promise<void> {
    const path = this.getFilePath(key)
    if (existsSync(path)) {
      unlinkSync(path)
    }
  }

  async keys(): Promise<string[]> {
    this.ensureDir()
    const files = readdirSync(this.storageDir)
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5)) // Remove .json extension
  }

  /**
   * Session storage (in-memory, cleared on process exit)
   */
  session = {
    get: (key: string): string | null => {
      return this.sessionCache.get(key) ?? null
    },
    set: (key: string, value: string): void => {
      this.sessionCache.set(key, value)
    },
    remove: (key: string): void => {
      this.sessionCache.delete(key)
    },
  }
}

/**
 * In-memory storage adapter for testing
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly storage = new Map<string, string>()
  private readonly sessionCache = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.storage.get(key) ?? null
  }

  async set(key: string, value: string): Promise<void> {
    this.storage.set(key, value)
  }

  async remove(key: string): Promise<void> {
    this.storage.delete(key)
  }

  async keys(): Promise<string[]> {
    return Array.from(this.storage.keys())
  }

  session = {
    get: (key: string): string | null => {
      return this.sessionCache.get(key) ?? null
    },
    set: (key: string, value: string): void => {
      this.sessionCache.set(key, value)
    },
    remove: (key: string): void => {
      this.sessionCache.delete(key)
    },
  }

  /**
   * Clear all storage (useful for tests)
   */
  clear(): void {
    this.storage.clear()
    this.sessionCache.clear()
  }
}
