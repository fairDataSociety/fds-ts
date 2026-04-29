/**
 * FileManager Tests — ported from fairdrive/tests/core/file/FileManager.test.ts
 *
 * Tests file upload/download with privacy-by-default encryption.
 * Uses mocked Bee for fast in-memory testing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as crypto from 'crypto'
import { FileManager } from '../../../src/fairdrive/file/FileManager.js'
import type { Bee } from '@ethersphere/bee-js'

const TEST_BATCH_ID = '0'.repeat(64)

const uploadedData = new Map<string, Buffer>()
let refCounter = 0

function createMockBee(): Bee {
  return {
    uploadData: vi.fn().mockImplementation(async (_batchId: string, data: Uint8Array) => {
      const ref = `ref${++refCounter}` + '0'.repeat(64 - `ref${refCounter}`.length)
      uploadedData.set(ref, Buffer.from(data))
      return { reference: { toHex: () => ref, toString: () => ref } }
    }),
    downloadData: vi.fn().mockImplementation(async (ref: string) => {
      const data = uploadedData.get(ref)
      if (!data) throw new Error(`Reference not found: ${ref}`)
      return { toUint8Array: () => new Uint8Array(data) }
    }),
  } as unknown as Bee
}

function generateEncryptionKey(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(32))
}

describe('FileManager', () => {
  let fm: FileManager
  let bee: Bee
  let key: Uint8Array

  beforeEach(() => {
    vi.clearAllMocks()
    uploadedData.clear()
    refCounter = 0
    bee = createMockBee()
    key = generateEncryptionKey()
    fm = new FileManager({
      beeUrl: 'http://localhost:1633',
      postageBatchId: TEST_BATCH_ID,
      bee,
    })
  })

  describe('upload', () => {
    it('uploads with encryption by default', async () => {
      const content = Buffer.from('Hello, Fairdrive!')
      const info = await fm.upload('test-pod', '/hello.txt', content, key)

      expect(info.name).toBe('hello.txt')
      expect(info.path).toBe('/hello.txt')
      expect(info.size).toBe(content.length)
      expect(info.encrypted).toBe(true)
      expect(info.swarmRef).toBeDefined()
      expect(info.iv).toBeDefined()
      expect(info.encryptionKeyHash).toBeDefined()
      expect(bee.uploadData).toHaveBeenCalled()
    })

    it('uploaded data does not contain plaintext', async () => {
      const content = Buffer.from('Secret message')
      const info = await fm.upload('test-pod', '/secret.txt', content, key)
      const uploaded = uploadedData.get(info.swarmRef!)
      expect(uploaded!.toString()).not.toContain('Secret message')
    })

    it('skips encryption when unencrypted: true', async () => {
      const content = Buffer.from('Public content')
      const info = await fm.upload('test-pod', '/public.txt', content, key, { unencrypted: true })

      expect(info.encrypted).toBe(false)
      expect(info.iv).toBeUndefined()
      expect(info.encryptionKeyHash).toBeUndefined()
      const uploaded = uploadedData.get(info.swarmRef!)
      expect(uploaded!.toString()).toBe('Public content')
    })

    it('normalizes path with leading slash', async () => {
      const content = Buffer.from('content')
      const info = await fm.upload('pod', 'file.txt', content, key)
      expect(info.path).toBe('/file.txt')
    })

    it('extracts filename from nested path', async () => {
      const content = Buffer.from('content')
      const info = await fm.upload('pod', '/documents/reports/annual.pdf', content, key)
      expect(info.name).toBe('annual.pdf')
      expect(info.path).toBe('/documents/reports/annual.pdf')
    })

    it('uses provided content type', async () => {
      const info = await fm.upload('pod', '/data.json', Buffer.from('{}'), key, { contentType: 'application/json' })
      expect(info.contentType).toBe('application/json')
    })

    it('defaults to application/octet-stream', async () => {
      const info = await fm.upload('pod', '/data.bin', Buffer.from('x'), key)
      expect(info.contentType).toBe('application/octet-stream')
    })

    it('handles Uint8Array content', async () => {
      const content = new Uint8Array([1, 2, 3, 4, 5])
      const info = await fm.upload('pod', '/binary.bin', content, key)
      expect(info.size).toBe(5)
      expect(info.swarmRef).toBeDefined()
    })

    it('handles empty file', async () => {
      const info = await fm.upload('pod', '/empty.txt', Buffer.from(''), key)
      expect(info.size).toBe(0)
      expect(info.swarmRef).toBeDefined()
    })
  })

  describe('download', () => {
    it('downloads and decrypts encrypted file', async () => {
      const content = Buffer.from('Encrypted content')
      await fm.upload('pod', '/encrypted.txt', content, key)
      const downloaded = await fm.download('pod', '/encrypted.txt', key)
      expect(downloaded.toString()).toBe('Encrypted content')
    })

    it('downloads unencrypted file', async () => {
      const content = Buffer.from('Plain content')
      await fm.upload('pod', '/plain.txt', content, key, { unencrypted: true })
      const downloaded = await fm.download('pod', '/plain.txt', key)
      expect(downloaded.toString()).toBe('Plain content')
    })

    it('throws on non-existent file', async () => {
      await expect(fm.download('pod', '/nonexistent.txt', key)).rejects.toThrow(/not found/)
    })

    it('normalizes download path', async () => {
      await fm.upload('pod', '/file.txt', Buffer.from('content'), key)
      const downloaded = await fm.download('pod', 'file.txt', key)
      expect(downloaded.toString()).toBe('content')
    })

    it('handles binary content roundtrip', async () => {
      const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
      await fm.upload('pod', '/binary.bin', binary, key)
      const downloaded = await fm.download('pod', '/binary.bin', key)
      expect(Buffer.compare(downloaded, binary)).toBe(0)
    })

    it('handles large file (100KB)', async () => {
      const large = Buffer.alloc(100 * 1024, 'x')
      await fm.upload('pod', '/large.bin', large, key)
      const downloaded = await fm.download('pod', '/large.bin', key)
      expect(downloaded.length).toBe(large.length)
      expect(Buffer.compare(downloaded, large)).toBe(0)
    })

    it('handles unicode content', async () => {
      const unicode = Buffer.from('Hello 世界 🌍 مرحبا')
      await fm.upload('pod', '/unicode.txt', unicode, key)
      const downloaded = await fm.download('pod', '/unicode.txt', key)
      expect(downloaded.toString()).toBe('Hello 世界 🌍 مرحبا')
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      const content = Buffer.from('content')
      await fm.upload('pod', '/file1.txt', content, key)
      await fm.upload('pod', '/file2.txt', content, key)
      await fm.upload('pod', '/docs/doc1.txt', content, key)
      await fm.upload('pod', '/docs/doc2.txt', content, key)
      await fm.upload('pod', '/docs/nested/deep.txt', content, key)
    })

    it('lists files in root directory', async () => {
      const files = await fm.list('pod', '/', key)
      const paths = files.map(f => f.path)
      expect(paths).toContain('/file1.txt')
      expect(paths).toContain('/file2.txt')
    })

    it('listAll returns every file', async () => {
      const files = await fm.listAll('pod', key)
      expect(files.length).toBeGreaterThanOrEqual(5)
    })
  })

  describe('exists', () => {
    it('returns true for existing file', async () => {
      await fm.upload('pod', '/exists.txt', Buffer.from('x'), key)
      expect(await fm.exists('pod', '/exists.txt', key)).toBe(true)
    })

    it('returns false for non-existent file', async () => {
      expect(await fm.exists('pod', '/nope.txt', key)).toBe(false)
    })
  })

  describe('delete', () => {
    it('removes a file', async () => {
      await fm.upload('pod', '/delete-me.txt', Buffer.from('x'), key)
      const deleted = await fm.delete('pod', '/delete-me.txt', key)
      expect(deleted).toBe(true)
      expect(await fm.exists('pod', '/delete-me.txt', key)).toBe(false)
    })

    it('returns false for non-existent file', async () => {
      expect(await fm.delete('pod', '/nope.txt', key)).toBe(false)
    })
  })
})
