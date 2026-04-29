/**
 * Isomorphic Account Storage Service
 *
 * Type-safe storage wrapper for Fairdrop data persistence.
 * Uses StorageAdapter for persistence and CryptoProvider for hashing.
 */

import type { StorageAdapter, CryptoProvider, EncodingProvider } from '../adapters/types.js'

// Storage key constants
export const STORAGE_KEYS = {
  MAILBOXES: 'fairdrop_mailboxes_v2',
  INBOXES: 'fairdrop_inboxes',
  SETTINGS: 'fairdrop_settings',
  ACTIVE_ACCOUNT: 'fairdrop_active_account',
} as const

// Account type (minimal, without sensitive data)
export interface StoredAccount {
  subdomain: string
  address: string
  publicKey: string
  encryptedPrivateKey?: string
  passwordHash: string
  createdAt: number
  lastLoginAt?: number
}

// Account storage map
export interface StoredMailboxes {
  [subdomain: string]: StoredAccount
}

// Message types for inbox storage
export type MessageType = 'received' | 'sent' | 'stored'

// Message interface
export interface StoredMessage {
  reference: string
  timestamp: number
  from?: string
  to?: string
  read: boolean
  filename?: string
  size?: number
  encryptedKey?: string
}

// Honest Inbox interface
export interface StoredHonestInbox {
  id: string
  name: string
  publicKey: string
  privateKey: string
  createdAt: number
}

export interface StoredInboxes {
  [id: string]: StoredHonestInbox
}

// Settings interface
export interface FairdropSettings {
  theme?: 'light' | 'dark' | 'system'
  defaultStampId?: string
  beeUrl?: string
  customBeeUrls?: string[]
}

// Password salt
const SALT = 'fairdrop-v2-salt'

/**
 * Account Storage Service
 *
 * Provides typed storage operations using injected adapters.
 */
export class AccountStorage {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly crypto: CryptoProvider,
    private readonly encoding: EncodingProvider
  ) {}

  // ===========================================================================
  // Account Operations
  // ===========================================================================

  /**
   * Get all stored accounts
   */
  async getAccounts(): Promise<StoredMailboxes> {
    const data = await this.storage.get(STORAGE_KEYS.MAILBOXES)
    if (!data) return {}
    try {
      return JSON.parse(data) as StoredMailboxes
    } catch {
      return {}
    }
  }

  /**
   * Get a specific account by subdomain
   */
  async getAccount(subdomain: string): Promise<StoredAccount | null> {
    const accounts = await this.getAccounts()
    return accounts[subdomain.toLowerCase()] ?? null
  }

  /**
   * Save an account
   */
  async saveAccount(account: StoredAccount): Promise<void> {
    const accounts = await this.getAccounts()
    accounts[account.subdomain.toLowerCase()] = account
    await this.storage.set(STORAGE_KEYS.MAILBOXES, JSON.stringify(accounts))
  }

  /**
   * Delete an account
   */
  async deleteAccount(subdomain: string): Promise<void> {
    const accounts = await this.getAccounts()
    delete accounts[subdomain.toLowerCase()]
    await this.storage.set(STORAGE_KEYS.MAILBOXES, JSON.stringify(accounts))
  }

  // ===========================================================================
  // Message Operations
  // ===========================================================================

  /**
   * Get messages for an account
   */
  async getMessages(subdomain: string, type: MessageType): Promise<StoredMessage[]> {
    const key = `${subdomain.toLowerCase()}_${type}`
    const data = await this.storage.get(key)
    if (!data) return []
    try {
      return JSON.parse(data) as StoredMessage[]
    } catch {
      return []
    }
  }

  /**
   * Save messages for an account
   */
  async saveMessages(subdomain: string, type: MessageType, messages: StoredMessage[]): Promise<void> {
    const key = `${subdomain.toLowerCase()}_${type}`
    await this.storage.set(key, JSON.stringify(messages))
  }

  /**
   * Add a single message
   */
  async addMessage(subdomain: string, type: MessageType, message: StoredMessage): Promise<void> {
    const messages = await this.getMessages(subdomain, type)
    // Check for duplicates by reference
    if (!messages.some((m) => m.reference === message.reference)) {
      messages.unshift(message) // Add to beginning (newest first)
      await this.saveMessages(subdomain, type, messages)
    }
  }

  /**
   * Delete a message by reference
   */
  async deleteMessage(subdomain: string, type: MessageType, reference: string): Promise<void> {
    const messages = await this.getMessages(subdomain, type)
    const filtered = messages.filter((m) => m.reference !== reference)
    await this.saveMessages(subdomain, type, filtered)
  }

  // ===========================================================================
  // Honest Inbox Operations
  // ===========================================================================

  /**
   * Get all honest inboxes
   */
  async getHonestInboxes(): Promise<StoredInboxes> {
    const data = await this.storage.get(STORAGE_KEYS.INBOXES)
    if (!data) return {}
    try {
      return JSON.parse(data) as StoredInboxes
    } catch {
      return {}
    }
  }

  /**
   * Get a specific honest inbox
   */
  async getHonestInbox(id: string): Promise<StoredHonestInbox | null> {
    const inboxes = await this.getHonestInboxes()
    return inboxes[id.toLowerCase()] ?? null
  }

  /**
   * Save a honest inbox
   */
  async saveHonestInbox(inbox: StoredHonestInbox): Promise<void> {
    const inboxes = await this.getHonestInboxes()
    inboxes[inbox.id.toLowerCase()] = inbox
    await this.storage.set(STORAGE_KEYS.INBOXES, JSON.stringify(inboxes))
  }

  /**
   * Delete a honest inbox
   */
  async deleteHonestInbox(id: string): Promise<void> {
    const inboxes = await this.getHonestInboxes()
    delete inboxes[id.toLowerCase()]
    await this.storage.set(STORAGE_KEYS.INBOXES, JSON.stringify(inboxes))
  }

  // ===========================================================================
  // Settings Operations
  // ===========================================================================

  /**
   * Get settings
   */
  async getSettings(): Promise<FairdropSettings> {
    const data = await this.storage.get(STORAGE_KEYS.SETTINGS)
    if (!data) return {}
    try {
      return JSON.parse(data) as FairdropSettings
    } catch {
      return {}
    }
  }

  /**
   * Save settings
   */
  async saveSettings(settings: Partial<FairdropSettings>): Promise<void> {
    const current = await this.getSettings()
    const updated = { ...current, ...settings }
    await this.storage.set(STORAGE_KEYS.SETTINGS, JSON.stringify(updated))
  }

  // ===========================================================================
  // Active Account
  // ===========================================================================

  /**
   * Get active account subdomain
   */
  async getActiveAccountSubdomain(): Promise<string | null> {
    return this.storage.get(STORAGE_KEYS.ACTIVE_ACCOUNT)
  }

  /**
   * Set active account subdomain
   */
  async setActiveAccountSubdomain(subdomain: string | null): Promise<void> {
    if (subdomain) {
      await this.storage.set(STORAGE_KEYS.ACTIVE_ACCOUNT, subdomain.toLowerCase())
    } else {
      await this.storage.remove(STORAGE_KEYS.ACTIVE_ACCOUNT)
    }
  }

  // ===========================================================================
  // Clear Data
  // ===========================================================================

  /**
   * Clear all Fairdrop data (for logout/reset)
   */
  async clearAllData(): Promise<void> {
    const keys = Object.values(STORAGE_KEYS)
    for (const key of keys) {
      await this.storage.remove(key)
    }

    // Also clear per-account message storage
    const accounts = await this.getAccounts()
    for (const subdomain of Object.keys(accounts)) {
      await this.storage.remove(`${subdomain}_received`)
      await this.storage.remove(`${subdomain}_sent`)
      await this.storage.remove(`${subdomain}_stored`)
    }
  }

  // ===========================================================================
  // Password Hashing
  // ===========================================================================

  /**
   * Hash a password using CryptoProvider (SHA-256)
   * Returns a hex string
   */
  async hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(password + SALT)
    const hashBytes = await this.crypto.sha256(data)
    return this.encoding.bytesToHex(hashBytes)
  }

  /**
   * Verify a password against a stored hash
   */
  async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const hash = await this.hashPassword(password)
    return hash === storedHash
  }
}
