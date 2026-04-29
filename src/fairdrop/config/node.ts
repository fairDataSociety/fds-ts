/**
 * Node.js ConfigProvider Implementation
 *
 * Uses process.env and optional config file.
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { ConfigProvider } from '../adapters/types.js'
import { FairdropError, FairdropErrorCode } from '../errors/index.js'

/**
 * Node.js config provider using process.env
 */
export class EnvConfigProvider implements ConfigProvider {
  private readonly fileConfig: Record<string, string> = {}

  /**
   * @param prefix - Prefix for environment variables (default: 'FAIRDROP_')
   * @param configPath - Path to config file (default: ~/.fairdrop/config.json)
   */
  constructor(
    private readonly prefix: string = 'FAIRDROP_',
    configPath?: string
  ) {
    // Load config file if exists
    const path = configPath ?? join(homedir(), '.fairdrop', 'config.json')
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8')
        this.fileConfig = JSON.parse(content)
      } catch {
        // Ignore parse errors
      }
    }
  }

  /**
   * Get config value (env vars take precedence over file)
   * @param key - Config key (without prefix for env vars)
   * @returns Value or undefined if not set
   */
  get(key: string): string | undefined {
    // Check environment variable first
    const envValue = process.env[this.prefix + key]
    if (envValue !== undefined) {
      return envValue
    }

    // Fall back to config file
    // Convert UPPER_SNAKE_CASE to camelCase for file config
    const camelKey = key.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    const fileValue = this.fileConfig[camelKey]
    if (fileValue !== undefined) {
      return String(fileValue)
    }

    return undefined
  }

  /**
   * Get required config value
   * @param key - Config key
   * @returns Value
   * @throws FairdropError if not set
   */
  getRequired(key: string): string {
    const value = this.get(key)
    if (value === undefined || value === '') {
      throw new FairdropError(
        FairdropErrorCode.CONFIG_MISSING,
        `Missing required configuration: ${this.prefix}${key} or config file`,
        false,
        false
      )
    }
    return value
  }
}

/**
 * Static config provider for testing or hardcoded values
 */
export class StaticConfigProvider implements ConfigProvider {
  constructor(private readonly config: Record<string, string>) {}

  get(key: string): string | undefined {
    return this.config[key]
  }

  getRequired(key: string): string {
    const value = this.get(key)
    if (value === undefined) {
      throw new FairdropError(
        FairdropErrorCode.CONFIG_MISSING,
        `Missing required configuration: ${key}`,
        false,
        false
      )
    }
    return value
  }
}
