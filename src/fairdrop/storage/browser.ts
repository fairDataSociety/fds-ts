/**
 * Browser StorageAdapter Implementation
 *
 * Wraps localStorage and sessionStorage.
 */

import type { StorageAdapter } from '../adapters/types.js'

/**
 * Browser storage adapter using localStorage and sessionStorage
 */
export class BrowserStorageAdapter implements StorageAdapter {
  /**
   * Optional prefix for all keys (e.g., 'fairdrop_')
   */
  constructor(private readonly prefix: string = '') {}

  private prefixKey(key: string): string {
    return this.prefix + key
  }

  async get(key: string): Promise<string | null> {
    return localStorage.getItem(this.prefixKey(key))
  }

  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(this.prefixKey(key), value)
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(this.prefixKey(key))
  }

  async keys(): Promise<string[]> {
    const allKeys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key !== null) {
        if (this.prefix) {
          if (key.startsWith(this.prefix)) {
            allKeys.push(key.slice(this.prefix.length))
          }
        } else {
          allKeys.push(key)
        }
      }
    }
    return allKeys
  }

  /**
   * Session storage (ephemeral, cleared on browser close)
   */
  session = {
    get: (key: string): string | null => {
      return sessionStorage.getItem(this.prefixKey(key))
    },
    set: (key: string, value: string): void => {
      sessionStorage.setItem(this.prefixKey(key), value)
    },
    remove: (key: string): void => {
      sessionStorage.removeItem(this.prefixKey(key))
    },
  }
}
