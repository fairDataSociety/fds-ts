/**
 * Adapter Interfaces for Fairdrop Core
 *
 * These interfaces abstract browser-specific APIs to enable
 * isomorphic code that runs in both Node.js and browser.
 */

import type { TypedDataDomain, TypedDataParameter } from 'viem'

// ============================================================================
// Storage Adapter
// ============================================================================

/**
 * Abstracts localStorage/sessionStorage for cross-environment storage.
 * Browser: wraps localStorage/sessionStorage
 * Node.js: uses file-based storage in ~/.fairdrop/
 */
export interface StorageAdapter {
  /** Get value by key (async for cross-environment compat) */
  get(key: string): Promise<string | null>

  /** Set value by key */
  set(key: string, value: string): Promise<void>

  /** Remove value by key */
  remove(key: string): Promise<void>

  /** Get all storage keys */
  keys(): Promise<string[]>

  /**
   * Session storage (ephemeral, cleared on process exit).
   * Sync API for siwe.ts nonce compatibility.
   */
  session: {
    get(key: string): string | null
    set(key: string, value: string): void
    remove(key: string): void
  }
}

// ============================================================================
// Config Provider
// ============================================================================

/**
 * Abstracts environment configuration.
 * Browser: wraps import.meta.env (VITE_* prefix)
 * Node.js: wraps process.env (FAIRDROP_* prefix)
 */
export interface ConfigProvider {
  /** Get config value, returns undefined if not set */
  get(key: string): string | undefined

  /** Get required config value, throws FairdropError if not set */
  getRequired(key: string): string
}

// ============================================================================
// Crypto Provider
// ============================================================================

/**
 * Abstracts Web Crypto API for cross-environment crypto.
 * Browser: uses crypto.subtle
 * Node.js: uses @noble/ciphers and @noble/hashes
 */
export interface CryptoProvider {
  // Random generation
  /** Generate random bytes */
  randomBytes(length: number): Uint8Array

  /** Generate random UUID */
  randomUUID(): string

  // Hashing
  /** SHA-256 hash */
  sha256(data: Uint8Array): Promise<Uint8Array>

  // AES-GCM (used by encryption.ts)
  /** Encrypt with AES-GCM */
  aesGcmEncrypt(
    data: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array
  ): Promise<Uint8Array>

  /** Decrypt with AES-GCM */
  aesGcmDecrypt(
    ciphertext: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array
  ): Promise<Uint8Array>

  // AES-CTR (used by keystore.ts)
  /** Encrypt with AES-CTR */
  aesCtrEncrypt(
    data: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array
  ): Promise<Uint8Array>

  /** Decrypt with AES-CTR */
  aesCtrDecrypt(
    ciphertext: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array
  ): Promise<Uint8Array>
}

// ============================================================================
// Wallet Provider
// ============================================================================

/**
 * Typed data for EIP-712 signing
 */
export interface TypedData {
  domain: TypedDataDomain
  types: Record<string, TypedDataParameter[]>
  primaryType: string
  message: Record<string, unknown>
}

/**
 * Abstracts wallet operations.
 * Browser: wraps browser wallet providers (MetaMask, etc.)
 * Node.js: wraps viem account from private key
 */
export interface WalletProvider {
  /** Get wallet address */
  getAddress(): Promise<string>

  /** Get public key as bytes */
  getPublicKey(): Uint8Array

  /** Sign a message (EIP-191 personal_sign) */
  signMessage(message: string): Promise<string>

  /** Sign typed data (EIP-712) */
  signTypedData(typedData: TypedData): Promise<string>

  /**
   * Get private key (only for embedded/SDK wallets).
   * Browser wallets will return undefined.
   */
  getPrivateKey?(): Uint8Array
}

// ============================================================================
// File Provider
// ============================================================================

/**
 * Abstracts File/Blob operations.
 * Browser: uses native File/Blob
 * Node.js: uses buffer-based implementations
 */
export interface FileProvider {
  /** Create a Blob from data */
  createBlob(data: Uint8Array, options?: { type?: string }): Blob

  /** Read Blob as ArrayBuffer */
  readAsArrayBuffer(blob: Blob): Promise<ArrayBuffer>

  /** Read file from path (Node.js only) */
  readFile(path: string): Promise<Uint8Array>

  /**
   * Create a File object (optional - not available in Node.js).
   * SDK will use Uint8Array + metadata instead.
   */
  createFile?(
    data: Uint8Array,
    name: string,
    options?: { type?: string }
  ): File
}

// ============================================================================
// Download Provider
// ============================================================================

/**
 * Abstracts browser download operations.
 * Browser: uses URL.createObjectURL, document.createElement('a')
 * Node.js: writes to file system (or throws if not supported)
 */
export interface DownloadProvider {
  /** Create object URL for blob (browser only) */
  createObjectURL(blob: Blob): string

  /** Revoke object URL */
  revokeObjectURL(url: string): void

  /** Trigger file download */
  triggerDownload(blob: Blob, filename: string): void

  /** Write to file path (Node.js alternative) */
  writeFile?(path: string, data: Uint8Array): Promise<void>
}

// ============================================================================
// Encoding Provider
// ============================================================================

/**
 * Abstracts base64/hex encoding.
 * Browser: uses btoa/atob
 * Node.js: uses Buffer or @noble/hashes/utils
 */
export interface EncodingProvider {
  /** Encode bytes to base64 string */
  base64Encode(data: Uint8Array): string

  /** Decode base64 string to bytes */
  base64Decode(str: string): Uint8Array

  /** Encode bytes to hex string */
  bytesToHex(data: Uint8Array): string

  /** Decode hex string to bytes */
  hexToBytes(hex: string): Uint8Array
}

// ============================================================================
// Contract Provider (Escrow Operations)
// ============================================================================

/**
 * Parameters for reading contract state.
 */
export interface ReadContractParameters {
  address: `0x${string}`
  abi: readonly unknown[]
  functionName: string
  args?: readonly unknown[]
}

/**
 * Parameters for simulating contract calls.
 */
export interface SimulateContractParameters extends ReadContractParameters {
  account?: `0x${string}`
  value?: bigint
}

/**
 * Result of contract simulation.
 */
export interface SimulateContractResult {
  request: WriteContractParameters
  result: unknown
}

/**
 * Parameters for writing to contract.
 */
export interface WriteContractParameters {
  address: `0x${string}`
  abi: readonly unknown[]
  functionName: string
  args?: readonly unknown[]
  value?: bigint
  gas?: bigint
}

/**
 * Parameters for gas estimation.
 */
export interface EstimateGasParameters {
  to: `0x${string}`
  data?: `0x${string}`
  value?: bigint
}

/**
 * Transaction receipt from chain.
 */
export interface TransactionReceipt {
  transactionHash: `0x${string}`
  blockNumber: bigint
  blockHash: `0x${string}`
  status: 'success' | 'reverted'
  gasUsed: bigint
  logs: readonly {
    address: `0x${string}`
    topics: readonly `0x${string}`[]
    data: `0x${string}`
  }[]
}

/**
 * Abstracts Ethereum contract operations.
 * Uses viem under the hood for type-safe contract interactions.
 *
 * Browser: wraps viem with WalletClient from browser wallet
 * Node.js: wraps viem with account from private key
 */
export interface ContractProvider {
  // Read operations (no transaction)
  /** Read contract state */
  readContract<T>(args: ReadContractParameters): Promise<T>

  /** Simulate contract call before sending */
  simulateContract(args: SimulateContractParameters): Promise<SimulateContractResult>

  // Write operations (creates transaction)
  /** Write to contract (returns tx hash) */
  writeContract(args: WriteContractParameters): Promise<`0x${string}`>

  /** Wait for transaction confirmation */
  waitForTransaction(
    hash: `0x${string}`,
    confirmations?: number
  ): Promise<TransactionReceipt>

  // Gas utilities
  /** Estimate gas for transaction */
  estimateGas(args: EstimateGasParameters): Promise<bigint>

  /** Get current gas price */
  getGasPrice(): Promise<bigint>

  // Chain info
  /** Get current chain ID */
  getChainId(): Promise<number>

  /** Get current block number */
  getBlockNumber(): Promise<bigint>
}

// ============================================================================
// Adapter Context
// ============================================================================

/**
 * Combined adapter context for dependency injection.
 * Pass to SDK client constructor for full configuration.
 */
export interface AdapterContext {
  storage: StorageAdapter
  config: ConfigProvider
  crypto: CryptoProvider
  encoding: EncodingProvider
  file?: FileProvider
  download?: DownloadProvider
  wallet?: WalletProvider
  contract?: ContractProvider
}
