/**
 * TransferService Tests — TDD
 *
 * Tests encrypted send, receive, and subscribe.
 * Uses mock Bee for unit tests. Integration tests hit Sepolia.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { TransferService } from '../../../src/services/transfer.js'

describe('TransferService', () => {
  let transfer: TransferService

  beforeEach(() => {
    transfer = new TransferService()
  })

  it('send throws ADAPTER_UNSUPPORTED until wired', async () => {
    await expect(
      transfer.send('alice.eth', new Uint8Array([1, 2, 3]))
    ).rejects.toMatchObject({ code: 'ADAPTER_UNSUPPORTED' })
  })

  it('receive throws ADAPTER_UNSUPPORTED until wired', async () => {
    await expect(transfer.receive()).rejects.toMatchObject({ code: 'ADAPTER_UNSUPPORTED' })
  })

  it('subscribe throws ADAPTER_UNSUPPORTED until wired', () => {
    expect(() => transfer.subscribe(() => {})).toThrow()
  })
})
