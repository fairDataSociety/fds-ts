import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FdsClient } from '../src/client.js'

describe('FdsClient', () => {
  let fds: FdsClient
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fds-client-'))
    fds = new FdsClient({
      storage: { type: 'local', path: tempDir },
    })
    await fds.init()
    // Identity required for encrypted storage
    await fds.identity.create()
  })

  afterEach(async () => {
    await fds.destroy()
    await rm(tempDir, { recursive: true, force: true })
  })

  // ── Flat shortcuts (the 80% case) ─────────────────────

  it('put and get with string key', async () => {
    await fds.put('documents/hello.txt', 'hello world')
    const data = await fds.get('documents/hello.txt')
    expect(new TextDecoder().decode(data)).toBe('hello world')
  })

  it('put with Buffer', async () => {
    await fds.put('docs/binary.bin', Buffer.from([0x00, 0x01, 0x02]))
    const data = await fds.get('docs/binary.bin')
    expect(data[0]).toBe(0x00)
    expect(data[1]).toBe(0x01)
    expect(data[2]).toBe(0x02)
  })

  it('put with Uint8Array', async () => {
    await fds.put('docs/typed.bin', new Uint8Array([42, 43, 44]))
    const data = await fds.get('docs/typed.bin')
    expect(data[0]).toBe(42)
  })

  it('auto-creates bucket on put', async () => {
    await fds.put('newbucket/file.txt', 'auto-created')
    const data = await fds.get('newbucket/file.txt')
    expect(new TextDecoder().decode(data)).toBe('auto-created')
  })

  it('lists buckets with no prefix', async () => {
    await fds.put('alpha/a.txt', 'a')
    await fds.put('beta/b.txt', 'b')
    const result = await fds.list()
    const names = result.buckets!.map((b: any) => b.name).sort()
    expect(names).toEqual(['alpha', 'beta'])
  })

  it('lists objects with prefix', async () => {
    await fds.put('docs/a.txt', 'a')
    await fds.put('docs/b.txt', 'b')
    const result = await fds.list('docs/')
    expect(result.objects.length).toBe(2)
  })

  it('deletes an object', async () => {
    await fds.put('docs/temp.txt', 'temporary')
    await fds.delete('docs/temp.txt')
    const exists = await fds.storage.exists('docs/temp.txt')
    expect(exists).toBe(false)
  })

  // ── Storage service (namespaced) ──────────────────────

  it('storage.head returns metadata', async () => {
    await fds.put('docs/meta.txt', 'metadata test')
    const meta = await fds.storage.head('docs/meta.txt')
    expect(meta).not.toBeNull()
    expect(meta!.size).toBeGreaterThan(0)
  })

  it('storage.exists works', async () => {
    expect(await fds.storage.exists('docs/nope.txt')).toBe(false)
    await fds.put('docs/yes.txt', 'yes')
    expect(await fds.storage.exists('docs/yes.txt')).toBe(true)
  })

  it('storage.move renames within bucket', async () => {
    await fds.put('docs/old.txt', 'moving')
    await fds.storage.move('docs/old.txt', 'docs/new.txt')
    expect(await fds.storage.exists('docs/old.txt')).toBe(false)
    const data = await fds.get('docs/new.txt')
    expect(new TextDecoder().decode(data)).toBe('moving')
  })

  it('storage.copy duplicates across buckets', async () => {
    await fds.put('source/file.txt', 'original')
    await fds.storage.copy('source/file.txt', 'backup/file.txt')
    const original = await fds.get('source/file.txt')
    const copy = await fds.get('backup/file.txt')
    expect(new TextDecoder().decode(original)).toBe(new TextDecoder().decode(copy))
  })

  it('storage.createBucket and deleteBucket', async () => {
    await fds.storage.createBucket('temp')
    const buckets = await fds.storage.listBuckets()
    expect(buckets.some(b => b.name === 'temp')).toBe(true)
    await fds.storage.deleteBucket('temp')
    const after = await fds.storage.listBuckets()
    expect(after.some(b => b.name === 'temp')).toBe(false)
  })

  // ── Status ────────────────────────────────────────────

  it('status returns adapter info', async () => {
    const status = await fds.status()
    expect(status.storage.type).toBe('local')
    expect(status.storage.connected).toBe(true)
  })

  // ── Identity (namespaced) ─────────────────────────────

  it('identity is set after beforeEach create', async () => {
    // Identity created in beforeEach for encryption
    expect(fds.identity.current).not.toBeNull()
    expect(fds.identity.current?.address).toMatch(/^0x/)
  })

  it('status reflects identity', async () => {
    const status = await fds.status()
    expect(status.identity.connected).toBe(true)
    expect(status.identity.address).toMatch(/^0x/)
    expect(status.identity.locked).toBe(false)
  })

  it('full lifecycle: put → get → move → copy → delete', async () => {
    await fds.put('mydata/note.txt', 'sovereign data')
    const data = await fds.get('mydata/note.txt')
    expect(new TextDecoder().decode(data)).toBe('sovereign data')

    await fds.storage.copy('mydata/note.txt', 'backup/note.txt')
    const copy = await fds.get('backup/note.txt')
    expect(new TextDecoder().decode(copy)).toBe('sovereign data')

    await fds.storage.move('mydata/note.txt', 'mydata/renamed.txt')
    expect(await fds.storage.exists('mydata/note.txt')).toBe(false)
    const moved = await fds.get('mydata/renamed.txt')
    expect(new TextDecoder().decode(moved)).toBe('sovereign data')
  })
})
