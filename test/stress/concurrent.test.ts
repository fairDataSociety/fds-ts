/**
 * Stress Tests — Concurrent Operations
 *
 * Verifies the SDK handles concurrent puts, gets, and identity operations
 * without corruption.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FdsClient } from '../../src/client.js'

describe('Stress: Concurrent Operations', () => {
  let fds: FdsClient
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fds-stress-'))
    fds = new FdsClient({ storage: { type: 'local', path: tempDir } })
    await fds.init()
    await fds.identity.create()
  })

  afterEach(async () => {
    await fds.destroy()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('handles 10 parallel puts', async () => {
    const writes = Array.from({ length: 10 }, (_, i) =>
      fds.put(`docs/file-${i}.txt`, `content ${i}`)
    )
    const results = await Promise.all(writes)
    expect(results.length).toBe(10)

    const list = await fds.list('docs/')
    expect(list.objects.length).toBe(10)
  })

  it('handles 50 parallel puts and gets', { timeout: 30000 }, async () => {
    // 50 writes
    const writes = Array.from({ length: 50 }, (_, i) =>
      fds.put(`stress/file-${i}.txt`, `payload-${i}`)
    )
    await Promise.all(writes)

    // 50 reads
    const reads = Array.from({ length: 50 }, (_, i) =>
      fds.get(`stress/file-${i}.txt`).then(d => new TextDecoder().decode(d))
    )
    const values = await Promise.all(reads)

    for (let i = 0; i < 50; i++) {
      expect(values[i]).toBe(`payload-${i}`)
    }
  })

  it('handles a 1MB payload', async () => {
    const large = new Uint8Array(1024 * 1024)
    for (let i = 0; i < large.length; i++) large[i] = i % 256
    await fds.put('big/data.bin', large)
    const read = await fds.get('big/data.bin')
    expect(read.length).toBe(large.length)
    expect(read[0]).toBe(0)
    expect(read[255]).toBe(255)
    expect(read[256]).toBe(0)
  })

  it('handles 100 small files in same bucket', { timeout: 60000 }, async () => {
    const writes = Array.from({ length: 100 }, (_, i) =>
      fds.put(`bulk/item-${i}.json`, JSON.stringify({ id: i, name: `item-${i}` }))
    )
    await Promise.all(writes)

    const list = await fds.list('bulk/')
    expect(list.objects.length).toBe(100)
  })

  it('mixed concurrent operations do not corrupt state', async () => {
    // Pre-populate
    for (let i = 0; i < 5; i++) {
      await fds.put(`mix/initial-${i}.txt`, `initial ${i}`)
    }

    // Concurrent: writes, reads, deletes, lists
    const ops: Promise<unknown>[] = []
    for (let i = 5; i < 15; i++) {
      ops.push(fds.put(`mix/new-${i}.txt`, `new ${i}`))
    }
    for (let i = 0; i < 5; i++) {
      ops.push(fds.get(`mix/initial-${i}.txt`))
    }
    ops.push(fds.list('mix/'))
    ops.push(fds.list('mix/'))

    const results = await Promise.allSettled(ops)
    const failures = results.filter(r => r.status === 'rejected')
    expect(failures.length).toBe(0)
  })
})
