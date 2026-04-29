/**
 * Viem-based ContractProvider Implementation
 *
 * Provides type-safe Ethereum contract interactions using viem.
 * Supports both browser wallets and embedded accounts.
 */

import {
  createPublicClient,
  http,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Transport,
  type Account,
} from 'viem'
import type {
  ContractProvider,
  ReadContractParameters,
  SimulateContractParameters,
  SimulateContractResult,
  WriteContractParameters,
  EstimateGasParameters,
  TransactionReceipt,
} from '../adapters/types.js'

// ============================================================================
// Types
// ============================================================================

export interface ViemContractProviderOptions {
  /** RPC URL or custom transport */
  transport: Transport
  /** Chain configuration */
  chain: Chain
  /** Wallet client for signing transactions */
  walletClient: WalletClient<Transport, Chain, Account>
  /** Gas buffer percentage (default: 20) */
  gasBufferPercent?: number
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a ContractProvider using viem
 */
export function createViemContractProvider(
  options: ViemContractProviderOptions
): ContractProvider {
  const { transport, chain, walletClient, gasBufferPercent = 20 } = options

  const publicClient: PublicClient = createPublicClient({
    transport,
    chain,
  })

  return {
    async readContract<T>(args: ReadContractParameters): Promise<T> {
      const result = await publicClient.readContract({
        address: args.address,
        abi: args.abi as readonly unknown[],
        functionName: args.functionName,
        args: args.args as readonly unknown[],
      })
      return result as T
    },

    async simulateContract(
      args: SimulateContractParameters
    ): Promise<SimulateContractResult> {
      const simulateParams = {
        address: args.address,
        abi: args.abi as readonly unknown[],
        functionName: args.functionName,
        args: args.args as readonly unknown[],
        account: args.account ?? walletClient.account,
        value: args.value,
      } as Parameters<typeof publicClient.simulateContract>[0]

      const { result, request } = await publicClient.simulateContract(simulateParams)

      return {
        result,
        request: {
          address: request.address,
          abi: request.abi as readonly unknown[],
          functionName: request.functionName,
          args: request.args as readonly unknown[],
          value: request.value,
          gas: request.gas,
        },
      }
    },

    async writeContract(args: WriteContractParameters): Promise<`0x${string}`> {
      const writeParams = {
        address: args.address,
        abi: args.abi as readonly unknown[],
        functionName: args.functionName,
        args: args.args as readonly unknown[],
        value: args.value,
        gas: args.gas,
        chain,
      } as Parameters<typeof walletClient.writeContract>[0]

      const hash = await walletClient.writeContract(writeParams)
      return hash
    },

    async waitForTransaction(
      hash: `0x${string}`,
      confirmations = 1
    ): Promise<TransactionReceipt> {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations,
      })

      return {
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        status: receipt.status,
        gasUsed: receipt.gasUsed,
        logs: receipt.logs.map((log) => ({
          address: log.address,
          topics: log.topics as readonly `0x${string}`[],
          data: log.data,
        })),
      }
    },

    async estimateGas(args: EstimateGasParameters): Promise<bigint> {
      const estimate = await publicClient.estimateGas({
        to: args.to,
        data: args.data,
        value: args.value,
        account: walletClient.account,
      })

      // Add buffer for safety
      const buffer = (estimate * BigInt(gasBufferPercent)) / 100n
      return estimate + buffer
    },

    async getGasPrice(): Promise<bigint> {
      return publicClient.getGasPrice()
    },

    async getChainId(): Promise<number> {
      return publicClient.getChainId()
    },

    async getBlockNumber(): Promise<bigint> {
      return publicClient.getBlockNumber()
    },
  }
}

// ============================================================================
// Convenience Factory
// ============================================================================

/**
 * Create ContractProvider from RPC URL and wallet client
 */
export function createContractProviderFromUrl(
  rpcUrl: string,
  chain: Chain,
  walletClient: WalletClient<Transport, Chain, Account>
): ContractProvider {
  return createViemContractProvider({
    transport: http(rpcUrl),
    chain,
    walletClient,
  })
}
