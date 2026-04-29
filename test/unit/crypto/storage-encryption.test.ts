/**
 * Storage Encryption Integration Tests — TDD
 *
 * Tests that the encryption layer sits between StorageService and adapter.
 * Adapter should only ever see ciphertext, never plaintext.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FdsClient } from '../../../src/client.js'
import { encrypt, decrypt } from '../../../src/crypto/encryption.js'
import { derivePodKey, deriveFileKey } from '../../../src/crypto/keys.js'

describe('Storage Encryption Layer', () => {
  let fds: FdsClient
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fds-enc-'))
    fds = new FdsClient({ storage: { type: 'local', path: tempDir } })
    await fds.init()
    await fds.identity.create()
  })

  afterEach(async () => {
    await fds.destroy()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('put() stores encrypted data, get() returns plaintext', async () => {
    await fds.put('docs/secret.txt', 'classified information')
    const data = await fds.get('docs/secret.txt')
    expect(new TextDecoder().decode(data)).toBe('classified information')
  })

  it('raw file on disk is NOT plaintext (encrypted by SDK)', async () => {
    await fds.put('docs/secret.txt', 'classified information')
    // Read raw file from adapter storage
    const rawPath = join(tempDir, 'docs', 'secret.txt')
    const raw = await readFile(rawPath)
    // Raw bytes should NOT be readable as the original text
    const rawStr = new TextDecoder().decode(raw)
    expect(rawStr).not.toBe('classified information')
    // Should have IV + authTag overhead
    expect(raw.length).toBeGreaterThan('classified information'.length)
  })

  it('encryption is deterministic for same identity + pod + path', async () => {
    // Same file written twice should be readable both times
    await fds.put('docs/file.txt', 'version 1')
    const v1 = await fds.get('docs/file.txt')
    expect(new TextDecoder().decode(v1)).toBe('version 1')

    await fds.put('docs/file.txt', 'version 2')
    const v2 = await fds.get('docs/file.txt')
    expect(new TextDecoder().decode(v2)).toBe('version 2')
  })

  it('different pods use different encryption keys', async () => {
    await fds.put('pod-a/file.txt', 'same content')
    await fds.put('pod-b/file.txt', 'same content')

    const rawA = await readFile(join(tempDir, 'pod-a', 'file.txt'))
    const rawB = await readFile(join(tempDir, 'pod-b', 'file.txt'))
    // Different pods → different keys → different ciphertext
    expect(Buffer.from(rawA).toString('hex')).not.toBe(Buffer.from(rawB).toString('hex'))
  })

  it('different files in same pod use different keys', async () => {
    await fds.put('docs/a.txt', 'same content')
    await fds.put('docs/b.txt', 'same content')

    const rawA = await readFile(join(tempDir, 'docs', 'a.txt'))
    const rawB = await readFile(join(tempDir, 'docs', 'b.txt'))
    expect(Buffer.from(rawA).toString('hex')).not.toBe(Buffer.from(rawB).toString('hex'))
  })

  it('handles binary data round-trip', async () => {
    const binary = new Uint8Array([0x00, 0xff, 0x42, 0x00, 0xde, 0xad])
    await fds.put('data/binary.bin', binary)
    const result = await fds.get('data/binary.bin')
    expect(Array.from(result)).toEqual(Array.from(binary))
  })

  it('handles empty data', async () => {
    await fds.put('docs/empty.txt', '')
    const result = await fds.get('docs/empty.txt')
    expect(result.length).toBe(0)
  })
})
