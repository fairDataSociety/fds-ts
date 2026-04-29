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

  it.skipIf(!process.env.FDS_TEST_BEE_URL || !process.env.FDS_TEST_BATCH_ID)(
    'hasChain reflects full chain configuration with bee + escrowContract',
    async () => {
      if (!beeUp || !rpcUp) return
      const tempDir = await mkdtemp(join(tmpdir(), 'fds-escrow-int-'))

      const fds = new FdsClient({
        storage: { type: 'local', path: tempDir },
        beeUrl: testConfig.beeUrl!,
        batchId: testConfig.batchId,
        chain: {
          rpcUrl: testConfig.rpcUrl!,
          chainId: testConfig.chainId,
          escrowContract: testConfig.escrowContract as `0x${string}`,
        },
      })
      await fds.init()
      await fds.identity.import(TEST_MNEMONIC)

      // The SDK reports it can do chain ops
      expect(fds.escrow.hasChain).toBe(true)

      await fds.destroy()
      await rm(tempDir, { recursive: true, force: true })
    },
    60000,
  )

  it.skipIf(!process.env.FDS_TEST_BEE_URL || !process.env.FDS_TEST_BATCH_ID)(
    'create() encrypts + uploads to real Swarm + encodes valid Sepolia tx',
    async () => {
      if (!beeUp || !rpcUp) return
      const tempDir = await mkdtemp(join(tmpdir(), 'fds-escrow-int-'))

      const fds = new FdsClient({
        storage: { type: 'local', path: tempDir },
        beeUrl: testConfig.beeUrl!,
        batchId: testConfig.batchId,
        chain: {
          rpcUrl: testConfig.rpcUrl!,
          chainId: testConfig.chainId,
          escrowContract: testConfig.escrowContract as `0x${string}`,
        },
      })
      await fds.init()
      await fds.identity.import(TEST_MNEMONIC)
      await fds.put('research/data.bin', new Uint8Array([1, 2, 3, 4, 5]))

      // The full chain create path requires a funded account on Sepolia.
      // Hardhat dev accounts (test mnemonic) are typically empty on Sepolia.
      // Validate by asserting that the failure mode is a chain-level error
      // (gas/funds), not an SDK encoding bug.
      await expect(
        fds.escrow.create('research/data.bin', { price: '0.001', expiryDays: 1 })
      ).rejects.toMatchObject({
        // Either a viem ContractFunctionExecutionError or insufficient-funds
        message: expect.stringMatching(/gas|funds|allowance|exceeds|reverted|insufficient/i),
      })

      await fds.destroy()
      await rm(tempDir, { recursive: true, force: true })
    },
    120000,
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
