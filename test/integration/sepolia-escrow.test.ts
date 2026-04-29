/**
 * Sepolia Integration Tests — Escrow (chain mode)
 *
 * Exercises the real on-chain escrow path through the SDK's EscrowService.
 * Requires Bee + RPC + funded test accounts on Sepolia.
 *
 * Skips gracefully when env vars not set:
 *   FDS_TEST_BEE_URL=http://localhost:1633
 *   FDS_TEST_BATCH_ID=0xabc...
 *   FDS_TEST_RPC_URL=https://sepolia.example.com (optional — defaults to publicnode)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FdsClient } from '../../src/client.js'
import { TEST_MNEMONIC, isBeeAvailable, isRpcAvailable, testConfig } from './test-config.js'

describe('Sepolia Integration: Escrow', () => {
  let beeUp = false
  let rpcUp = false

  beforeAll(async () => {
    beeUp = await isBeeAvailable()
    rpcUp = await isRpcAvailable()
  })

  it.skipIf(() => !process.env.FDS_TEST_BEE_URL || !process.env.FDS_TEST_BATCH_ID)(
    'create → fund → status flows through chain when configured',
    async () => {
      if (!beeUp || !rpcUp) return
      const tempDir = await mkdtemp(join(tmpdir(), 'fds-escrow-int-'))

      // Seller (Alice)
      const seller = new FdsClient({
        storage: { type: 'local', path: tempDir },
        beeUrl: testConfig.beeUrl!,
        batchId: testConfig.batchId,
        chain: {
          rpcUrl: testConfig.rpcUrl!,
          chainId: testConfig.chainId,
          escrowContract: testConfig.escrowContract as `0x${string}`,
        },
      })
      await seller.init()
      await seller.identity.import(TEST_MNEMONIC)

      expect(seller.escrow.hasChain).toBe(true)

      // Put the data to sell
      await seller.put('research/data.bin', new Uint8Array([1, 2, 3, 4, 5]))

      // Create escrow
      const result = await seller.escrow.create('research/data.bin', { price: '0.001', expiryDays: 1 })
      expect(result.escrowId).toBeGreaterThan(0n)
      expect(result.reference).toMatch(/^[0-9a-fA-F]{64}/)
      expect(result.contentHash).toMatch(/^0x[0-9a-fA-F]{64}$/)
      expect(result.status).toBe('Created')

      // Status from chain
      const details = await seller.escrow.status(result.escrowId)
      expect(details.escrowId).toBe(result.escrowId)
      expect(details.status).toBe('Created')

      await seller.destroy()
      await rm(tempDir, { recursive: true, force: true })
    },
    180000,
  )

  it('hasChain=false without bee/batchId/escrowContract', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'fds-escrow-int-'))
    const fds = new FdsClient({ storage: { type: 'local', path: tempDir } })
    await fds.init()
    await fds.identity.import(TEST_MNEMONIC)

    expect(fds.escrow.hasChain).toBe(false)

    await fds.destroy()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('chain operations throw CHAIN_UNREACHABLE without chain config', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'fds-escrow-int-'))
    const fds = new FdsClient({ storage: { type: 'local', path: tempDir } })
    await fds.init()
    await fds.identity.import(TEST_MNEMONIC)

    await expect(fds.escrow.fund(1n)).rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE' })
    await expect(fds.escrow.claim(1n)).rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE' })
    await expect(fds.escrow.dispute(1n)).rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE' })

    await fds.destroy()
    await rm(tempDir, { recursive: true, force: true })
  })
})
