import { randomUUID } from 'node:crypto'

import { RateLimiterMemory } from 'rate-limiter-flexible'
import { describe, expect, it, vi } from 'vitest'

import { createRateLimiter, type Logger, RateLimitExceededError, type RedisClient } from '../index.js'

const uniquePrefix = () => `test-${randomUUID()}`

// A Logger stub whose single `warn` method is a vitest mock, for asserting
// which warnings reached which logger.
const createLoggerStub = () => {
  const warn = vi.fn<Logger['warn']>()
  return { warn } satisfies Logger
}

describe('createRateLimiter', () => {
  describe('memory path (no client)', () => {
    it('resolves with rate-limit info while under the limit', async () => {
      const limiter = createRateLimiter({
        defaults: { points: 5, duration: 10, burst: null, prefix: uniquePrefix() },
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
        defaults: { points: 2, duration: 10, burst: null, prefix: uniquePrefix() },
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

    it('inherits the default burst when omitted and disables it when null', async () => {
      const defaults = { points: 1, duration: 10, burst: { points: 1, duration: 30 } }
      const limiter = createRateLimiter({ defaults })

      const inheritingKey = randomUUID()
      const inheritingOptions = { prefix: uniquePrefix() }
      await limiter.check({ key: inheritingKey, options: inheritingOptions })
      await limiter.check({ key: inheritingKey, options: inheritingOptions })
      await expect(limiter.check({ key: inheritingKey, options: inheritingOptions })).rejects.toBeInstanceOf(
        RateLimitExceededError,
      )

      const burstlessKey = randomUUID()
      const burstlessOptions = { prefix: uniquePrefix(), burst: null }
      await limiter.check({ key: burstlessKey, options: burstlessOptions })
      await expect(limiter.check({ key: burstlessKey, options: burstlessOptions })).rejects.toBeInstanceOf(
        RateLimitExceededError,
      )
    })

    it('consumes the requested number of points', async () => {
      const limiter = createRateLimiter({
        defaults: { points: 5, duration: 10, burst: null, prefix: uniquePrefix() },
      })
      const key = randomUUID()

      const info = await limiter.check({ key, points: 5 })

      expect(info.points.remaining).toBe(0)
      await expect(limiter.check({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
    })

    it('isolates counters between different prefixes', async () => {
      const limiter = createRateLimiter({
        defaults: { points: 1, duration: 10, burst: null },
      })
      const key = randomUUID()

      await limiter.check({ key, options: { prefix: uniquePrefix() } })
      await expect(limiter.check({ key, options: { prefix: uniquePrefix() } })).resolves.toMatchObject({
        points: { remaining: 0 },
      })
    })

    it('shares one underlying limiter across checks with the same configuration', async () => {
      const options = { points: 2, duration: 10, burst: null, prefix: uniquePrefix() }
      const limiter = createRateLimiter()
      const key = randomUUID()

      const first = await limiter.check({ key, options })
      const second = await limiter.check({ key, options })

      expect(first.points.consumed).toBe(1)
      expect(second.points.consumed).toBe(2)
    })

    it('warns that limits are per-instance when no client is configured', async () => {
      const logger = createLoggerStub()
      const limiter = createRateLimiter({
        logger,
        defaults: { points: 5, duration: 10, burst: null, prefix: uniquePrefix() },
      })

      await limiter.check({ key: randomUUID() })

      expect(logger.warn.mock.calls.some(([input]) => input.message.includes('in-memory'))).toBe(true)
    })

    it('clamps non-positive consumption points to 1', async () => {
      const limiter = createRateLimiter({
        defaults: { points: 2, duration: 10, burst: null, prefix: uniquePrefix() },
      })
      const key = randomUUID()

      // A negative consume would replenish the bucket via rate-limiter-flexible's
      // incrby. Clamping to 1 keeps it a real consumption.
      const info = await limiter.check({ key, points: -10 })

      expect(info.points.consumed).toBe(1)
      expect(info.points.remaining).toBe(1)
    })

    it.each([0, NaN, Infinity])('clamps invalid consumption points (%p) to 1', async points => {
      const limiter = createRateLimiter({
        defaults: { points: 5, duration: 10, burst: null, prefix: uniquePrefix() },
      })

      const info = await limiter.check({ key: randomUUID(), points })

      expect(info.points.consumed).toBe(1)
      expect(info.points.remaining).toBe(4)
    })

    it('clamps invalid configuration values at first use', async () => {
      const limiter = createRateLimiter({
        defaults: { points: 0, duration: 10, burst: null, prefix: uniquePrefix() },
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
      // insurance limiter, so it reaches the warn error path and is rethrown.
      const spy = vi.spyOn(RateLimiterMemory.prototype, 'consume').mockRejectedValue(storeError)
      try {
        const limiter = createRateLimiter({
          logger,
          defaults: { points: 5, duration: 10, burst: null, prefix: uniquePrefix() },
        })

        await expect(limiter.check({ key: randomUUID() })).rejects.toBe(storeError)
        const errorCall = logger.warn.mock.calls.find(([input]) => input.message === 'Unexpected rate limiter error')
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
          defaults: { points: 5, duration: 10, burst: null, prefix: uniquePrefix() },
        })

        await expect(limiter.check({ key: randomUUID(), logger: requestLogger })).rejects.toBe(storeError)

        const unexpected = (input: { message: string }) => input.message === 'Unexpected rate limiter error'
        expect(requestLogger.warn.mock.calls.some(([input]) => unexpected(input))).toBe(true)
        expect(factoryLogger.warn.mock.calls.some(([input]) => unexpected(input))).toBe(false)
      } finally {
        spy.mockRestore()
      }
    })

    it('routes configuration warnings to the factory logger even when a per-check logger is given', async () => {
      const factoryLogger = createLoggerStub()
      const requestLogger = createLoggerStub()
      const limiter = createRateLimiter({
        logger: factoryLogger,
        defaults: { points: 5, duration: 10, burst: null, prefix: uniquePrefix() },
      })

      await limiter.check({ key: randomUUID(), logger: requestLogger })

      const inMemory = (input: { message: string }) => input.message.includes('in-memory')
      expect(factoryLogger.warn.mock.calls.some(([input]) => inMemory(input))).toBe(true)
      expect(requestLogger.warn.mock.calls.some(([input]) => inMemory(input))).toBe(false)
    })

    it('treats distinct invalid configuration values that clamp to the same effective value as one limiter', async () => {
      const limiter = createRateLimiter({
        defaults: { points: 1, duration: 10, burst: null, prefix: uniquePrefix() },
      })
      const key = randomUUID()

      // `0` and `-5` both clamp to `points: 1`. A cache key derived from raw
      // values would fragment these into two limiters with fresh counters,
      // letting the second check wrongly succeed.
      await limiter.check({ key, options: { points: 0 } })
      await expect(limiter.check({ key, options: { points: -5 } })).rejects.toBeInstanceOf(RateLimitExceededError)
    })

    describe('clamp warnings', () => {
      it('truncates non-integer consumption points toward zero', async () => {
        const limiter = createRateLimiter({
          defaults: { points: 5, duration: 10, burst: null, prefix: uniquePrefix() },
        })
        const key = randomUUID()

        const info = await limiter.check({ key, points: 2.9 })

        expect(info.points.consumed).toBe(2)
        expect(info.points.remaining).toBe(3)
      })

      it('warns every time consumption points is clamped', async () => {
        const logger = createLoggerStub()
        const limiter = createRateLimiter({
          logger,
          defaults: { points: 10, duration: 10, burst: null, prefix: uniquePrefix() },
        })
        const key = randomUUID()

        await limiter.check({ key, points: 2.5 })
        await limiter.check({ key, points: 2.5 })

        const clampWarnings = logger.warn.mock.calls.filter(([input]) =>
          input.message.includes('consumption points was clamped'),
        )
        expect(clampWarnings).toHaveLength(2)
      })

      it('routes a per-check logger the consumption-points clamp warning, overriding the factory logger', async () => {
        const factoryLogger = createLoggerStub()
        const requestLogger = createLoggerStub()
        const limiter = createRateLimiter({
          logger: factoryLogger,
          defaults: { points: 10, duration: 10, burst: null, prefix: uniquePrefix() },
        })

        await limiter.check({ key: randomUUID(), points: 2.5, logger: requestLogger })

        const clamped = (input: { message: string }) => input.message.includes('consumption points was clamped')
        expect(requestLogger.warn.mock.calls.some(([input]) => clamped(input))).toBe(true)
        expect(factoryLogger.warn.mock.calls.some(([input]) => clamped(input))).toBe(false)
      })

      it('truncates non-integer points, duration, and burst configuration values toward zero', async () => {
        const limiter = createRateLimiter({
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

      it('warns about a clamped configuration once per distinct configuration, not on every check', async () => {
        const logger = createLoggerStub()
        const limiter = createRateLimiter({ logger })
        const options = { points: 2.9, duration: 10, burst: null, prefix: uniquePrefix() }
        const key = randomUUID()

        await limiter.check({ key, options })
        await limiter.check({ key, options })

        const clampWarnings = logger.warn.mock.calls.filter(
          ([input]) => input.message === 'Rate limit points was clamped',
        )
        expect(clampWarnings).toHaveLength(1)
      })

      it('treats distinct fractional configuration values that truncate to the same effective value as one limiter', async () => {
        const logger = createLoggerStub()
        const limiter = createRateLimiter({ logger })
        const key = randomUUID()
        const prefix = uniquePrefix()

        // `2.1` and `2.9` both truncate to `points: 2`. A cache key derived
        // from raw values would fragment these into two limiters with fresh
        // counters, letting the third check wrongly succeed. The warning
        // fires once, since the second check resolves to the already-built
        // configuration.
        await limiter.check({ key, options: { points: 2.1, duration: 10, burst: null, prefix } })
        await limiter.check({ key, options: { points: 2.9, duration: 10, burst: null, prefix } })
        await expect(
          limiter.check({ key, options: { points: 2.9, duration: 10, burst: null, prefix } }),
        ).rejects.toBeInstanceOf(RateLimitExceededError)

        const clampWarnings = logger.warn.mock.calls.filter(
          ([input]) => input.message === 'Rate limit points was clamped',
        )
        expect(clampWarnings).toHaveLength(1)
      })

      it('names the clamped field and reports the original and clamped values in the context', async () => {
        const logger = createLoggerStub()
        const limiter = createRateLimiter({
          logger,
          defaults: { points: 5, duration: 10.7, burst: null, prefix: uniquePrefix() },
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
            defaults: { points, duration: 10, burst: null, prefix: uniquePrefix() },
          })

          await limiter.check({ key: randomUUID() })

          const call = logger.warn.mock.calls.find(([input]) => input.message === 'Rate limit points was clamped')
          expect(call?.[0]).toMatchObject({
            context: { value: points, clamped: 1 },
          })
        },
      )

      it.each([0, NaN, Infinity, -5])(
        'warns with the original and clamped values when the invalid consumption points %p degrades to 1',
        async points => {
          const logger = createLoggerStub()
          const limiter = createRateLimiter({
            logger,
            defaults: { points: 5, duration: 10, burst: null, prefix: uniquePrefix() },
          })

          await limiter.check({ key: randomUUID(), points })

          const call = logger.warn.mock.calls.find(([input]) =>
            input.message.includes('consumption points was clamped'),
          )
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
        client,
        defaults: { points: 1, duration: 10, burst: null, prefix: uniquePrefix() },
      })
      const key = randomUUID()

      await expect(limiter.check({ key })).resolves.toMatchObject({ points: { remaining: 0 } })
      await expect(limiter.check({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
    })
  })
})
