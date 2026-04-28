/**
 * FDS Error handling — every error has a code and a recovery suggestion.
 */

export enum FdsErrorCode {
  // Identity
  NO_IDENTITY = 'NO_IDENTITY',
  IDENTITY_LOCKED = 'IDENTITY_LOCKED',

  // Storage
  NO_STORAGE = 'NO_STORAGE',
  BUCKET_NOT_FOUND = 'BUCKET_NOT_FOUND',
  BUCKET_EXISTS = 'BUCKET_EXISTS',
  BUCKET_NOT_EMPTY = 'BUCKET_NOT_EMPTY',
  OBJECT_NOT_FOUND = 'OBJECT_NOT_FOUND',

  // Stamps (Swarm-specific)
  NO_STAMP = 'NO_STAMP',
  STAMP_EXPIRED = 'STAMP_EXPIRED',

  // Transfer
  ENS_NOT_FOUND = 'ENS_NOT_FOUND',
  RECIPIENT_NO_PUBKEY = 'RECIPIENT_NO_PUBKEY',

  // Sharing
  ACT_DENIED = 'ACT_DENIED',

  // Escrow
  ESCROW_WRONG_STATE = 'ESCROW_WRONG_STATE',
  ESCROW_EXPIRED = 'ESCROW_EXPIRED',
  ESCROW_NOT_FOUND = 'ESCROW_NOT_FOUND',

  // Chain
  CHAIN_UNREACHABLE = 'CHAIN_UNREACHABLE',

  // Adapter
  ADAPTER_UNSUPPORTED = 'ADAPTER_UNSUPPORTED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',

  // General
  INVALID_INPUT = 'INVALID_INPUT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/** Recovery suggestions for each error code */
const RECOVERY: Record<FdsErrorCode, string> = {
  [FdsErrorCode.NO_IDENTITY]: 'Call fds.identity.create() or fds.identity.import(mnemonic)',
  [FdsErrorCode.IDENTITY_LOCKED]: 'Call fds.identity.unlock(password)',
  [FdsErrorCode.NO_STORAGE]: 'Storage adapter not connected. Check configuration and call fds.status()',
  [FdsErrorCode.BUCKET_NOT_FOUND]: 'Bucket does not exist. Use fds.storage.createBucket() or fds.put() auto-creates',
  [FdsErrorCode.BUCKET_EXISTS]: 'Bucket already exists',
  [FdsErrorCode.BUCKET_NOT_EMPTY]: 'Delete all objects before deleting the bucket',
  [FdsErrorCode.OBJECT_NOT_FOUND]: 'Object does not exist. Check the key with fds.storage.list()',
  [FdsErrorCode.NO_STAMP]: 'No usable postage stamps. Assign one with fds.stamps.assign(batchId) or use a gateway',
  [FdsErrorCode.STAMP_EXPIRED]: 'Stamp TTL expired. Top up or buy a new stamp',
  [FdsErrorCode.ENS_NOT_FOUND]: 'ENS name does not resolve. Verify the name or provide address/pubkey directly',
  [FdsErrorCode.RECIPIENT_NO_PUBKEY]: 'Recipient has no public key on-chain. They need to register or provide pubkey',
  [FdsErrorCode.ACT_DENIED]: 'No access to this shared content. Request access from the owner',
  [FdsErrorCode.ESCROW_WRONG_STATE]: 'Invalid operation for current escrow state. Check fds.escrow.status()',
  [FdsErrorCode.ESCROW_EXPIRED]: 'Escrow has expired. Buyer: call claimExpired(). Seller: create a new escrow',
  [FdsErrorCode.ESCROW_NOT_FOUND]: 'Escrow ID does not exist on-chain',
  [FdsErrorCode.CHAIN_UNREACHABLE]: 'RPC endpoint not responding. Check chain.rpcUrl configuration',
  [FdsErrorCode.ADAPTER_UNSUPPORTED]: 'This operation is not supported by the current storage adapter. Check capabilities',
  [FdsErrorCode.FILE_TOO_LARGE]: 'File exceeds maximum upload size for this adapter',
  [FdsErrorCode.INVALID_INPUT]: 'Invalid input. Check the parameters',
  [FdsErrorCode.INTERNAL_ERROR]: 'Internal SDK error. Please report this issue',
}

export class FdsError extends Error {
  readonly code: FdsErrorCode
  readonly recovery: string
  readonly cause?: Error

  constructor(code: FdsErrorCode, message?: string, cause?: Error) {
    const fullMessage = message ?? RECOVERY[code]
    super(fullMessage)
    this.name = 'FdsError'
    this.code = code
    this.recovery = RECOVERY[code]
    this.cause = cause
  }
}

/** Create an FdsError with code + optional message + optional cause */
export function fdsError(code: FdsErrorCode, message?: string, cause?: Error): FdsError {
  return new FdsError(code, message, cause)
}
