import { randomUUID } from 'node:crypto'

import { RateLimiterMemory } from 'rate-limiter-flexible'
import { describe, expect, it, vi } from 'vitest'

import { createRateLimiter, type Logger, RateLimitExceededError, type RedisClient } from '../index.js'

const uniquePrefix = () => `test-${randomUUID()}`

// A Logger stub whose `warn` and `error` methods are vitest mocks, for
// asserting which log reached which logger.
const createLoggerStub = () => {
  const warn = vi.fn<Logger['warn']>()
  const error = vi.fn<Logger['error']>()
  return { warn, error } satisfies Logger
}

const defaultLogger = createLoggerStub()

describe('createRateLimiter', () => {
  describe('memory path (no client)', () => {
    it('resolves with rate-limit info while under the limit', async () => {
      const limiter = createRateLimiter({
        logger: defaultLogger,
        defaults: {
          points: 5,
          duration: 10,
          burst: null,
          prefix: uniquePrefix(),
        },
      })

      const info = await limiter.check({ key: randomUUID() })

      expect(info).toEqual({
        points: { remaining: 4, consumed: 1 },
        msToNextWindow: info.msToNextWindow,
        isFirstInWindow: true,
      })
      expect(info.msToNextWindow).toBeGreaterThan(0)
    })

    it('throws RateLimitExceededError once the allowance is exhausted', async () => {
      const limiter = createRateLimiter({
        logger: defaultLogger,
        defaults: {
          points: 2,
          duration: 10,
          burst: null,
          prefix: uniquePrefix(),
        },
      })
      const key = randomUUID()

      await limiter.check({ key })
      await limiter.check({ key })
      const error = await limiter.check({ key }).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(RateLimitExceededError)
      const rateLimitError = error as RateLimitExceededError
      expect(rateLimitError.info.msToNextWindow).toBeGreaterThan(0)
      expect(rateLimitError.info.points.remaining).toBe(0)
      expect(rateLimitError.message).toMatch(/Rate limit exceeded/)
    })

    it('grants extra requests from the burst allowance after the steady window is exhausted', async () => {
      const limiter = createRateLimiter({
        logger: defaultLogger,
        defaults: {
          points: 1,
          duration: 10,
          burst: { points: 2, duration: 30 },
          prefix: uniquePrefix(),
        },
      })
      const key = randomUUID()

      await limiter.check({ key })
      await limiter.check({ key })
      await limiter.check({ key })
      await expect(limiter.check({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
    })

    it('inherits the built-in burst when defaults omit it and disables it when null', async () => {
      // Burst omitted: the built-in { points: 20, duration: 30 } applies, so
      // 1 steady + 20 burst checks pass before the 22nd is rejected.
      const inheriting = createRateLimiter({
        logger: defaultLogger,
        defaults: { points: 1, duration: 10, prefix: uniquePrefix() },
      })
      const inheritingKey = randomUUID()
      for (let i = 0; i < 21; i++) {
        await inheriting.check({ key: inheritingKey })
      }
      await expect(inheriting.check({ key: inheritingKey })).rejects.toBeInstanceOf(RateLimitExceededError)

      const burstless = createRateLimiter({
        logger: defaultLogger,
        defaults: {
          points: 1,
          duration: 10,
          burst: null,
          prefix: uniquePrefix(),
        },
      })
      const burstlessKey = randomUUID()
      await burstless.check({ key: burstlessKey })
      await expect(burstless.check({ key: burstlessKey })).rejects.toBeInstanceOf(RateLimitExceededError)
    })

    it('warns that limits are per-instance when no client is configured', async () => {
      const logger = createLoggerStub()
      const limiter = createRateLimiter({
        logger,
        defaults: {
          points: 5,
          duration: 10,
          burst: null,
          prefix: uniquePrefix(),
        },
      })

      await limiter.check({ key: randomUUID() })

      expect(logger.warn.mock.calls.some(([input]) => input.message.includes('in-memory'))).toBe(true)
    })

    it('clamps invalid configuration values', async () => {
      const limiter = createRateLimiter({
        logger: defaultLogger,
        defaults: {
          points: 0,
          duration: 10,
          burst: null,
          prefix: uniquePrefix(),
        },
      })
      const key = randomUUID()

      // points clamped to 1: the first check consumes it, the second is rejected.
      await limiter.check({ key })
      await expect(limiter.check({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
    })

    it('reports an unexpected limiter error to the logger with a top-level error and rethrows it', async () => {
      const logger = createLoggerStub()
      const storeError = new Error('boom')
      // A non-RateLimiterRes rejection is neither a limit nor absorbed by the
      // insurance limiter, so it reaches the error path and is rethrown.
      const spy = vi.spyOn(RateLimiterMemory.prototype, 'consume').mockRejectedValue(storeError)
      try {
        const limiter = createRateLimiter({
          logger,
          defaults: {
            points: 5,
            duration: 10,
            burst: null,
            prefix: uniquePrefix(),
          },
        })

        await expect(limiter.check({ key: randomUUID() })).rejects.toBe(storeError)
        const errorCall = logger.error.mock.calls.find(([input]) => input.message === 'Unexpected rate limiter error')
        expect(errorCall?.[0].error).toBe(storeError)
      } finally {
        spy.mockRestore()
      }
    })

    it('routes a per-check logger the request warnings, overriding the factory logger', async () => {
      const factoryLogger = createLoggerStub()
      const requestLogger = createLoggerStub()
      const storeError = new Error('boom')
      const spy = vi.spyOn(RateLimiterMemory.prototype, 'consume').mockRejectedValue(storeError)
      try {
        const limiter = createRateLimiter({
          logger: factoryLogger,
          defaults: {
            points: 5,
            duration: 10,
            burst: null,
            prefix: uniquePrefix(),
          },
        })

        await expect(limiter.check({ key: randomUUID(), logger: requestLogger })).rejects.toBe(storeError)

        const unexpected = (input: { message: string }) => input.message === 'Unexpected rate limiter error'
        expect(requestLogger.error.mock.calls.some(([input]) => unexpected(input))).toBe(true)
        expect(factoryLogger.error.mock.calls.some(([input]) => unexpected(input))).toBe(false)
      } finally {
        spy.mockRestore()
      }
    })

    it('routes configuration warnings to the factory logger even when a per-check logger is given', async () => {
      const factoryLogger = createLoggerStub()
      const requestLogger = createLoggerStub()
      const limiter = createRateLimiter({
        logger: factoryLogger,
        defaults: {
          points: 5,
          duration: 10,
          burst: null,
          prefix: uniquePrefix(),
        },
      })

      await limiter.check({ key: randomUUID(), logger: requestLogger })

      const inMemory = (input: { message: string }) => input.message.includes('in-memory')
      expect(factoryLogger.warn.mock.calls.some(([input]) => inMemory(input))).toBe(true)
      expect(requestLogger.warn.mock.calls.some(([input]) => inMemory(input))).toBe(false)
    })

    describe('clamp warnings', () => {
      it('truncates non-integer points, duration, and burst configuration values toward zero', async () => {
        const limiter = createRateLimiter({
          logger: defaultLogger,
          defaults: {
            points: 2.9,
            duration: 10.5,
            burst: { points: 1.9, duration: 30.9 },
            prefix: uniquePrefix(),
          },
        })
        const key = randomUUID()

        // points truncates to 2, burst.points truncates to 1: 3 checks succeed
        // (2 steady + 1 burst) before the 4th is rejected.
        await limiter.check({ key })
        await limiter.check({ key })
        await limiter.check({ key })
        await expect(limiter.check({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
      })

      it('warns about a clamped configuration once at creation, not on every check', async () => {
        const logger = createLoggerStub()
        const limiter = createRateLimiter({
          logger,
          defaults: {
            points: 2.9,
            duration: 10,
            burst: null,
            prefix: uniquePrefix(),
          },
        })
        const key = randomUUID()

        await limiter.check({ key })
        await limiter.check({ key })

        const clampWarnings = logger.warn.mock.calls.filter(
          ([input]) => input.message === 'Rate limit points was clamped',
        )
        expect(clampWarnings).toHaveLength(1)
      })

      it('names the clamped field and reports the original and clamped values in the context', async () => {
        const logger = createLoggerStub()
        const limiter = createRateLimiter({
          logger,
          defaults: {
            points: 5,
            duration: 10.7,
            burst: null,
            prefix: uniquePrefix(),
          },
        })

        await limiter.check({ key: randomUUID() })

        const call = logger.warn.mock.calls.find(([input]) => input.message === 'Rate limit duration was clamped')
        expect(call?.[0]).toMatchObject({
          message: 'Rate limit duration was clamped',
          context: { value: 10.7, clamped: 10 },
        })
      })

      it('warns once per clamped field when multiple configuration fields are clamped at once', async () => {
        const logger = createLoggerStub()
        const limiter = createRateLimiter({
          logger,
          defaults: {
            points: 2.9,
            duration: 10.5,
            burst: { points: 1.9, duration: 30.9 },
            prefix: uniquePrefix(),
          },
        })

        await limiter.check({ key: randomUUID() })

        const fields = logger.warn.mock.calls
          .map(([input]) => input.message)
          .filter(message => message.includes('was clamped'))
          .map(message => /Rate limit (.+?) was clamped/.exec(message)?.[1])
        expect(fields.sort()).toEqual(['burst duration', 'burst points', 'duration', 'points'])
      })

      it.each([0, NaN, Infinity, -5])(
        'warns with the original and clamped values when the invalid configuration value %p degrades to 1',
        async points => {
          const logger = createLoggerStub()
          const limiter = createRateLimiter({
            logger,
            defaults: {
              points,
              duration: 10,
              burst: null,
              prefix: uniquePrefix(),
            },
          })

          await limiter.check({ key: randomUUID() })

          const call = logger.warn.mock.calls.find(([input]) => input.message === 'Rate limit points was clamped')
          expect(call?.[0]).toMatchObject({
            context: { value: points, clamped: 1 },
          })
        },
      )
    })
  })

  describe('redis path', () => {
    it('falls back to the insurance memory limiter when the client is not ready', async () => {
      const client = { status: 'end' } as unknown as RedisClient
      const limiter = createRateLimiter({
        logger: defaultLogger,
        client,
        defaults: {
          points: 1,
          duration: 10,
          burst: null,
          prefix: uniquePrefix(),
        },
      })
      const key = randomUUID()

      await expect(limiter.check({ key })).resolves.toMatchObject({
        points: { remaining: 0 },
      })
      await expect(limiter.check({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
    })
  })
})
