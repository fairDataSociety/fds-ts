/**
 * EscrowService Tests — TDD
 *
 * Tests trustless data exchange: create, buy, claim, dispute, status.
 * Unit tests use local adapter + mock chain. Integration tests hit Sepolia.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FdsClient } from '../../../src/client.js'

describe('EscrowService', () => {
  let fds: FdsClient
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fds-escrow-'))
    fds = new FdsClient({ storage: { type: 'local', path: tempDir } })
    await fds.init()
    await fds.identity.create()
  })

  afterEach(async () => {
    await fds.destroy()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('create stores encrypted data and returns escrow metadata', async () => {
    // Store data first
    await fds.put('datasets/users.csv', 'user_id,name\n1,Alice\n2,Bob')

    const escrow = await fds.escrow.create('datasets/users.csv', {
      price: '0.01',
      description: 'User dataset',
    })

    expect(escrow.escrowId).toBeDefined()
    expect(escrow.reference).toBeDefined()
    expect(escrow.contentHash).toBeDefined()
    expect(escrow.status).toBe('Created')
  })

  it('status returns escrow details', async () => {
    await fds.put('data/file.csv', 'test data')
    const escrow = await fds.escrow.create('data/file.csv', { price: '0.01' })

    const details = await fds.escrow.status(escrow.escrowId)
    expect(details.escrowId).toBe(escrow.escrowId)
    expect(details.status).toBe('Created')
    expect(details.price).toBeDefined()
  })

  it('listKeys returns stored escrow keys', async () => {
    await fds.put('data/file.csv', 'test')
    await fds.escrow.create('data/file.csv', { price: '0.01' })

    const keys = await fds.escrow.listKeys()
    expect(keys.length).toBeGreaterThanOrEqual(1)
  })

  it('create without identity fails', async () => {
    const fds2 = new FdsClient({ storage: { type: 'local', path: tempDir } })
    await fds2.init()
    // No identity
    await expect(
      fds2.escrow.create('data/file.csv', { price: '0.01' })
    ).rejects.toMatchObject({ code: 'NO_IDENTITY' })
    await fds2.destroy()
  })

  it('buy without chain config fails gracefully', async () => {
    await expect(fds.escrow.buy(1n)).rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE' })
  })

  it('claim without chain config fails gracefully', async () => {
    await expect(fds.escrow.claim(1n)).rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE' })
  })

  it('dispute without chain config fails gracefully', async () => {
    await expect(fds.escrow.dispute(1n)).rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE' })
  })
})
