/**
 * EscrowService — trustless data exchange on Base chain.
 *
 * Wraps @fairdrop/sdk escrow methods: createEscrow, fundEscrow,
 * commitKeyRelease, revealKey, claimPayment, disputeEscrow, etc.
 *
 * All 11 contract states supported:
 * Created, Funded, KeyCommitted, Released, Claimed,
 * Expired, Cancelled, Disputed, SellerResponded, ResolvedBuyer, ResolvedSeller
 */

import type { EscrowDetails, EscrowCreateOptions, EscrowCreateResult, EscrowStatus } from '../types.js'
import { FdsError, FdsErrorCode } from '../errors.js'

export class EscrowService {
  /** Create escrow: encrypt data + upload + set price. */
  async create(key: string, opts: EscrowCreateOptions): Promise<EscrowCreateResult> {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'EscrowService requires @fairdrop/sdk')
  }

  /** Buy: fund escrow + wait for key reveal + decrypt + download. */
  async buy(escrowId: bigint): Promise<Uint8Array> {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'EscrowService requires @fairdrop/sdk')
  }

  /** Get escrow details from chain. */
  async status(escrowId: bigint): Promise<EscrowDetails> {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'EscrowService requires @fairdrop/sdk')
  }

  /** Seller claims payment after key reveal + dispute window. */
  async claim(escrowId: bigint): Promise<string> {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'EscrowService requires @fairdrop/sdk')
  }

  /** Buyer disputes (5% bond, within dispute window). */
  async dispute(escrowId: bigint): Promise<string> {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'EscrowService requires @fairdrop/sdk')
  }

  /** Buyer claims refund on expired escrow. */
  async claimExpired(escrowId: bigint): Promise<string> {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'EscrowService requires @fairdrop/sdk')
  }

  /** Check seller reputation. */
  async reputation(escrowId: bigint): Promise<{ score: number; tier: string }> {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'EscrowService requires @fairdrop/sdk')
  }

  /** Recover stored escrow keys (crash recovery). */
  async recoverKeys(escrowId: string, password: string): Promise<any> {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'EscrowService requires @fairdrop/sdk')
  }

  /** List stored escrow key metadata. */
  async listKeys(): Promise<any[]> {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'EscrowService requires @fairdrop/sdk')
  }

  /** Keyless gateway: prepare unsigned transactions for server-side relay. */
  readonly prepare = {
    create: async (...args: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Gateway escrow requires @fairdrop/sdk') },
    fund: async (...args: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Gateway escrow requires @fairdrop/sdk') },
    commitKey: async (...args: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Gateway escrow requires @fairdrop/sdk') },
    revealKey: async (...args: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Gateway escrow requires @fairdrop/sdk') },
    claim: async (...args: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Gateway escrow requires @fairdrop/sdk') },
    dispute: async (...args: any[]) => { throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'Gateway escrow requires @fairdrop/sdk') },
  }
}
