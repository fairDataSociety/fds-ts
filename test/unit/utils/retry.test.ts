/**
 * retry helper tests
 */

import { describe, it, expect, vi } from 'vitest'
import { retry, withRetry } from '../../../src/utils/retry.js'

describe('retry', () => {
  it('returns success on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await retry(fn)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries transient errors and eventually succeeds', async () => {
    let calls = 0
    const fn = vi.fn().mockImplementation(async () => {
      calls++
      if (calls < 3) throw new Error('ECONNRESET')
      return 'ok'
    })
    const result = await retry(fn, { baseDelayMs: 10, maxDelayMs: 30 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry permanent errors', async () => {
    const err: any = new Error('Bad request')
    err.status = 400
    const fn = vi.fn().mockRejectedValue(err)
    await expect(retry(fn, { baseDelayMs: 1 })).rejects.toThrow('Bad request')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries 5xx errors', async () => {
    const err: any = new Error('Internal server error')
    err.status = 500
    let calls = 0
    const fn = vi.fn().mockImplementation(async () => {
      calls++
      if (calls < 2) throw err
      return 'ok'
    })
    const result = await retry(fn, { baseDelayMs: 5 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries 429 (rate limit)', async () => {
    const err: any = new Error('Rate limited')
    err.status = 429
    let calls = 0
    const fn = vi.fn().mockImplementation(async () => {
      calls++
      if (calls < 2) throw err
      return 'ok'
    })
    const result = await retry(fn, { baseDelayMs: 5 })
    expect(result).toBe('ok')
  })

  it('throws after maxAttempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'))
    await expect(retry(fn, { maxAttempts: 2, baseDelayMs: 5 })).rejects.toThrow('ETIMEDOUT')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('calls onRetry hook', async () => {
    const onRetry = vi.fn()
    let calls = 0
    const fn = async () => {
      calls++
      if (calls < 2) throw new Error('ECONNRESET')
      return 'ok'
    }
    await retry(fn, { baseDelayMs: 5, onRetry })
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, expect.objectContaining({ message: 'ECONNRESET' }))
  })

  it('respects custom isRetryable', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('custom'))
    const isRetryable = (e: Error) => e.message === 'custom'
    await expect(retry(fn, { maxAttempts: 2, baseDelayMs: 5, isRetryable })).rejects.toThrow('custom')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('withRetry wraps a function', async () => {
    let calls = 0
    const original = async (x: number) => {
      calls++
      if (calls < 2) throw new Error('ECONNRESET')
      return x * 2
    }
    const wrapped = withRetry(original, { baseDelayMs: 5 })
    const result = await wrapped(21)
    expect(result).toBe(42)
    expect(calls).toBe(2)
  })
})
