/**
 * Adapter interfaces for cross-environment compatibility.
 * Re-export all types from types.ts
 */

export type {
  StorageAdapter,
  ConfigProvider,
  CryptoProvider,
  WalletProvider,
  FileProvider,
  DownloadProvider,
  EncodingProvider,
  AdapterContext,
  TypedData,
  // Contract Provider types (escrow operations)
  ContractProvider,
  ReadContractParameters,
  SimulateContractParameters,
  SimulateContractResult,
  WriteContractParameters,
  EstimateGasParameters,
  TransactionReceipt,
} from './types.js'
