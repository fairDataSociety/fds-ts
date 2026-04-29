/**
 * Bee Smoke Tests — Real Network Validation
 *
 * Skips gracefully when Bee is unavailable.
 * Run with: FDS_TEST_BEE_URL=http://localhost:1633 FDS_TEST_BATCH_ID=... npx vitest
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { isBeeAvailable, testConfig } from './test-config.js'

describe('Bee Smoke', () => {
  let beeAvailable = false

  beforeAll(async () => {
    beeAvailable = await isBeeAvailable()
    if (!beeAvailable) {
      console.warn('[skip] Bee node not available at', testConfig.beeUrl ?? '<unset>')
    }
  })

  it.skipIf(!process.env.FDS_TEST_BEE_URL)('Bee /health responds', async () => {
    if (!beeAvailable) return
    const res = await fetch(`${testConfig.beeUrl}/health`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  it.skipIf(!process.env.FDS_TEST_BEE_URL)('Bee /stamps lists postage batches', async () => {
    if (!beeAvailable) return
    const res = await fetch(`${testConfig.beeUrl}/stamps`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body.stamps)).toBe(true)
  })

  it('config has well-known test endpoints', () => {
    expect(testConfig.chainId).toBe(11155111) // Sepolia
    expect(testConfig.rpcUrl).toMatch(/^https?:\/\//)
    expect(testConfig.escrowContract).toMatch(/^0x[0-9a-fA-F]+$/)
  })
})
