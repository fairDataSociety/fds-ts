/**
 * SDK Types
 */

import type {
  StorageAdapter,
  ConfigProvider,
  CryptoProvider,
  WalletProvider,
  EncodingProvider,
  FileProvider,
  DownloadProvider,
  ContractProvider,
} from './index.js'

/**
 * Options for creating a FairdropClient
 */
export interface FairdropClientOptions {
  /** Bee node URL (e.g., 'http://localhost:1633') */
  beeUrl: string

  /** Storage adapter for persistence */
  storage: StorageAdapter

  /** Crypto provider for encryption */
  crypto: CryptoProvider

  /** Encoding provider for base64/hex */
  encoding: EncodingProvider

  /** Optional wallet provider (or use privateKey) */
  wallet?: WalletProvider

  /** Private key for embedded wallet (alternative to wallet) */
  privateKey?: Uint8Array

  /** Optional file provider */
  file?: FileProvider

  /** Optional download provider */
  download?: DownloadProvider

  /** Optional config provider (defaults to provided values) */
  config?: ConfigProvider

  /** Contract provider for escrow operations */
  contract?: ContractProvider

  /** ENS domain for account registration (default: 'fairdrop.eth', staging: 'fairdrop-dev.eth') */
  ensDomain?: string

  /** Reputation API URL (default: 'https://agents.datafund.io/api/v1') */
  reputationApiUrl?: string

  /** Chain ID for escrow operations (default: 8453 for Base) */
  chainId?: number

  /** Public client for ENS resolution (mainnet) */
  ensClient?: import('viem').PublicClient
}

/**
 * Options for uploading files
 */
export interface UploadOptions {
  /** Content type (MIME) */
  contentType?: string

  /** Optional filename */
  filename?: string

  /** Encrypt the file before upload */
  encrypt?: boolean

  /** Postage batch ID (uses default if not provided) */
  batchId?: string
}

/**
 * Options for sending files
 */
export interface SendOptions {
  /** Optional message to include */
  message?: string

  /** Write to recipient's GSOC inbox */
  notifyGsoc?: boolean
}

/**
 * Result of a send operation
 */
export interface SendResult {
  /** Swarm reference of the encrypted file */
  reference: string

  /** Recipient address */
  to: string

  /** Whether notification was sent */
  notified: boolean

  /** Error message if notification failed */
  notificationError?: string
}

/**
 * Account summary (without sensitive data)
 */
export interface AccountSummary {
  /** Account subdomain (e.g., 'alice') */
  subdomain: string

  /** Ethereum address */
  address: string

  /** Whether account is currently unlocked */
  unlocked: boolean
}

/**
 * Inbox parameters for GSOC messaging
 */
export interface InboxParams {
  /** Target overlay address for GSOC neighborhood */
  targetOverlay: string

  /** Base identifier for slot derivation */
  baseIdentifier: string

  /** Neighborhood proximity bits */
  proximity: number

  /** Recipient public key for encrypted metadata (optional) */
  recipientPublicKey?: string
}

/**
 * Stamp information
 */
export interface StampInfo {
  /** Batch ID */
  batchId: string

  /** Remaining capacity */
  capacity: number

  /** Expiration timestamp */
  expiresAt?: number
}

/**
 * Connection status
 */
export interface ConnectionStatus {
  /** Whether connected to Bee node */
  connected: boolean

  /** Bee node version */
  version?: string

  /** Error if not connected */
  error?: string
}

/**
 * Message from inbox
 */
export interface Message {
  /** Message reference */
  reference: string

  /** Sender address */
  from: string

  /** Timestamp */
  timestamp: number

  /** Whether message has been read */
  read: boolean

  /** Optional message text */
  message?: string

  /** Encrypted file reference */
  fileReference?: string
}

/**
 * Honest inbox (anonymous)
 */
export interface HonestInbox {
  /** Inbox ID */
  id: string

  /** Inbox name */
  name: string

  /** Public key for senders (hex string) */
  publicKey: string

  /** Private key for decryption (hex string) */
  privateKey?: string

  /** GSOC inbox parameters */
  gsocParams?: InboxParams

  /** Creation timestamp */
  created: number
}

/**
 * Anonymous message (from Honest Inbox)
 */
export interface AnonymousMessage {
  /** Message reference */
  reference: string

  /** Timestamp */
  timestamp: number

  /** Slot index in inbox */
  index: number
}

/**
 * GSOC message format stored in inbox slots
 */
export interface GSOCMessage {
  /** Message format version */
  version: number

  /** Swarm reference to the file */
  reference: string

  /** Timestamp when message was written */
  timestamp: number

  /** Optional filename */
  filename?: string

  /** Optional file size */
  size?: number

  /** Optional sender display name (e.g. "alice.fairdrop.eth", "Claude Desktop") */
  sender?: string

  /** Optional sender public key (enables reply-to) */
  senderPubkey?: string

  /** Optional content type hint */
  contentType?: string

  /** Optional human-readable note */
  note?: string

  /** Slot index (set during read) */
  index?: number
}

/**
 * Inbox subscription callbacks
 */
export interface InboxCallbacks {
  onMessage: (message: Message) => void
  onError?: (error: Error) => void
}

/**
 * Inbox subscription handle
 */
export interface InboxSubscription {
  unsubscribe: () => void
}

// ============================================================================
// Escrow Types
// ============================================================================

/**
 * Escrow metadata for data sale
 */
export interface EscrowMetadata {
  /** Human-readable name */
  name: string

  /** Description of the data */
  description: string

  /** Content category */
  category: 'research' | 'media' | 'dataset' | 'code' | 'other'

  /** File size in bytes */
  size: number

  /** Optional sample data hash (for preview) */
  sampleHash?: string

  /** ToS acknowledgment (informational only, not enforced on-chain) */
  tosAcknowledged: boolean

  /** ToS version for audit trail */
  tosVersion: string
}

/**
 * Escrow creation options
 */
export interface CreateEscrowOptions {
  /** Price in wei */
  price: bigint

  /** Expiration in days */
  expiryDays: number

  /** Dispute window in seconds (default: 0 = no dispute period) */
  disputeWindowSeconds?: number
}

/**
 * Result of creating an escrow
 */
export interface CreateEscrowResult {
  /** On-chain escrow ID */
  escrowId: bigint

  /** Swarm reference for encrypted data */
  encryptedDataRef: string

  /** Key commitment hash (hex) */
  keyCommitment: `0x${string}`

  /** Transaction hash */
  txHash: `0x${string}`

  /** Block number of transaction */
  blockNumber: bigint

  /** Encryption key (keep secret until release) */
  encryptionKey: Uint8Array

  /** Salt for key commitment (keep secret until release) */
  salt: Uint8Array
}

/**
 * Escrow state (mirrors contract enum)
 */
export enum EscrowState {
  CREATED = 0,
  FUNDED = 1,
  KEY_COMMITTED = 2,
  RELEASED = 3,
  CLAIMED = 4,
  EXPIRED = 5,
  CANCELLED = 6,
  DISPUTED = 7,
  SELLER_RESPONDED = 8,
  RESOLVED_BUYER = 9,
  RESOLVED_SELLER = 10,
}

/**
 * Escrow details from chain
 */
export interface EscrowDetails {
  /** Escrow ID */
  escrowId: bigint

  /** Seller address */
  seller: `0x${string}`

  /** Buyer address (zero if not funded) */
  buyer: `0x${string}`

  /** Content hash (Swarm reference) */
  contentHash: `0x${string}`

  /** Key commitment */
  keyCommitment: `0x${string}`

  /** Price in wei */
  amount: bigint

  /** Expiration timestamp */
  expiresAt: bigint

  /** Current state */
  state: EscrowState

  /** Commit block number (for reveal timing) */
  commitBlock: bigint

  /** Commit timestamp */
  commitTimestamp: bigint

  /** Release timestamp */
  releaseTimestamp: bigint

  /** Dispute raised at timestamp */
  disputeRaisedAt: bigint

  /** Dispute bond amount */
  disputeBond: bigint
}

/**
 * Content verification result
 */
export interface VerificationResult {
  /** Whether content hash matches */
  valid: boolean

  /** Content hash from chain */
  contentHash: string

  /** Escrow metadata */
  metadata: EscrowMetadata | { contentHash: string; seller: string } | null

  /** Price in wei */
  price: bigint

  /** Expiration timestamp */
  expiresAt: number
}

/**
 * Key reveal commit result
 */
export interface CommitKeyResult {
  /** Transaction hash */
  txHash: `0x${string}`

  /** Block number */
  blockNumber: bigint

  /** Commit timestamp */
  commitTimestamp: number

  /** Encrypted key commitment */
  encryptedKeyCommitment: `0x${string}`

  /** Serialized encrypted key - MUST be preserved for reveal phase */
  serializedEncryptedKey: Uint8Array

  /** Commitment salt - MUST be preserved for reveal phase */
  commitmentSalt: Uint8Array
}

/**
 * Key reveal result
 */
export interface RevealKeyResult {
  /** Transaction hash */
  txHash: `0x${string}`

  /** Encrypted key for buyer (in event log) */
  encryptedKeyForBuyer: Uint8Array
}

/**
 * Escrow list filter options
 */
export interface EscrowListOptions {
  /** Filter by role */
  role?: 'seller' | 'buyer'

  /** Filter by state */
  state?: EscrowState

  /** Limit number of results */
  limit?: number

  /** Offset for pagination */
  offset?: number
}

// ============================================================================
// Reputation Types
// ============================================================================

/**
 * Reputation tier based on score
 */
export type ReputationTier = 'new' | 'bronze' | 'silver' | 'gold' | 'platinum'

/**
 * Result of checking seller/agent reputation
 */
export interface ReputationResult {
  /** Whether the score meets the minimum threshold */
  safe: boolean

  /** Reputation score (0-1000) */
  score: number

  /** Reputation tier */
  tier: ReputationTier

  /** Recommendation based on score */
  recommendation: 'proceed' | 'caution' | 'avoid'

  /** Human-readable reason */
  reason?: string

  /** ERC-8004 agent ID (if applicable) */
  agentId?: number

  /** Detailed metrics */
  metrics?: {
    completionRate: number
    disputeRate: number
    totalVolume: string
    totalEscrows: number
    avgDeliverySeconds: number | null
  }
}

// ============================================================================
// ACT (Access Control Trie) Types
// ============================================================================

/**
 * Result of ACT upload
 */
export interface ActUploadResult {
  /** Swarm reference */
  reference: string

  /** History address for ACT updates */
  historyAddress: string

  /** Number of grantees */
  granteeCount: number

  /** ACT manifest reference */
  actReference: string
}

/**
 * Result of grantee operations
 */
// ============================================================================
// Unsigned Transaction Types (for keyless gateway pattern)
// ============================================================================

/**
 * Unsigned transaction data — ready for client-side signing
 */
export interface UnsignedTransaction {
  /** Contract address */
  to: `0x${string}`
  /** Encoded calldata */
  data: `0x${string}`
  /** ETH value to send (wei, hex-encoded) */
  value: `0x${string}`
  /** Chain ID */
  chainId: number
}

/**
 * Result of preparing an escrow (off-chain work done, unsigned tx returned)
 */
export interface PrepareEscrowResult {
  /** Unsigned transaction to create escrow on-chain */
  transaction: UnsignedTransaction

  /** Swarm reference for encrypted data */
  encryptedDataRef: string

  /** Content hash (hex) — keccak256 of encrypted blob */
  contentHash: `0x${string}`

  /** Key commitment hash (hex) */
  keyCommitment: `0x${string}`

  /** Encryption key (hex) — keep secret until release */
  encryptionKey: string

  /** Salt for key commitment (hex) — keep secret until release */
  salt: string
}

/**
 * Result of preparing a commit key release (off-chain work done, unsigned tx returned)
 */
export interface PrepareCommitKeyResult {
  /** Unsigned transaction for commitKeyRelease */
  transaction: UnsignedTransaction

  /** Encrypted key commitment (hex) */
  encryptedKeyCommitment: `0x${string}`

  /** Serialized encrypted key (hex) — preserve for reveal phase */
  serializedEncryptedKey: string

  /** Commitment salt (hex) — preserve for reveal phase */
  commitmentSalt: string
}

/**
 * Result of preparing any simple escrow transaction
 */
export interface PrepareTransactionResult {
  /** Unsigned transaction */
  transaction: UnsignedTransaction
}

export interface GranteesResult {
  /** Swarm reference */
  reference: string

  /** History address */
  historyAddress: string

  /** Successfully added grantee pubkeys */
  added: string[]

  /** Successfully removed grantee pubkeys */
  removed: string[]

  /** Failed operations */
  failed: Array<{ pubkey: string; error: string }>
}
