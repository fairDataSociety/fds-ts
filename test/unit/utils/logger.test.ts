/**
 * Logger tests
 */

import { describe, it, expect, vi } from 'vitest'
import { noopLogger, consoleLogger, timed, requestId } from '../../../src/utils/logger.js'

describe('Logger', () => {
  describe('noopLogger', () => {
    it('all methods are callable without effect', () => {
      noopLogger.trace('msg')
      noopLogger.debug('msg', { foo: 'bar' })
      noopLogger.info('msg')
      noopLogger.warn('msg')
      noopLogger.error('msg', { err: 'x' })
      // No assertions — just verifying no throws
      expect(true).toBe(true)
    })

    it('child returns noop', () => {
      const child = noopLogger.child({ id: 1 })
      expect(child).toBe(noopLogger)
    })
  })

  describe('consoleLogger', () => {
    it('respects minimum log level', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const logger = consoleLogger('warn')
      logger.debug('hidden')
      logger.info('hidden')
      logger.warn('shown')

      expect(logSpy).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith('[warn] shown')

      logSpy.mockRestore()
      warnSpy.mockRestore()
    })

    it('child merges context', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const root = consoleLogger('info', { service: 'fds' })
      const child = root.child({ requestId: 'abc' })
      child.info('hello', { userId: '123' })

      expect(logSpy).toHaveBeenCalledWith('[info] hello', {
        service: 'fds',
        requestId: 'abc',
        userId: '123',
      })

      logSpy.mockRestore()
    })
  })

  describe('requestId', () => {
    it('returns a non-empty short string', () => {
      const id = requestId()
      expect(id).toMatch(/^[a-z0-9]+$/)
      expect(id.length).toBeLessThanOrEqual(8)
    })

    it('produces unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => requestId()))
      expect(ids.size).toBeGreaterThan(95) // allow collisions but should be very rare
    })
  })

  describe('timed', () => {
    it('returns the result of the wrapped function', async () => {
      const result = await timed(noopLogger, 'op', async () => 42)
      expect(result).toBe(42)
    })

    it('logs success with duration', async () => {
      const debug = vi.fn()
      const logger = { ...noopLogger, debug }
      await timed(logger as any, 'op', async () => {
        await new Promise(r => setTimeout(r, 5))
        return 'ok'
      })

      expect(debug).toHaveBeenCalledWith('op.start', expect.objectContaining({ reqId: expect.any(String) }))
      expect(debug).toHaveBeenCalledWith('op.success', expect.objectContaining({
        durationMs: expect.any(Number),
        reqId: expect.any(String),
      }))
    })

    it('logs error and re-throws', async () => {
      const error = vi.fn()
      const logger = { ...noopLogger, error }

      await expect(
        timed(logger as any, 'op', async () => { throw new Error('boom') })
      ).rejects.toThrow('boom')

      expect(error).toHaveBeenCalledWith('op.error', expect.objectContaining({
        error: 'boom',
        durationMs: expect.any(Number),
      }))
    })
  })
})
