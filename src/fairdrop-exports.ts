/**
 * @fairdatasociety/fds/fairdrop — Fairdrop primitives (drop-in for @fairdrop/sdk).
 *
 * Exposes GSOC inbox primitives, DataEscrow ABI + EscrowKeystore, and the
 * Fairdrop type shapes that downstream code depends on.
 *
 * For the high-level send/receive/escrow API, use FdsClient instead.
 *
 * The internal FairdropClient class is intentionally NOT re-exported here —
 * use FdsClient.transfer / FdsClient.escrow for stable typed access. If a
 * consumer needs the lower-level FairdropClient, import it directly from
 * the source path within the package.
 */

// SDK type shapes
export type {
  FairdropClientOptions,
  UploadOptions,
  SendOptions as FairdropSendOptions,
  SendResult as FairdropSendResult,
  AccountSummary,
  InboxParams,
  StampInfo,
  ConnectionStatus,
  Message,
  HonestInbox,
  AnonymousMessage,
  InboxCallbacks,
  InboxSubscription as FairdropInboxSubscription,
  EscrowMetadata,
  CreateEscrowOptions,
  CreateEscrowResult,
  EscrowDetails as FairdropEscrowDetails,
  VerificationResult,
  CommitKeyResult,
  RevealKeyResult,
  ReputationResult,
  UnsignedTransaction,
  PrepareEscrowResult,
  PrepareCommitKeyResult,
  PrepareTransactionResult,
} from './fairdrop/sdk-types.js'
export { EscrowState } from './fairdrop/sdk-types.js'

// GSOC inbox primitives
export {
  INBOX_PREFIX,
  getIndexedIdentifier,
  mineInboxKey,
  deriveInboxKey,
  getInboxOwner,
  writeToInbox,
  readInboxSlot,
  pollInbox,
  findNextSlot,
  subscribeToInbox,
  hasMessages,
} from './fairdrop/gsoc.js'
export type { MinedInbox, SubscriptionCallbacks, GSOCSubscription } from './fairdrop/gsoc.js'

// EscrowKeystore (escrow key crash recovery)
export { EscrowKeystore } from './fairdrop/escrow-keystore.js'
export type { EscrowKeyEntry, EscrowKeyData } from './fairdrop/escrow-keystore.js'

// DataEscrow ABI for direct contract interaction
export { DataEscrowABI } from './fairdrop/abi/DataEscrow.js'
