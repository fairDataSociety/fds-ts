/**
 * Integration test configuration.
 *
 * Connects to Sepolia + Bee node when available. Tests skip gracefully
 * when not available, so the unit suite keeps running.
 *
 * Test accounts (deterministic from well-known mnemonic):
 *   index 0: Alice    (funded — seller/owner)
 *   index 1: Bob      (funded — buyer/subscriber)
 *   index 2: Carol    (funded — secondary user)
 *   index 3: Arbiter  (funded — dispute resolver)
 *   index 10: Eve     (UNFUNDED — insufficient funds tests)
 *   index 11: Frank   (UNFUNDED — expired stamp tests)
 *   index 12: Grace   (UNFUNDED — zero-balance tests)
 */

export const TEST_MNEMONIC =
  'test test test test test test test test test test test junk'

export const TEST_ACCOUNT_INDEX = {
  alice: 0,
  bob: 1,
  carol: 2,
  arbiter: 3,
  eve: 10,
  frank: 11,
  grace: 12,
} as const

export interface TestConfig {
  beeUrl?: string
  rpcUrl?: string
  batchId?: string
  chainId: number
  escrowContract: string
}

const DEFAULT_BEE = process.env.FDS_TEST_BEE_URL || ''  // empty = skip Bee tests
const DEFAULT_RPC = process.env.FDS_TEST_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'
const DEFAULT_BATCH = process.env.FDS_TEST_BATCH_ID || ''  // empty = no uploads
const SEPOLIA_CHAIN_ID = 11155111
// DataEscrowV4 proxy on Sepolia (verified deployed, owner/arbiter 0x800e...033b)
const SEPOLIA_DATA_ESCROW = '0x6915ecEe85dC44457324c7243E44a4E68c0eA112'

export const testConfig: TestConfig = {
  beeUrl: DEFAULT_BEE || undefined,
  rpcUrl: DEFAULT_RPC,
  batchId: DEFAULT_BATCH || undefined,
  chainId: SEPOLIA_CHAIN_ID,
  escrowContract: SEPOLIA_DATA_ESCROW,
}

/** Whether Bee node is configured and reachable. Used by `it.skipIf`. */
export async function isBeeAvailable(): Promise<boolean> {
  if (!testConfig.beeUrl) return false
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    const res = await fetch(`${testConfig.beeUrl}/health`, { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

/** Whether RPC is reachable for chain tests. */
export async function isRpcAvailable(): Promise<boolean> {
  if (!testConfig.rpcUrl) return false
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    const res = await fetch(testConfig.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}
