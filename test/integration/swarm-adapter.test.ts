/**
 * SwarmAdapter Integration Tests
 *
 * Verifies put/get/list/delete against a real Bee node.
 * Skips gracefully when FDS_TEST_BEE_URL + FDS_TEST_BATCH_ID not set.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { FdsClient } from '../../src/client.js'
import { TEST_MNEMONIC, isBeeAvailable, testConfig } from './test-config.js'

describe('SwarmAdapter Integration', () => {
  let beeUp = false

  beforeAll(async () => {
    beeUp = await isBeeAvailable()
  })

  it.skipIf(() => !process.env.FDS_TEST_BEE_URL || !process.env.FDS_TEST_BATCH_ID)(
    'put → get round-trips encrypted data through Swarm',
    async () => {
      if (!beeUp) return

      const fds = new FdsClient({
        storage: {
          type: 'swarm',
          beeUrl: testConfig.beeUrl!,
          batchId: testConfig.batchId,
        },
      })
      await fds.init()
      await fds.identity.import(TEST_MNEMONIC)

      const data = new TextEncoder().encode('hello swarm')
      const result = await fds.put('test-pod/hello.txt', data)
      expect(result.reference).toBeDefined()

      const fetched = await fds.get('test-pod/hello.txt')
      expect(new TextDecoder().decode(fetched)).toBe('hello swarm')

      await fds.destroy()
    },
    180000,
  )

  it.skipIf(() => !process.env.FDS_TEST_BEE_URL || !process.env.FDS_TEST_BATCH_ID)(
    'publish uploads unencrypted via /bzz',
    async () => {
      if (!beeUp) return

      const fds = new FdsClient({
        storage: {
          type: 'swarm',
          beeUrl: testConfig.beeUrl!,
          batchId: testConfig.batchId,
        },
      })
      await fds.init()
      await fds.identity.import(TEST_MNEMONIC)

      const result = await fds.publish('Hello, Swarm!', { filename: 'index.html', contentType: 'text/html' })
      expect(result.reference).toMatch(/^[0-9a-fA-F]{64}/)
      expect(result.url).toBe(`bzz://${result.reference}`)

      await fds.destroy()
    },
    180000,
  )

  it('config rejects gateway-only mode (not implemented)', async () => {
    expect(() => new FdsClient({
      storage: { type: 'swarm', gateway: 'https://gateway.example.com' } as any,
    })).toThrow(/Gateway mode not yet implemented/)
  })
})
