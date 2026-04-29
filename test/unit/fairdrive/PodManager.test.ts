/**
 * PodManager Tests — ported from fairdrive/tests/core/pod/PodManager.test.ts
 *
 * Tests pod CRUD + feed-based persistence with mocked Bee.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PodManager } from '../../../src/fairdrive/pod/PodManager.js'
import type { Bee, FeedReader, FeedWriter } from '@ethersphere/bee-js'

const TEST_BATCH_ID = '0'.repeat(64)
const TEST_PRIVATE_KEY = '0x' + '1'.repeat(64)
const TEST_OWNER_ADDRESS = '0x' + 'a'.repeat(40)

const uploadedData = new Map<string, Buffer>()
const feedData = new Map<string, string>()
let refCounter = 0

function createMockFeedReader(): FeedReader {
  return {
    downloadPayload: vi.fn().mockImplementation(async () => {
      const ref = feedData.get('pod-index')
      if (!ref) throw new Error('Feed not found')
      const data = uploadedData.get(ref)
      if (!data) throw new Error(`Reference not found: ${ref}`)
      return { reference: ref, payload: { toUint8Array: () => new Uint8Array(data) } }
    }),
    download: vi.fn().mockImplementation(async () => {
      const ref = feedData.get('pod-index')
      if (!ref) throw new Error('Feed not found')
      return { reference: ref }
    }),
  } as unknown as FeedReader
}

function createMockFeedWriter(): FeedWriter {
  return {
    uploadReference: vi.fn().mockImplementation(async (_batchId: string, reference: string) => {
      feedData.set('pod-index', reference)
      return reference
    }),
    upload: vi.fn().mockImplementation(async (_batchId: string, reference: string) => {
      feedData.set('pod-index', reference)
      return reference
    }),
  } as unknown as FeedWriter
}

function createMockBee(): Bee {
  const r = createMockFeedReader()
  const w = createMockFeedWriter()
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
    makeFeedReader: vi.fn().mockReturnValue(r),
    makeFeedWriter: vi.fn().mockReturnValue(w),
  } as unknown as Bee
}

describe('PodManager', () => {
  let pm: PodManager
  let bee: Bee

  beforeEach(() => {
    vi.clearAllMocks()
    uploadedData.clear()
    feedData.clear()
    refCounter = 0

    bee = createMockBee()
    pm = new PodManager({
      beeUrl: 'http://localhost:1633',
      postageBatchId: TEST_BATCH_ID,
      privateKey: TEST_PRIVATE_KEY,
      bee,
    })
  })

  describe('initialize', () => {
    it('starts with empty list when no feed exists', async () => {
      await pm.initialize(TEST_OWNER_ADDRESS)
      expect(await pm.list()).toEqual([])
    })

    it('only initializes once', async () => {
      await pm.initialize(TEST_OWNER_ADDRESS)
      await pm.initialize(TEST_OWNER_ADDRESS)
      expect(bee.makeFeedReader).toHaveBeenCalledTimes(1)
    })
  })

  describe('create', () => {
    it('creates a new pod with feedTopic', async () => {
      const pod = await pm.create('my-pod')
      expect(pod.name).toBe('my-pod')
      expect(pod.createdAt).toBeInstanceOf(Date)
      expect(pod.feedTopic).toBeDefined()
    })

    it('adds the pod to the list', async () => {
      await pm.create('new-pod')
      const pods = await pm.list()
      expect(pods).toHaveLength(1)
      expect(pods[0].name).toBe('new-pod')
    })

    it('rejects duplicate pod names', async () => {
      await pm.create('duplicate')
      await expect(pm.create('duplicate')).rejects.toThrow(/already exists/)
    })

    it('persists pod index when batch + privateKey are set', async () => {
      await pm.create('persisted-pod')
      expect(bee.uploadData).toHaveBeenCalled()
      expect(bee.makeFeedWriter).toHaveBeenCalled()
    })

    it('does not persist when no postage batch', async () => {
      const noBatch = new PodManager({
        beeUrl: 'http://localhost:1633',
        privateKey: TEST_PRIVATE_KEY,
        bee,
      })
      await noBatch.create('no-persist')
      expect(bee.uploadData).not.toHaveBeenCalled()
    })

    it('does not persist when no private key', async () => {
      const noKey = new PodManager({
        beeUrl: 'http://localhost:1633',
        postageBatchId: TEST_BATCH_ID,
        bee,
      })
      await noKey.create('no-persist')
      expect(bee.uploadData).not.toHaveBeenCalled()
    })

    it('generates unique feed topics for different pods', async () => {
      const pod1 = await pm.create('pod1')
      const pod2 = await pm.create('pod2')
      expect(pod1.feedTopic).not.toBe(pod2.feedTopic)
    })

    it('feed topic is deterministic for same pod name', async () => {
      const pod1 = await pm.create('same-name')
      const pm2 = new PodManager({ beeUrl: 'http://localhost:1633', bee: createMockBee() })
      const pod2 = await pm2.create('same-name')
      expect(pod1.feedTopic).toBe(pod2.feedTopic)
    })
  })

  describe('list', () => {
    it('returns empty when no pods exist', async () => {
      expect(await pm.list()).toEqual([])
    })

    it('returns all created pods', async () => {
      await pm.create('pod1')
      await pm.create('pod2')
      await pm.create('pod3')
      const pods = await pm.list()
      const names = pods.map(p => p.name)
      expect(names).toEqual(expect.arrayContaining(['pod1', 'pod2', 'pod3']))
      expect(pods).toHaveLength(3)
    })
  })

  describe('get', () => {
    it('returns pod by name', async () => {
      await pm.create('find-me')
      const pod = await pm.get('find-me')
      expect(pod?.name).toBe('find-me')
    })

    it('returns undefined for non-existent pod', async () => {
      expect(await pm.get('nope')).toBeUndefined()
    })
  })

  describe('delete', () => {
    it('removes existing pod', async () => {
      await pm.create('delete-me')
      const deleted = await pm.delete('delete-me')
      expect(deleted).toBe(true)
      expect(await pm.get('delete-me')).toBeUndefined()
    })

    it('returns false for non-existent pod', async () => {
      expect(await pm.delete('nope')).toBe(false)
    })

    it('list reflects deletion', async () => {
      await pm.create('keep')
      await pm.create('remove')
      await pm.delete('remove')
      const pods = await pm.list()
      expect(pods).toHaveLength(1)
      expect(pods[0].name).toBe('keep')
    })
  })
})
