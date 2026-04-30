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

// Adapter providers (Node.js)
export { FileStorageAdapter, MemoryStorageAdapter } from './fairdrop/storage/node.js'
export { NodeCryptoProvider, BrowserCryptoProvider } from './fairdrop/crypto/index.js'
export { EnvConfigProvider, StaticConfigProvider } from './fairdrop/config/node.js'
export { NodeEncodingProvider } from './fairdrop/encoding/node.js'

// Contract address resolution
export { getDataEscrowAddress, isEscrowSupported } from './fairdrop/config/contracts.js'

// Adapter type interfaces (for consumers building their own providers)
export type {
  StorageAdapter,
  CryptoProvider,
  EncodingProvider,
  ConfigProvider,
  WalletProvider,
  ContractProvider,
  TransactionReceipt,
  ReadContractParameters,
  WriteContractParameters,
  SimulateContractParameters,
  SimulateContractResult,
  EstimateGasParameters,
  TypedData as FairdropTypedData,
} from './fairdrop/adapters/types.js'

// Errors
export { FairdropError, FairdropErrorCode } from './fairdrop/errors/index.js'

// FairdropClient — full client (advanced consumers).
// NOTE: Type signatures inherited from the original FairdropClient
// have known mismatches with bee-js v11; SDK consumers should prefer
// FdsClient. Exposed here to unblock @fairdrop/mcp migration.
export { FairdropClient } from './fairdrop/client.js'
