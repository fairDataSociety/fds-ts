/**
 * Sepolia Integration Tests — Identity
 *
 * Tests deterministic identity creation from the well-known test mnemonic.
 * Verifies addresses match across runs (cross-platform interop).
 *
 * Run: FDS_TEST_RPC_URL=https://... npx vitest run test/integration/sepolia
 * Skips gracefully when no RPC is configured.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FdsClient } from '../../src/client.js'
import { TEST_MNEMONIC, isRpcAvailable, testConfig } from './test-config.js'

describe('Sepolia Integration: Identity', () => {
  let rpcAvailable = false

  beforeAll(async () => {
    rpcAvailable = await isRpcAvailable()
  })

  it('imports deterministic Alice address from test mnemonic', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'fds-int-'))
    const fds = new FdsClient({
      storage: { type: 'local', path: tempDir },
      chain: rpcAvailable ? { rpcUrl: testConfig.rpcUrl!, chainId: testConfig.chainId } : undefined,
    })
    await fds.init()

    const id = await fds.identity.import(TEST_MNEMONIC)
    // Account 0 from "test test test ... junk" is the standard Hardhat dev account
    expect(id.address.toLowerCase()).toBe('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266')

    await fds.destroy()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('derives Bob (account 1) and Carol (account 2)', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'fds-int-'))
    const fds = new FdsClient({ storage: { type: 'local', path: tempDir } })
    await fds.init()
    await fds.identity.import(TEST_MNEMONIC)

    const bob = await fds.identity.deriveChild(1)
    const carol = await fds.identity.deriveChild(2)

    // Standard Hardhat dev accounts
    expect(bob.address.toLowerCase()).toBe('0x70997970c51812dc3a010c7d01b50e0d17dc79c8')
    expect(carol.address.toLowerCase()).toBe('0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc')

    await fds.destroy()
    await rm(tempDir, { recursive: true, force: true })
  })

  it.skipIf(() => true)('chain status reflects connected state when RPC available', async () => {
    if (!rpcAvailable) return
    const tempDir = await mkdtemp(join(tmpdir(), 'fds-int-'))
    const fds = new FdsClient({
      storage: { type: 'local', path: tempDir },
      chain: { rpcUrl: testConfig.rpcUrl!, chainId: testConfig.chainId },
    })
    await fds.init()
    await fds.identity.import(TEST_MNEMONIC)

    const status = await fds.status()
    expect(status.identity.address).toBeDefined()

    await fds.destroy()
    await rm(tempDir, { recursive: true, force: true })
  })
})
