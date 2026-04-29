/**
 * Logger interface — pluggable observability for production use.
 *
 * The default logger is a no-op. Wire a real logger via FdsConfig.logger
 * (e.g., pino, winston, or your own structured logger).
 *
 * Each log call gets a structured context object so you can attach trace IDs,
 * user IDs, or anything else in your application's logger.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  trace(msg: string, ctx?: Record<string, unknown>): void
  debug(msg: string, ctx?: Record<string, unknown>): void
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
  error(msg: string, ctx?: Record<string, unknown>): void
  /** Create a child logger with default context merged in. */
  child(ctx: Record<string, unknown>): Logger
}

/** No-op logger. Default — zero overhead for callers who don't wire a logger. */
export const noopLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
}

/** Console logger (useful for development). */
export function consoleLogger(level: LogLevel = 'info', defaultCtx: Record<string, unknown> = {}): Logger {
  const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error']
  const minLevelIdx = levels.indexOf(level)

  function log(lvl: LogLevel, msg: string, ctx?: Record<string, unknown>) {
    if (levels.indexOf(lvl) < minLevelIdx) return
    const merged = { ...defaultCtx, ...ctx }
    const fn = lvl === 'error' ? console.error
      : lvl === 'warn' ? console.warn
      : console.log
    if (Object.keys(merged).length === 0) {
      fn(`[${lvl}] ${msg}`)
    } else {
      fn(`[${lvl}] ${msg}`, merged)
    }
  }

  return {
    trace: (m, c) => log('trace', m, c),
    debug: (m, c) => log('debug', m, c),
    info: (m, c) => log('info', m, c),
    warn: (m, c) => log('warn', m, c),
    error: (m, c) => log('error', m, c),
    child: (ctx) => consoleLogger(level, { ...defaultCtx, ...ctx }),
  }
}

/** Generate a short request ID for correlating log entries. */
export function requestId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Time an async operation. Returns the result and logs duration when done.
 * If the operation throws, logs the error duration and re-throws.
 */
export async function timed<T>(
  logger: Logger,
  operation: string,
  fn: () => Promise<T>,
  ctx?: Record<string, unknown>,
): Promise<T> {
  const start = Date.now()
  const reqId = requestId()
  logger.debug(`${operation}.start`, { ...ctx, reqId })
  try {
    const result = await fn()
    const durationMs = Date.now() - start
    logger.debug(`${operation}.success`, { ...ctx, reqId, durationMs })
    return result
  } catch (err: any) {
    const durationMs = Date.now() - start
    logger.error(`${operation}.error`, { ...ctx, reqId, durationMs, error: err?.message ?? String(err), code: err?.code })
    throw err
  }
}
