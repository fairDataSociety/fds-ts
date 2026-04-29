/**
 * Contract Provider Module
 *
 * Provides abstractions for Ethereum contract interactions.
 */

export {
  createViemContractProvider,
  createContractProviderFromUrl,
  type ViemContractProviderOptions,
} from './viem.js'

// Re-export types for convenience
export type {
  ContractProvider,
  ReadContractParameters,
  SimulateContractParameters,
  SimulateContractResult,
  WriteContractParameters,
  EstimateGasParameters,
  TransactionReceipt,
} from '../adapters/types.js'
