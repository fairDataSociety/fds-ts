/**
 * Fairdrop Error Taxonomy
 *
 * Structured error codes and error class for consistent
 * error handling across SDK, MCP, and web app.
 */

/**
 * Error codes for Fairdrop operations.
 * Used to identify error types for programmatic handling.
 */
export enum FairdropErrorCode {
  // ============================================================================
  // Network Errors
  // ============================================================================
  /** Failed to connect to Bee node */
  BEE_CONNECTION_FAILED = 'BEE_CONNECTION_FAILED',
  /** Failed to upload content to Swarm */
  SWARM_UPLOAD_FAILED = 'SWARM_UPLOAD_FAILED',
  /** Failed to download content from Swarm */
  SWARM_DOWNLOAD_FAILED = 'SWARM_DOWNLOAD_FAILED',
  /** Network operation timed out */
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',

  // ============================================================================
  // Configuration Errors
  // ============================================================================
  /** Required configuration value is missing */
  CONFIG_MISSING = 'CONFIG_MISSING',

  // ============================================================================
  // Authentication Errors
  // ============================================================================
  /** Account not found in storage */
  ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
  /** Account is locked (password not provided) */
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  /** Invalid password provided */
  INVALID_PASSWORD = 'INVALID_PASSWORD',
  /** Session has expired, re-authentication required */
  SESSION_EXPIRED = 'SESSION_EXPIRED',

  // ============================================================================
  // Cryptographic Errors
  // ============================================================================
  /** Failed to decrypt content */
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
  /** Invalid encryption key */
  INVALID_KEY = 'INVALID_KEY',
  /** Failed to sign message */
  SIGNATURE_FAILED = 'SIGNATURE_FAILED',

  // ============================================================================
  // File Errors
  // ============================================================================
  /** File exceeds maximum allowed size */
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  /** Invalid file format */
  INVALID_FILE_FORMAT = 'INVALID_FILE_FORMAT',

  // ============================================================================
  // Postage Stamp Errors
  // ============================================================================
  /** No postage stamp available */
  NO_STAMP_AVAILABLE = 'NO_STAMP_AVAILABLE',
  /** Postage stamp has been exhausted */
  STAMP_EXHAUSTED = 'STAMP_EXHAUSTED',

  // ============================================================================
  // Inbox Errors
  // ============================================================================
  /** Inbox not found */
  INBOX_NOT_FOUND = 'INBOX_NOT_FOUND',
  /** Failed to write to GSOC inbox */
  GSOC_WRITE_FAILED = 'GSOC_WRITE_FAILED',

  // ============================================================================
  // ENS Errors
  // ============================================================================
  /** Failed to resolve ENS name */
  ENS_RESOLUTION_FAILED = 'ENS_RESOLUTION_FAILED',

  // ============================================================================
  // Wallet Errors
  // ============================================================================
  /** Wallet not connected */
  WALLET_NOT_CONNECTED = 'WALLET_NOT_CONNECTED',
  /** User rejected wallet action */
  USER_REJECTED = 'USER_REJECTED',

  // ============================================================================
  // Escrow Errors
  // ============================================================================
  /** Failed to create escrow on-chain */
  ESCROW_CREATE_FAILED = 'ESCROW_CREATE_FAILED',
  /** Escrow not found on-chain */
  ESCROW_NOT_FOUND = 'ESCROW_NOT_FOUND',
  /** Escrow has already been funded */
  ESCROW_ALREADY_FUNDED = 'ESCROW_ALREADY_FUNDED',
  /** Key has already been released */
  ESCROW_ALREADY_RELEASED = 'ESCROW_ALREADY_RELEASED',
  /** Escrow has expired */
  ESCROW_EXPIRED = 'ESCROW_EXPIRED',
  /** Invalid encryption key (commitment mismatch) */
  ESCROW_INVALID_KEY = 'ESCROW_INVALID_KEY',
  /** Dispute window has closed */
  ESCROW_DISPUTE_WINDOW_CLOSED = 'ESCROW_DISPUTE_WINDOW_CLOSED',
  /** Insufficient funds to fund escrow */
  ESCROW_INSUFFICIENT_FUNDS = 'ESCROW_INSUFFICIENT_FUNDS',
  /** Failed to estimate gas for escrow transaction */
  ESCROW_GAS_ESTIMATION_FAILED = 'ESCROW_GAS_ESTIMATION_FAILED',
  /** Escrow contract is paused */
  ESCROW_CONTRACT_PAUSED = 'ESCROW_CONTRACT_PAUSED',
  /** Contract simulation failed before sending tx */
  ESCROW_SIMULATION_FAILED = 'ESCROW_SIMULATION_FAILED',
  /** Reveal attempted too soon (must wait for commit delay) */
  ESCROW_REVEAL_TOO_SOON = 'ESCROW_REVEAL_TOO_SOON',
  /** Invalid escrow state for requested operation */
  ESCROW_INVALID_STATE = 'ESCROW_INVALID_STATE',

  // ============================================================================
  // ACT (Access Control Trie) Errors
  // ============================================================================
  /** Permission denied to access ACT-protected content */
  ACT_PERMISSION_DENIED = 'ACT_PERMISSION_DENIED',
  /** Invalid grantee public key format */
  ACT_GRANTEE_INVALID = 'ACT_GRANTEE_INVALID',
  /** ACT manifest is corrupted or invalid */
  ACT_MANIFEST_CORRUPTED = 'ACT_MANIFEST_CORRUPTED',
  /** Access has been revoked for this key */
  ACT_KEY_REVOKED = 'ACT_KEY_REVOKED',
  /** Failed to update grantee list */
  ACT_UPDATE_FAILED = 'ACT_UPDATE_FAILED',
}

/**
 * Structured error class for Fairdrop operations.
 * Includes error code, recoverability, and retry hints.
 */
export class FairdropError extends Error {
  /**
   * @param code - Error code from FairdropErrorCode enum
   * @param message - Human-readable error message
   * @param recoverable - Whether the error is recoverable (user can retry)
   * @param retryable - Whether automatic retry might succeed
   * @param cause - Original error that caused this error
   */
  constructor(
    public readonly code: FairdropErrorCode,
    message: string,
    public readonly recoverable: boolean = true,
    public readonly retryable: boolean = false,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'FairdropError'

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FairdropError)
    }
  }

  /**
   * Create a string representation including code
   */
  toString(): string {
    return `FairdropError [${this.code}]: ${this.message}`
  }

  /**
   * Create JSON representation for logging/serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      retryable: this.retryable,
      stack: this.stack,
      cause: this.cause?.message,
    }
  }
}

// ============================================================================
// Error Factory Functions
// ============================================================================

/**
 * Create a network error
 */
export function networkError(
  code: FairdropErrorCode,
  message: string,
  cause?: Error
): FairdropError {
  return new FairdropError(code, message, true, true, cause)
}

/**
 * Create a configuration error (non-recoverable)
 */
export function configError(key: string): FairdropError {
  return new FairdropError(
    FairdropErrorCode.CONFIG_MISSING,
    `Missing required configuration: ${key}`,
    false,
    false
  )
}

/**
 * Create an authentication error
 */
export function authError(
  code: FairdropErrorCode,
  message: string
): FairdropError {
  return new FairdropError(code, message, true, false)
}

/**
 * Create a crypto error (non-retryable)
 */
export function cryptoError(
  code: FairdropErrorCode,
  message: string,
  cause?: Error
): FairdropError {
  return new FairdropError(code, message, true, false, cause)
}

/**
 * Check if an error is a FairdropError
 */
export function isFairdropError(error: unknown): error is FairdropError {
  return error instanceof FairdropError
}

/**
 * Wrap an unknown error as a FairdropError
 */
export function wrapError(
  error: unknown,
  code: FairdropErrorCode,
  message?: string
): FairdropError {
  if (isFairdropError(error)) {
    return error
  }

  const cause = error instanceof Error ? error : new Error(String(error))
  return new FairdropError(
    code,
    message ?? cause.message,
    true,
    false,
    cause
  )
}

/**
 * Create an escrow error
 */
export function escrowError(
  code: FairdropErrorCode,
  message: string,
  cause?: Error
): FairdropError {
  // Most escrow errors are recoverable but not automatically retryable
  const retryable =
    code === FairdropErrorCode.ESCROW_GAS_ESTIMATION_FAILED ||
    code === FairdropErrorCode.ESCROW_SIMULATION_FAILED

  return new FairdropError(code, message, true, retryable, cause)
}

/**
 * Create an ACT error
 */
export function actError(
  code: FairdropErrorCode,
  message: string,
  cause?: Error
): FairdropError {
  // ACT errors are generally recoverable
  const retryable = code === FairdropErrorCode.ACT_UPDATE_FAILED

  return new FairdropError(code, message, true, retryable, cause)
}
