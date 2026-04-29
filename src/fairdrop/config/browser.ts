/**
 * Browser ConfigProvider Implementation
 *
 * Uses import.meta.env for Vite-based configuration.
 */

import type { ConfigProvider } from '../adapters/types.js'
import { FairdropError, FairdropErrorCode } from '../errors/index.js'

/**
 * Browser config provider using Vite's import.meta.env
 */
export class BrowserConfigProvider implements ConfigProvider {
  /**
   * Prefix for environment variables (default: 'VITE_')
   */
  constructor(private readonly prefix: string = 'VITE_') {}

  /**
   * Get config value
   * @param key - Config key (without prefix)
   * @returns Value or undefined if not set
   */
  get(key: string): string | undefined {
    // Access import.meta.env dynamically
    const env = (import.meta as { env?: Record<string, string> }).env ?? {}
    return env[this.prefix + key]
  }

  /**
   * Get required config value
   * @param key - Config key (without prefix)
   * @returns Value
   * @throws FairdropError if not set
   */
  getRequired(key: string): string {
    const value = this.get(key)
    if (value === undefined || value === '') {
      throw new FairdropError(
        FairdropErrorCode.CONFIG_MISSING,
        `Missing required configuration: ${this.prefix}${key}`,
        false,
        false
      )
    }
    return value
  }
}
