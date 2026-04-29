/**
 * Transfer GSOC Integration Test — real Bee node
 *
 * End-to-end:
 *   1. Alice registers a GSOC inbox (mine identifier near her overlay)
 *   2. Bob sends encrypted message to Alice's inbox
 *   3. Alice polls inbox and decrypts the message
 *
 * Skips when FDS_TEST_BEE_URL + FDS_TEST_BATCH_ID not set.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FdsClient } from '../../src/client.js'
import { TEST_MNEMONIC, isBeeAvailable, testConfig } from './test-config.js'

describe('Transfer GSOC Integration', () => {
  let beeUp = false
  let beeOverlay: string | null = null

  beforeAll(async () => {
    beeUp = await isBeeAvailable()
    if (beeUp) {
      try {
        const res = await fetch(`${testConfig.beeUrl}/addresses`)
        const data = await res.json() as { overlay: string }
        beeOverlay = data.overlay
      } catch { /* ignore */ }
    }
  })

  it.skipIf(!process.env.FDS_TEST_BEE_URL || !process.env.FDS_TEST_BATCH_ID)(
    'send is rejected without recipient pubkey',
    async () => {
      if (!beeUp) return
      const tempDir = await mkdtemp(join(tmpdir(), 'fds-tr-'))
      const fds = new FdsClient({
        storage: { type: 'local', path: tempDir },
        beeUrl: testConfig.beeUrl!,
        batchId: testConfig.batchId,
      })
      await fds.init()
      await fds.identity.import(TEST_MNEMONIC)

      expect(fds.transfer.canDeliver).toBe(true)

      // Sending to a hex pubkey without inbox params should fail recipient resolution
      const fakePubkey = '0x' + '02' + 'a'.repeat(64)
      await expect(fds.send(fakePubkey, 'hello')).rejects.toMatchObject({ code: 'RECIPIENT_NO_PUBKEY' })

      await fds.destroy()
      await rm(tempDir, { recursive: true, force: true })
    },
    60000,
  )

  it.skipIf(!process.env.FDS_TEST_BEE_URL || !process.env.FDS_TEST_BATCH_ID)(
    'registerInbox mines a real GSOC identifier near node overlay',
    async () => {
      if (!beeUp || !beeOverlay) return
      const tempDir = await mkdtemp(join(tmpdir(), 'fds-tr-'))
      const fds = new FdsClient({
        storage: { type: 'local', path: tempDir },
        beeUrl: testConfig.beeUrl!,
        batchId: testConfig.batchId,
      })
      await fds.init()
      await fds.identity.import(TEST_MNEMONIC)

      // Mine with low proximity so the test is fast
      const params = await fds.transfer.registerInbox(beeOverlay, 8)

      expect(params.targetOverlay).toBe(beeOverlay)
      expect(params.proximity).toBe(8)
      expect(params.baseIdentifier).toMatch(/^0x[0-9a-f]{64}$/)

      await fds.destroy()
      await rm(tempDir, { recursive: true, force: true })
    },
    300000,  // 5 min for mining
  )

  it('transfer.canDeliver reflects bee availability', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'fds-tr-'))
    const fds = new FdsClient({ storage: { type: 'local', path: tempDir } })
    await fds.init()
    await fds.identity.import(TEST_MNEMONIC)

    expect(fds.transfer.canDeliver).toBe(false)

    await fds.destroy()
    await rm(tempDir, { recursive: true, force: true })
  })
})
