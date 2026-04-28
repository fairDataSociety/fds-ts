import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { LocalAdapter } from '../../src/adapters/local.js'

describe('LocalAdapter', () => {
  let adapter: LocalAdapter
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fds-test-'))
    adapter = new LocalAdapter({ path: tempDir })
    await adapter.connect()
  })

  afterEach(async () => {
    await adapter.disconnect()
    await rm(tempDir, { recursive: true, force: true })
  })

  // ── Bucket operations ──────────────────────────────────

  it('creates and lists buckets', async () => {
    await adapter.createBucket('documents')
    await adapter.createBucket('photos')
    const buckets = await adapter.listBuckets()
    const names = buckets.map(b => b.name).sort()
    expect(names).toEqual(['documents', 'photos'])
  })

  it('throws on duplicate bucket', async () => {
    await adapter.createBucket('test')
    await expect(adapter.createBucket('test')).rejects.toMatchObject({ code: 'BUCKET_EXISTS' })
  })

  it('deletes empty bucket', async () => {
    await adapter.createBucket('temp')
    await adapter.deleteBucket('temp')
    expect(await adapter.bucketExists('temp')).toBe(false)
  })

  it('throws on non-empty bucket delete', async () => {
    await adapter.createBucket('full')
    await adapter.put('full', 'file.txt', new TextEncoder().encode('data'))
    await expect(adapter.deleteBucket('full')).rejects.toMatchObject({ code: 'BUCKET_NOT_EMPTY' })
  })

  it('checks bucket existence', async () => {
    expect(await adapter.bucketExists('nope')).toBe(false)
    await adapter.createBucket('yes')
    expect(await adapter.bucketExists('yes')).toBe(true)
  })

  // ── Object operations ─────────────────────────────────

  it('puts and gets an object', async () => {
    await adapter.createBucket('docs')
    const data = new TextEncoder().encode('hello world')
    await adapter.put('docs', 'hello.txt', data)
    const result = await adapter.get('docs', 'hello.txt')
    expect(new TextDecoder().decode(result)).toBe('hello world')
  })

  it('throws OBJECT_NOT_FOUND on missing get', async () => {
    await adapter.createBucket('docs')
    await expect(adapter.get('docs', 'missing.txt')).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' })
  })

  it('puts with nested path', async () => {
    await adapter.createBucket('docs')
    const data = new TextEncoder().encode('nested content')
    await adapter.put('docs', 'sub/dir/file.txt', data)
    const result = await adapter.get('docs', 'sub/dir/file.txt')
    expect(new TextDecoder().decode(result)).toBe('nested content')
  })

  it('heads an object', async () => {
    await adapter.createBucket('docs')
    const data = new TextEncoder().encode('metadata test')
    await adapter.put('docs', 'meta.txt', data)
    const meta = await adapter.head('docs', 'meta.txt')
    expect(meta).not.toBeNull()
    expect(meta!.key).toBe('meta.txt')
    expect(meta!.size).toBe(data.length)
  })

  it('head returns null for missing object', async () => {
    await adapter.createBucket('docs')
    expect(await adapter.head('docs', 'nope.txt')).toBeNull()
  })

  it('checks object existence', async () => {
    await adapter.createBucket('docs')
    expect(await adapter.exists('docs', 'nope.txt')).toBe(false)
    await adapter.put('docs', 'yes.txt', new TextEncoder().encode('yes'))
    expect(await adapter.exists('docs', 'yes.txt')).toBe(true)
  })

  it('deletes an object', async () => {
    await adapter.createBucket('docs')
    await adapter.put('docs', 'bye.txt', new TextEncoder().encode('bye'))
    await adapter.delete('docs', 'bye.txt')
    expect(await adapter.exists('docs', 'bye.txt')).toBe(false)
  })

  it('throws on delete of missing object', async () => {
    await adapter.createBucket('docs')
    await expect(adapter.delete('docs', 'ghost.txt')).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' })
  })

  // ── List ──────────────────────────────────────────────

  it('lists objects in bucket', async () => {
    await adapter.createBucket('docs')
    await adapter.put('docs', 'a.txt', new TextEncoder().encode('a'))
    await adapter.put('docs', 'b.txt', new TextEncoder().encode('b'))
    const result = await adapter.list('docs')
    expect(result.objects.length).toBe(2)
    expect(result.objects.map(o => o.key).sort()).toEqual(['a.txt', 'b.txt'])
  })

  it('lists with prefix shows subdirectories', async () => {
    await adapter.createBucket('docs')
    await adapter.put('docs', 'root.txt', new TextEncoder().encode('root'))
    await adapter.put('docs', 'sub/nested.txt', new TextEncoder().encode('nested'))
    const result = await adapter.list('docs')
    expect(result.objects.map(o => o.key)).toContain('root.txt')
    expect(result.prefixes).toContain('sub/')
  })

  it('returns empty list for non-existent prefix', async () => {
    await adapter.createBucket('docs')
    const result = await adapter.list('docs', 'nonexistent/')
    expect(result.objects).toEqual([])
    expect(result.prefixes).toEqual([])
  })

  // ── Move ──────────────────────────────────────────────

  it('moves an object within a bucket', async () => {
    await adapter.createBucket('docs')
    await adapter.put('docs', 'old.txt', new TextEncoder().encode('moved'))
    await adapter.move('docs', 'old.txt', 'new.txt')
    expect(await adapter.exists('docs', 'old.txt')).toBe(false)
    const data = await adapter.get('docs', 'new.txt')
    expect(new TextDecoder().decode(data)).toBe('moved')
  })

  // ── Conflict strategies ───────────────────────────────

  it('overwrites by default', async () => {
    await adapter.createBucket('docs')
    await adapter.put('docs', 'file.txt', new TextEncoder().encode('v1'))
    await adapter.put('docs', 'file.txt', new TextEncoder().encode('v2'))
    const data = await adapter.get('docs', 'file.txt')
    expect(new TextDecoder().decode(data)).toBe('v2')
  })

  it('skips on conflict with skip strategy', async () => {
    await adapter.createBucket('docs')
    await adapter.put('docs', 'file.txt', new TextEncoder().encode('original'))
    await adapter.put('docs', 'file.txt', new TextEncoder().encode('ignored'), { onConflict: 'skip' })
    const data = await adapter.get('docs', 'file.txt')
    expect(new TextDecoder().decode(data)).toBe('original')
  })

  it('renames on conflict with rename strategy', async () => {
    await adapter.createBucket('docs')
    await adapter.put('docs', 'file.txt', new TextEncoder().encode('v1'))
    const result = await adapter.put('docs', 'file.txt', new TextEncoder().encode('v2'), { onConflict: 'rename' })
    expect(result.key).toBe('file-1.txt')
    expect(await adapter.exists('docs', 'file.txt')).toBe(true)
    expect(await adapter.exists('docs', 'file-1.txt')).toBe(true)
  })
})
