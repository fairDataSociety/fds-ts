/**
 * Escrow Flow Integration Test
 *
 * Local-mode escrow lifecycle:
 *   1. Alice puts data in storage
 *   2. Alice creates escrow (encrypts with new key, stores metadata)
 *   3. Alice can recover keys from metadata
 *   4. Alice can list keys + delete by escrowId
 *
 * On-chain operations (buy/claim/dispute) are gated by chain config and
 * tested separately against Sepolia.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FdsClient } from '../../src/client.js'

describe('Escrow Flow (local mode)', () => {
  let fds: FdsClient
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fds-escrow-flow-'))
    fds = new FdsClient({ storage: { type: 'local', path: tempDir } })
    await fds.init()
    await fds.identity.create()
  })

  afterEach(async () => {
    await fds.destroy()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('full lifecycle: put → create escrow → status → listKeys → recoverKeys → delete', async () => {
    // 1. Put data
    await fds.put('datasets/users.csv', 'id,name\n1,Alice\n2,Bob\n3,Carol')

    // 2. Create escrow
    const escrow = await fds.escrow.create('datasets/users.csv', {
      price: '0.01',
      description: 'User dataset',
    })
    expect(escrow.escrowId).toBeDefined()
    expect(escrow.status).toBe('Created')

    // 3. Status returns details
    const details = await fds.escrow.status(escrow.escrowId)
    expect(details.escrowId).toBe(escrow.escrowId)
    expect(details.description).toBe('User dataset')
    expect(details.status).toBe('Created')

    // 4. listKeys includes our escrow
    const keys = await fds.escrow.listKeys()
    expect(keys.find(k => k.escrowId === escrow.escrowId.toString())).toBeDefined()

    // 5. recoverKeys returns the escrow encryption key + salt
    const recovered = await fds.escrow.recoverKeys(escrow.escrowId.toString(), '')
    expect(recovered).toBeDefined()
    expect(recovered.encryptionKey).toMatch(/^[0-9a-f]+$/i)
    expect(recovered.salt).toMatch(/^[0-9a-f]+$/i)

    // 6. delete the key
    await fds.escrow.deleteKey(escrow.escrowId.toString())
    const recoveredAfter = await fds.escrow.recoverKeys(escrow.escrowId.toString(), '')
    expect(recoveredAfter).toBeNull()
  })

  it('multiple escrows isolated per id', async () => {
    await fds.put('data/a.csv', 'a-data')
    await fds.put('data/b.csv', 'b-data')

    const e1 = await fds.escrow.create('data/a.csv', { price: '0.01' })
    const e2 = await fds.escrow.create('data/b.csv', { price: '0.02' })

    expect(e1.escrowId).not.toBe(e2.escrowId)
    expect(e1.contentHash).not.toBe(e2.contentHash)

    const keys = await fds.escrow.listKeys()
    expect(keys.length).toBeGreaterThanOrEqual(2)
  })

  it('on-chain ops fail gracefully without chain config', async () => {
    await fds.put('data/x.csv', 'data')
    const escrow = await fds.escrow.create('data/x.csv', { price: '0.01' })

    await expect(fds.escrow.buy(escrow.escrowId)).rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE' })
    await expect(fds.escrow.claim(escrow.escrowId)).rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE' })
    await expect(fds.escrow.dispute(escrow.escrowId)).rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE' })
    await expect(fds.escrow.claimExpired(escrow.escrowId)).rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE' })
  })

  it('reputation returns unknown without chain', async () => {
    const rep = await fds.escrow.reputation(1n)
    expect(rep).toBeDefined()
    expect(rep.tier).toBe('unknown')
  })
})
