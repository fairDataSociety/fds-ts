/**
 * Retry helper for transient network errors.
 *
 * Use this for any operation that hits the network (Bee, RPC, gateway).
 * Distinguishes transient errors (network, 5xx, timeout) from permanent ones
 * (auth, validation, 4xx) and only retries the former.
 */

export interface RetryOptions {
  /** Max attempts (default: 3) */
  maxAttempts?: number
  /** Base delay in ms — exponential backoff (default: 200) */
  baseDelayMs?: number
  /** Max delay cap in ms (default: 5000) */
  maxDelayMs?: number
  /** Optional logger called with each retry */
  onRetry?: (attempt: number, error: Error) => void
  /** Custom retryability predicate. Default: network errors + 5xx + 408/429. */
  isRetryable?: (error: Error) => boolean
}

const DEFAULT_RETRYABLE = (error: Error): boolean => {
  const msg = error.message?.toLowerCase() || ''
  // Network errors
  if (msg.includes('econnreset') || msg.includes('econnrefused') ||
      msg.includes('etimedout') || msg.includes('socket hang up') ||
      msg.includes('network') || msg.includes('fetch failed') ||
      msg.includes('aborted') || msg.includes('enotfound')) {
    return true
  }
  // HTTP status codes
  const status = (error as any).status ?? (error as any).statusCode
  if (typeof status === 'number') {
    if (status >= 500 && status < 600) return true  // 5xx server errors
    if (status === 408 || status === 429) return true  // timeout, rate limit
  }
  return false
}

/**
 * Run an async operation with exponential backoff retry on transient errors.
 *
 * @example
 *   const result = await retry(() => bee.uploadData(batch, data))
 */
export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3
  const baseDelay = opts.baseDelayMs ?? 200
  const maxDelay = opts.maxDelayMs ?? 5000
  const isRetryable = opts.isRetryable ?? DEFAULT_RETRYABLE

  let lastError: Error
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt === maxAttempts || !isRetryable(lastError)) {
        throw lastError
      }
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)
      const jitter = delay * (0.5 + Math.random() * 0.5)  // 50–100% of delay
      opts.onRetry?.(attempt, lastError)
      await new Promise(r => setTimeout(r, jitter))
    }
  }
  throw lastError!
}

/**
 * Wrap a function with default retry behavior.
 * Useful for methods called many times.
 */
export function withRetry<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  opts?: RetryOptions,
): T {
  return ((...args: any[]) => retry(() => fn(...args), opts)) as T
}
