/**
 * TransferService Tests — TDD
 *
 * Tests encrypted send via ECDH, inbox receive, subscribe.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FdsClient } from '../../../src/client.js'
import { generateEphemeralKeyPair, decryptFromSender } from '../../../src/crypto/ecdh.js'

describe('TransferService', () => {
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

  it('send encrypts data and stores in outbox', async () => {
    const recipient = generateEphemeralKeyPair()
    const recipientHex = '0x' + Buffer.from(recipient.publicKey).toString('hex')

    const result = await fds.send(recipientHex, 'secret message', { filename: 'test.enc' })
    expect(result.encrypted).toBe(true)
    expect(result.recipient).toBe(recipientHex)
    expect(result.reference).toContain('test.enc')
  })

  it('send fails without identity', async () => {
    const fds2 = new FdsClient({ storage: { type: 'local', path: tempDir } })
    await fds2.init()
    // No identity created
    const recipient = generateEphemeralKeyPair()
    const recipientHex = '0x' + Buffer.from(recipient.publicKey).toString('hex')
    await expect(fds2.send(recipientHex, 'test')).rejects.toMatchObject({ code: 'NO_IDENTITY' })
    await fds2.destroy()
  })

  it('send fails for unresolvable recipient', async () => {
    await expect(fds.send('alice.eth', 'test')).rejects.toMatchObject({ code: 'RECIPIENT_NO_PUBKEY' })
  })

  it('receive returns empty when no inbox', async () => {
    const messages = await fds.transfer.receive()
    expect(messages).toEqual([])
  })

  it('subscribe returns unsubscribable', () => {
    const sub = fds.transfer.subscribe(() => {})
    expect(sub.unsubscribe).toBeInstanceOf(Function)
    sub.unsubscribe()
  })
})
