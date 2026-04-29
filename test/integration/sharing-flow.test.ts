/**
 * Sharing Flow Integration Test
 *
 * Multi-identity scenario:
 *   1. Alice creates identity, stores file in pod 'research'
 *   2. Alice grants Bob access to 'research'
 *   3. Bob can see the share record
 *   4. Alice revokes Bob
 *   5. Bob's access is gone from share records
 *
 * Note: Full ACT crypto sharing (Bob actually decrypting Alice's file with his
 * own key) requires Swarm + ACT — that's a separate Sepolia integration test.
 * This test verifies the share record bookkeeping at the local-adapter layer.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FdsClient } from '../../src/client.js'
import { TEST_MNEMONIC } from './test-config.js'

describe('Sharing Flow', () => {
  let aliceDir: string
  let alice: FdsClient
  let bobAddr: string

  beforeEach(async () => {
    aliceDir = await mkdtemp(join(tmpdir(), 'fds-alice-'))
    alice = new FdsClient({ storage: { type: 'local', path: aliceDir } })
    await alice.init()
    await alice.identity.import(TEST_MNEMONIC)

    // Bob's address (account 1 from test mnemonic — Hardhat account)
    bobAddr = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  })

  afterEach(async () => {
    await alice.destroy()
    await rm(aliceDir, { recursive: true, force: true })
  })

  it('alice grants bob access to research bucket', async () => {
    await alice.put('research/paper.pdf', 'PhD thesis draft')
    await alice.sharing.grant('research', bobAddr)

    const grantees = await alice.sharing.list('research')
    expect(grantees.length).toBe(1)
    expect(grantees[0].address.toLowerCase()).toBe(bobAddr.toLowerCase())
  })

  it('hasAccess reflects grant + revoke lifecycle', async () => {
    await alice.put('research/paper.pdf', 'data')

    // Initially no access
    expect(await alice.sharing.hasAccess('research', bobAddr)).toBe(false)

    // Grant
    await alice.sharing.grant('research', bobAddr)
    expect(await alice.sharing.hasAccess('research', bobAddr)).toBe(true)

    // Revoke
    await alice.sharing.revoke('research', bobAddr)
    expect(await alice.sharing.hasAccess('research', bobAddr)).toBe(false)

    // Re-grant
    await alice.sharing.grant('research', bobAddr)
    expect(await alice.sharing.hasAccess('research', bobAddr)).toBe(true)
  })

  it('multiple grantees managed independently', async () => {
    const carolAddr = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
    const arbiterAddr = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'

    await alice.put('research/paper.pdf', 'data')
    await alice.sharing.grant('research', bobAddr)
    await alice.sharing.grant('research', carolAddr)
    await alice.sharing.grant('research', arbiterAddr)

    const all = await alice.sharing.list('research')
    expect(all.length).toBe(3)

    // Revoke just Carol
    await alice.sharing.revoke('research', carolAddr)
    const remaining = await alice.sharing.list('research')
    expect(remaining.length).toBe(2)
    expect(remaining.find(g => g.address === carolAddr)).toBeUndefined()
    expect(remaining.find(g => g.address === bobAddr)).toBeDefined()
    expect(remaining.find(g => g.address === arbiterAddr)).toBeDefined()
  })

  it('grant is idempotent (no duplicate records)', async () => {
    await alice.put('research/paper.pdf', 'data')
    await alice.sharing.grant('research', bobAddr)
    await alice.sharing.grant('research', bobAddr)
    await alice.sharing.grant('research', bobAddr)

    const grantees = await alice.sharing.list('research')
    expect(grantees.length).toBe(1)
  })
})
