/**
 * Contract Addresses
 *
 * Deployed DataEscrow contracts for each network.
 * Update these when deploying to new chains.
 */

export const DATA_ESCROW_ADDRESSES: Record<number, `0x${string}`> = {
  // Base Mainnet (deployed 2026-02-02)
  8453: '0x69Aa385686AEdA505013a775ddE7A59d045cb30d',

  // Sepolia Testnet (redeployed 2026-01-11)
  11155111: '0xfD9A47e3466576671C1d36f9a347cd27ea24d979',
}

/**
 * Get DataEscrow contract address for a chain
 */
export function getDataEscrowAddress(chainId: number): `0x${string}` | undefined {
  return DATA_ESCROW_ADDRESSES[chainId]
}

/**
 * Check if DataEscrow is deployed on a chain
 */
export function isEscrowSupported(chainId: number): boolean {
  return chainId in DATA_ESCROW_ADDRESSES
}
