/**
 * @fairdatasociety/fds — Core types
 */

import type { StorageAdapter } from './adapters/interface.js'

// ─── Configuration ──────────────────────────────────────

export interface FdsConfig {
  /** Storage backend configuration */
  storage: StorageConfig | StorageAdapter

  /** Chain configuration (for escrow, ENS) */
  chain?: {
    rpcUrl: string
    chainId?: number  // default: 8453 (Base)
  }
}

export type StorageConfig =
  | SwarmStorageConfig
  | SwarmGatewayConfig
  | LocalStorageConfig

export interface SwarmStorageConfig {
  type: 'swarm'
  /** Bee node URL */
  beeUrl: string
  /** Postage batch ID for uploads */
  batchId?: string
}

export interface SwarmGatewayConfig {
  type: 'swarm'
  /** Gateway URL (no Bee node needed) */
  gateway: string
}

export interface LocalStorageConfig {
  type: 'local'
  /** Filesystem path for local storage */
  path: string
}

// ─── Identity ───────────────────────────────────────────

export interface FdsIdentity {
  address: string
  publicKey: string
  mnemonic?: string  // only present on create(), never stored
}

// ─── Storage ────────────────────────────────────────────

export interface ObjectMeta {
  key: string
  size: number
  contentType: string
  createdAt: Date
  modifiedAt: Date
  encrypted: boolean
  reference?: string
}

export interface ListResult {
  objects: Array<{
    key: string
    size: number
    contentType?: string
    lastModified: Date
  }>
  /** Subdirectory prefixes (S3-style common prefixes) */
  prefixes: string[]
}

export interface BucketInfo {
  name: string
  createdAt: Date
  isShared: boolean
}

export interface PutOptions {
  contentType?: string
  onConflict?: 'overwrite' | 'skip' | 'rename'
  /** If true, store unencrypted (default: false = encrypted) */
  unencrypted?: boolean
}

export interface PutResult {
  key: string
  bucket: string
  reference?: string
  size: number
}

// ─── Transfer ───────────────────────────────────────────

export interface SendOptions {
  filename?: string
  contentType?: string
  note?: string
}

export interface SendResult {
  reference: string
  recipient: string
  encrypted: boolean
}

export interface InboxMessage {
  sender?: string
  filename?: string
  reference: string
  timestamp: Date
  size?: number
  contentType?: string
  note?: string
  type: 'message' | 'share' | 'purchase'
}

export interface InboxSubscription {
  unsubscribe(): void
}

// ─── Sharing ────────────────────────────────────────────

export interface GrantInfo {
  address: string
  publicKey?: string
  grantedAt: Date
}

// ─── Escrow ─────────────────────────────────────────────

export type EscrowStatus =
  | 'Created' | 'Funded' | 'KeyCommitted' | 'Released' | 'Claimed'
  | 'Expired' | 'Cancelled' | 'Disputed' | 'SellerResponded'
  | 'ResolvedBuyer' | 'ResolvedSeller'

export interface EscrowDetails {
  escrowId: bigint
  seller: string
  buyer?: string
  price: bigint
  description?: string
  contentHash: string
  reference?: string
  status: EscrowStatus
  createdAt: Date
  expiresAt?: Date
}

export interface EscrowCreateOptions {
  price: string          // ETH as string (e.g., '0.01')
  description?: string
  expiryDays?: number
}

export interface EscrowCreateResult {
  escrowId: bigint
  reference: string
  contentHash: string
  status: EscrowStatus
}

// ─── Stamps ─────────────────────────────────────────────

export interface StampInfo {
  available: boolean
  batchId?: string
  balance?: number
  ttl?: number
  depth?: number
  canUpload: boolean
}

// ─── Status ─────────────────────────────────────────────

export interface FdsStatus {
  identity: {
    address?: string
    ensName?: string
    locked: boolean
    connected: boolean
  }
  storage: {
    type: string
    connected: boolean
  }
  stamps: StampInfo
  inbox: {
    unread: number
  }
  chain?: {
    chainId: number
    connected: boolean
  }
}

// ─── Storage Adapter (re-export) ────────────────────────

export type { AdapterCapabilities } from './adapters/interface.js'
export type { StorageAdapter } from './adapters/interface.js'
