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
      // incrby; clamping to 1 keeps it a real consumption.
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

      // `0` and `-5` both clamp to the same effective `points: 1`. If the cache
      // key were derived from the raw (unclamped) values, these would fragment
      // into two limiter instances, each with its own fresh counter — so the
      // second check would wrongly succeed instead of hitting the shared,
      // already-exhausted allowance.
      await limiter.check({ key, options: { points: 0 } })
      await expect(limiter.check({ key, options: { points: -5 } })).rejects.toBeInstanceOf(RateLimitExceededError)
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
