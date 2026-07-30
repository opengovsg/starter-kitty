import { randomUUID } from 'node:crypto'

import { RateLimiterMemory } from 'rate-limiter-flexible'
import { describe, expect, it, vi } from 'vitest'

import { createRateLimiter, type Logger, RateLimitExceededError, type RedisClient } from '../index.js'

const uniquePrefix = () => `test-${randomUUID()}`

// A Logger stub whose `warn`/`error` methods are vitest mocks, for asserting
// which diagnostics reached which logger.
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
        overrides: {
          points: 5,
          duration: 10,
          burst: null,
          prefix: uniquePrefix(),
        },
        fallback: { points: 5, duration: 10 },
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
        overrides: {
          points: 2,
          duration: 10,
          burst: null,
          prefix: uniquePrefix(),
        },
        fallback: { points: 2, duration: 10 },
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

    it('never grants extra requests from burst while running off memory, even when burst is configured', async () => {
      const limiter = createRateLimiter({
        logger: defaultLogger,
        overrides: {
          points: 1,
          duration: 10,
          burst: { points: 5, duration: 30 },
          prefix: uniquePrefix(),
        },
        fallback: { points: 1, duration: 10 },
      })
      const key = randomUUID()

      await limiter.check({ key })
      // Burst never engages while enforcement runs off memory (ADR 0010): the
      // fallback allowance above is the only capacity available, regardless of
      // the primary burst configuration.
      await expect(limiter.check({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
    })

    it('reports to error that limits are per-instance when no client is configured', async () => {
      const logger = createLoggerStub()
      const limiter = createRateLimiter({
        logger,
        overrides: {
          points: 5,
          duration: 10,
          burst: null,
          prefix: uniquePrefix(),
        },
      })

      await limiter.check({ key: randomUUID() })

      expect(logger.error.mock.calls.some(([input]) => input.message.includes('in-memory'))).toBe(true)
    })

    it('clamps invalid configuration values', async () => {
      const limiter = createRateLimiter({
        logger: defaultLogger,
        overrides: {
          points: 0,
          duration: 10,
          burst: null,
          prefix: uniquePrefix(),
        },
        fallback: { points: 1, duration: 10 },
      })
      const key = randomUUID()

      // Primary points clamped to 1 (still warned below, even though the
      // fallback above — not this clamped primary value — is what's actually
      // enforced in the no-client path per ADR 0010).
      await limiter.check({ key })
      await expect(limiter.check({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
    })

    it('enforces the default fallback allowance (10 points per second) regardless of a larger primary window', async () => {
      const limiter = createRateLimiter({
        defaults: { points: 1000, duration: 10, burst: null, prefix: uniquePrefix() },
      })
      const key = randomUUID()

      const info = await limiter.check({ key, points: 10 })
      expect(info.points.remaining).toBe(0)
      await expect(limiter.check({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
    })

    it('overrides the default fallback allowance via the fallback option', async () => {
      const limiter = createRateLimiter({
        defaults: { points: 1000, duration: 10, burst: null, prefix: uniquePrefix() },
        fallback: { points: 2, duration: 30 },
      })
      const key = randomUUID()

      await limiter.check({ key })
      await limiter.check({ key })
      await expect(limiter.check({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
    })

    it('clamps a non-positive fallback.points to 1 and warns', async () => {
      const logger = createLoggerStub()
      const limiter = createRateLimiter({
        logger,
        defaults: { points: 1000, duration: 10, burst: null, prefix: uniquePrefix() },
        fallback: { points: 0, duration: 10 },
      })
      const key = randomUUID()

      await limiter.check({ key })
      await expect(limiter.check({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
      const clampCall = logger.warn.mock.calls.find(([input]) => input.message.includes('fallback points'))
      expect(clampCall?.[0].context?.value).toBe(0)
    })

    it('clamps a non-positive fallback.duration to 1 and warns', () => {
      const logger = createLoggerStub()
      createRateLimiter({
        logger,
        defaults: { points: 1000, duration: 10, burst: null, prefix: uniquePrefix() },
        fallback: { points: 5, duration: 0 },
      })

      const clampCall = logger.warn.mock.calls.find(([input]) => input.message.includes('fallback duration'))
      expect(clampCall?.[0].context?.value).toBe(0)
    })

    it('reports an unexpected limiter error to the logger with a top-level error and rethrows it', async () => {
      const logger = createLoggerStub()
      const storeError = new Error('boom')
      // A non-RateLimiterRes rejection is neither a limit nor absorbed by the
      // insurance limiter, so it reaches the error-reporting path and is
      // rethrown.
      const spy = vi.spyOn(RateLimiterMemory.prototype, 'consume').mockRejectedValue(storeError)
      try {
        const limiter = createRateLimiter({
          logger,
          overrides: {
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

    it('routes a per-check logger the request diagnostics, overriding the factory logger', async () => {
      const factoryLogger = createLoggerStub()
      const requestLogger = createLoggerStub()
      const storeError = new Error('boom')
      const spy = vi.spyOn(RateLimiterMemory.prototype, 'consume').mockRejectedValue(storeError)
      try {
        const limiter = createRateLimiter({
          logger: factoryLogger,
          overrides: {
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

    it('routes configuration diagnostics to the factory logger even when a per-check logger is given', async () => {
      const factoryLogger = createLoggerStub()
      const requestLogger = createLoggerStub()
      const limiter = createRateLimiter({
        logger: factoryLogger,
        overrides: {
          points: 5,
          duration: 10,
          burst: null,
          prefix: uniquePrefix(),
        },
      })

      await limiter.check({ key: randomUUID(), logger: requestLogger })

      const inMemory = (input: { message: string }) => input.message.includes('in-memory')
      expect(factoryLogger.error.mock.calls.some(([input]) => inMemory(input))).toBe(true)
      expect(requestLogger.error.mock.calls.some(([input]) => inMemory(input))).toBe(false)
    })

    describe('clamp warnings', () => {
      it('truncates non-integer points and duration configuration values toward zero', async () => {
        const limiter = createRateLimiter({
          logger: defaultLogger,
          overrides: {
            points: 2.9,
            duration: 10.5,
            burst: { points: 1.9, duration: 30.9 },
            prefix: uniquePrefix(),
          },
          fallback: { points: 2, duration: 10 },
        })
        const key = randomUUID()

        // The primary points truncate to 2, but burst never applies while
        // running off memory (ADR 0010), so only 2 checks succeed before the
        // 3rd is rejected.
        await limiter.check({ key })
        await limiter.check({ key })
        await expect(limiter.check({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
      })

      it('warns about a clamped configuration once at creation, not on every check', async () => {
        const logger = createLoggerStub()
        const limiter = createRateLimiter({
          logger,
          overrides: {
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
          overrides: {
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
          overrides: {
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
            overrides: {
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
        overrides: {
          points: 1,
          duration: 10,
          burst: null,
          prefix: uniquePrefix(),
        },
        fallback: { points: 1, duration: 10 },
      })
      const key = randomUUID()

      await expect(limiter.check({ key })).resolves.toMatchObject({
        points: { remaining: 0 },
      })
      await expect(limiter.check({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
    })

    it('grants nothing extra from burst when Redis is not ready, even though burst is configured', async () => {
      const client = { status: 'end' } as unknown as RedisClient
      const limiter = createRateLimiter({
        client,
        defaults: {
          points: 1,
          duration: 10,
          burst: { points: 5, duration: 30 },
          prefix: uniquePrefix(),
        },
        fallback: { points: 1, duration: 10 },
      })
      const key = randomUUID()

      await expect(limiter.check({ key })).resolves.toMatchObject({
        points: { remaining: 0 },
      })
      await expect(limiter.check({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
    })
  })
})
