/**
 * TransferService Tests — TDD
 *
 * Send/receive use real GSOC + Swarm. Without a configured Bee node:
 *   - send throws NO_STORAGE
 *   - receive returns []
 *   - subscribe returns no-op handle
 *
 * Real Bee integration tested in test/integration/sepolia-* tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FdsClient } from '../../../src/client.js'
import { generateEphemeralKeyPair } from '../../../src/crypto/ecdh.js'

describe('TransferService (no Bee configured)', () => {
  let fds: FdsClient
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fds-transfer-'))
    fds = new FdsClient({ storage: { type: 'local', path: tempDir } })
    await fds.init()
    await fds.identity.create()
  })

  afterEach(async () => {
    await fds.destroy()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('canDeliver is false without Bee', () => {
    expect(fds.transfer.canDeliver).toBe(false)
  })

  it('send throws NO_STORAGE without Bee', async () => {
    const recipient = generateEphemeralKeyPair()
    const recipientHex = '0x' + Buffer.from(recipient.publicKey).toString('hex')
    await expect(fds.send(recipientHex, 'secret')).rejects.toMatchObject({ code: 'NO_STORAGE' })
  })

  it('receive returns empty without inbox registered', async () => {
    const messages = await fds.transfer.receive()
    expect(messages).toEqual([])
  })

  it('subscribe returns no-op handle without Bee', () => {
    const sub = fds.transfer.subscribe(() => {})
    expect(sub.unsubscribe).toBeInstanceOf(Function)
    sub.unsubscribe()  // must not throw
  })

  it('readMessage throws NO_STORAGE without Bee', async () => {
    await expect(fds.transfer.readMessage('0xabc')).rejects.toMatchObject({ code: 'NO_STORAGE' })
  })

  it('registerInbox throws NO_STORAGE without Bee', async () => {
    await expect(fds.transfer.registerInbox('0xtarget')).rejects.toMatchObject({ code: 'NO_STORAGE' })
  })
})
