/**
 * Full SDK Lifecycle Integration Test
 *
 * Tests the complete user journey: identity → store → retrieve → send → publish
 * Uses local adapter (no Bee needed).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FdsClient } from '../../src/client.js'
import { generateEphemeralKeyPair, encryptForRecipient, decryptFromSender } from '../../src/crypto/ecdh.js'

describe('SDK Lifecycle', () => {
  let fds: FdsClient
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fds-lifecycle-'))
    fds = new FdsClient({ storage: { type: 'local', path: tempDir } })
    await fds.init()
  })

  afterEach(async () => {
    await fds.destroy()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('complete journey: create → store → retrieve → status', async () => {
    // 1. Create identity
    const id = await fds.identity.create()
    expect(id.address).toMatch(/^0x/)
    expect(id.mnemonic).toBeDefined()
    expect(id.mnemonic!.split(' ').length).toBe(12)

    // 2. Check status
    const status = await fds.status()
    expect(status.identity.connected).toBe(true)
    expect(status.storage.connected).toBe(true)

    // 3. Store encrypted data
    await fds.put('docs/report.pdf', 'quarterly report data')
    await fds.put('docs/notes.txt', 'meeting notes')
    await fds.put('photos/vacation.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))

    // 4. List buckets
    const buckets = await fds.list()
    expect(buckets.buckets!.length).toBe(2)  // docs, photos

    // 5. List files
    const docs = await fds.list('docs/')
    expect(docs.objects.length).toBe(2)

    // 6. Retrieve and verify
    const report = await fds.get('docs/report.pdf')
    expect(new TextDecoder().decode(report)).toBe('quarterly report data')

    // 7. Verify raw storage is encrypted
    const rawPath = join(tempDir, 'docs', 'report.pdf')
    const raw = await readFile(rawPath)
    expect(new TextDecoder().decode(raw)).not.toBe('quarterly report data')

    // 8. Move and copy
    await fds.storage.copy('docs/report.pdf', 'archive/report-backup.pdf')
    const backup = await fds.get('archive/report-backup.pdf')
    expect(new TextDecoder().decode(backup)).toBe('quarterly report data')

    // 9. Delete
    await fds.delete('docs/notes.txt')
    expect(await fds.storage.exists('docs/notes.txt')).toBe(false)
  })

  it('send requires Bee node — throws NO_STORAGE without one', async () => {
    await fds.identity.create()
    const recipient = generateEphemeralKeyPair()
    const recipientHex = '0x' + Buffer.from(recipient.publicKey).toString('hex')
    // No Bee configured → send fails fast (no fake outbox)
    await expect(fds.send(recipientHex, 'confidential data')).rejects.toMatchObject({ code: 'NO_STORAGE' })
  })

  it('ECDH encrypt/decrypt round-trips end-to-end', () => {
    // Sender encrypts, recipient decrypts — pure crypto path verification
    const recipient = generateEphemeralKeyPair()
    const message = 'confidential data'
    const encrypted = encryptForRecipient(new TextEncoder().encode(message), recipient.publicKey)
    const decrypted = decryptFromSender(encrypted, recipient.privateKey)
    expect(new TextDecoder().decode(decrypted)).toBe(message)
  })

  it('publish stores unencrypted data', async () => {
    await fds.identity.create()

    const ref = await fds.publish('Hello, world!', { filename: 'index.html' })
    expect(ref.reference).toContain('index.html')

    // Published data should be plaintext on disk (NOT encrypted)
    const raw = await readFile(join(tempDir, '__public', 'index.html'))
    expect(new TextDecoder().decode(raw)).toBe('Hello, world!')
  })

  it('stamps status reflects adapter', async () => {
    await fds.identity.create()
    const stamps = await fds.stamps.status()
    // Local adapter doesn't need stamps
    expect(stamps.available).toBe(true)
    expect(stamps.canUpload).toBe(true)
  })

  it('two identities have isolated storage', async () => {
    // Identity 1
    const id1 = await fds.identity.create()
    await fds.put('docs/file.txt', 'identity 1 data')

    // Read back — should work
    const data1 = await fds.get('docs/file.txt')
    expect(new TextDecoder().decode(data1)).toBe('identity 1 data')

    // Identity 2 (different client, same storage)
    const fds2 = new FdsClient({ storage: { type: 'local', path: tempDir } })
    await fds2.init()
    const id2 = await fds2.identity.create()

    // Reading with different identity should fail to decrypt (different key)
    // The get() falls back to raw ciphertext on decrypt failure
    const data2 = await fds2.get('docs/file.txt')
    // Should NOT be readable as the original text
    expect(new TextDecoder().decode(data2)).not.toBe('identity 1 data')

    await fds2.destroy()
  })
})
