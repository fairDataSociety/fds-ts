/**
 * SharingService Tests — TDD
 *
 * Tests ACT-based collaborative sharing: grant, revoke, list, hasAccess.
 * Uses local adapter for unit tests. Swarm ACT integration tests separate.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FdsClient } from '../../../src/client.js'
import { generateEphemeralKeyPair } from '../../../src/crypto/ecdh.js'

describe('SharingService', () => {
  let fds: FdsClient
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fds-sharing-'))
    fds = new FdsClient({ storage: { type: 'local', path: tempDir } })
    await fds.init()
    await fds.identity.create()
  })

  afterEach(async () => {
    await fds.destroy()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('grant stores share record in __shares bucket', async () => {
    const recipient = generateEphemeralKeyPair()
    const recipientAddr = '0x' + Buffer.from(recipient.publicKey).toString('hex').slice(0, 40)

    await fds.put('research/paper.txt', 'shared content')
    await fds.sharing.grant('research', recipientAddr)

    // Verify share record exists
    const shares = await fds.sharing.list('research')
    expect(shares.length).toBe(1)
    expect(shares[0].address).toBe(recipientAddr)
  })

  it('grant multiple recipients', async () => {
    const alice = '0x' + 'a'.repeat(40)
    const bob = '0x' + 'b'.repeat(40)

    await fds.put('research/paper.txt', 'content')
    await fds.sharing.grant('research', alice)
    await fds.sharing.grant('research', bob)

    const shares = await fds.sharing.list('research')
    expect(shares.length).toBe(2)
  })

  it('revoke removes grantee', async () => {
    const alice = '0x' + 'a'.repeat(40)
    const bob = '0x' + 'b'.repeat(40)

    await fds.put('research/paper.txt', 'content')
    await fds.sharing.grant('research', alice)
    await fds.sharing.grant('research', bob)
    await fds.sharing.revoke('research', alice)

    const shares = await fds.sharing.list('research')
    expect(shares.length).toBe(1)
    expect(shares[0].address).toBe(bob)
  })

  it('hasAccess returns correct state', async () => {
    const alice = '0x' + 'a'.repeat(40)

    await fds.put('research/paper.txt', 'content')
    expect(await fds.sharing.hasAccess('research', alice)).toBe(false)

    await fds.sharing.grant('research', alice)
    expect(await fds.sharing.hasAccess('research', alice)).toBe(true)

    await fds.sharing.revoke('research', alice)
    expect(await fds.sharing.hasAccess('research', alice)).toBe(false)
  })

  it('list returns empty for unshared bucket', async () => {
    await fds.put('private/file.txt', 'mine only')
    const shares = await fds.sharing.list('private')
    expect(shares).toEqual([])
  })

  it('grantFile stores file-level share', async () => {
    const alice = '0x' + 'a'.repeat(40)
    await fds.put('docs/report.pdf', 'report content')
    await fds.sharing.grantFile('docs/report.pdf', alice)

    // File share stored separately from bucket shares
    const shares = await fds.sharing.list('docs')
    // File shares show up in bucket listing
    expect(shares.length).toBe(1)
  })
})
