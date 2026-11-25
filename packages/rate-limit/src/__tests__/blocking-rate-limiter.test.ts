import { randomUUID } from 'node:crypto'

import { RateLimiterMemory } from 'rate-limiter-flexible'
import { describe, expect, it, vi } from 'vitest'

import { createBlockingRateLimiter, type Logger, RateLimitExceededError, type RedisClient } from '../index.js'

const uniquePrefix = () => `test-${randomUUID()}`

// A Logger stub whose `warn`/`error` methods are vitest mocks, for asserting
// which diagnostics reached which logger.
const createLoggerStub = () => {
  const warn = vi.fn<Logger['warn']>()
  const error = vi.fn<Logger['error']>()
  return { warn, error } satisfies Logger
}

const defaultLogger = createLoggerStub()

// Operators alert on this exact message, so the tests spell it out instead
// of importing it from the implementation.
const FALLBACK_TRIGGERED_MESSAGE = 'Fallback rate limiter triggered'

const fallbackWarnings = (logger: ReturnType<typeof createLoggerStub>) =>
  logger.warn.mock.calls.map(([input]) => input).filter(input => input.message === FALLBACK_TRIGGERED_MESSAGE)

describe('createBlockingRateLimiter', () => {
  it('checks an unseen key without minting state or consuming a point', async () => {
    const getSpy = vi.spyOn(RateLimiterMemory.prototype, 'get')
    const consumeSpy = vi.spyOn(RateLimiterMemory.prototype, 'consume')
    try {
      const limiter = createBlockingRateLimiter({ logger: defaultLogger, overrides: { prefix: uniquePrefix() } })
      const key = randomUUID()

      await expect(limiter.isBlocked({ key })).resolves.toBeUndefined()

      expect(getSpy).toHaveBeenCalledWith(key)
      expect(await getSpy.mock.results[0]?.value).toBeNull()
      expect(consumeSpy).not.toHaveBeenCalled()
    } finally {
      getSpy.mockRestore()
      consumeSpy.mockRestore()
    }
  })

  it('accumulates failures and engages the block only after the allowance is exceeded', async () => {
    const limiter = createBlockingRateLimiter({
      logger: defaultLogger,
      overrides: { points: 2, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })
    const key = randomUUID()

    await limiter.consume({ key })
    await limiter.consume({ key })
    await expect(limiter.isBlocked({ key })).resolves.toBeUndefined()

    await expect(limiter.consume({ key })).resolves.toBeUndefined()
    const error = await limiter.isBlocked({ key }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(RateLimitExceededError)
    expect((error as RateLimitExceededError).info.points).toEqual({ remaining: 0, consumed: 3 })
    expect((error as RateLimitExceededError).info.msToNextWindow).toBeGreaterThan(0)
  })

  it('warns exactly once when the block engages and stays silent on later consumes', async () => {
    const logger = createLoggerStub()
    const prefix = uniquePrefix()
    const limiter = createBlockingRateLimiter({
      logger,
      overrides: { points: 1, duration: 60, block: { duration: 30 }, prefix },
    })
    const key = randomUUID()

    await limiter.consume({ key })
    await limiter.consume({ key })
    await limiter.consume({ key })

    const blockWarnings = logger.warn.mock.calls.filter(
      ([input]) => input.message === 'Rate limit block engaged after failure allowance was exceeded',
    )
    expect(blockWarnings).toHaveLength(1)
    expect(blockWarnings[0]?.[0].context).toEqual({ prefix, bucket: key, consumed: 2, block: { duration: 30 } })
  })

  it('resets a blocked key', async () => {
    const limiter = createBlockingRateLimiter({
      logger: defaultLogger,
      overrides: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })
    const key = randomUUID()

    await limiter.consume({ key })
    await limiter.consume({ key })
    await expect(limiter.isBlocked({ key })).rejects.toBeInstanceOf(RateLimitExceededError)

    await expect(limiter.reset({ key })).resolves.toBeUndefined()
    await expect(limiter.isBlocked({ key })).resolves.toBeUndefined()
  })

  it('uses matching block state in the insurance limiter when Redis is not ready', async () => {
    const client = {
      status: 'end',
      del: vi.fn(),
    } as unknown as RedisClient
    const limiter = createBlockingRateLimiter({
      logger: defaultLogger,
      client,
      overrides: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })
    const key = randomUUID()

    await limiter.consume({ key })
    await limiter.consume({ key })
    await expect(limiter.isBlocked({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('clears stale insurance state when reset succeeds after Redis recovers', async () => {
    const clientState = { status: 'end', del: vi.fn().mockResolvedValue(1) }
    const logger = createLoggerStub()
    const limiter = createBlockingRateLimiter({
      logger,
      client: clientState as unknown as RedisClient,
      overrides: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })
    const key = randomUUID()

    await limiter.consume({ key })
    await limiter.consume({ key })
    await expect(limiter.isBlocked({ key })).rejects.toBeInstanceOf(RateLimitExceededError)

    clientState.status = 'ready'
    const warningsBeforeReset = fallbackWarnings(logger).length
    await expect(limiter.reset({ key })).resolves.toBeUndefined()
    // A reset that reaches Redis is not a fallback invocation.
    expect(fallbackWarnings(logger)).toHaveLength(warningsBeforeReset)
    clientState.status = 'end'
    await expect(limiter.isBlocked({ key })).resolves.toBeUndefined()
  })

  it('rejects an incomplete Redis reset after clearing insurance state', async () => {
    const storeError = new Error('Redis connection is not ready')
    const client = {
      status: 'end',
      del: vi.fn().mockRejectedValue(storeError),
    } as unknown as RedisClient
    const limiter = createBlockingRateLimiter({
      logger: defaultLogger,
      client,
      overrides: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })
    const key = randomUUID()

    await limiter.consume({ key })
    await limiter.consume({ key })
    await expect(limiter.isBlocked({ key })).rejects.toBeInstanceOf(RateLimitExceededError)

    await expect(limiter.reset({ key })).rejects.toBe(storeError)
    await expect(limiter.isBlocked({ key })).resolves.toBeUndefined()
  })

  describe('fallback warnings', () => {
    it('warns with the prefix, and never the key, on every call served by the insurance limiter', async () => {
      const logger = createLoggerStub()
      const client = { status: 'end', del: vi.fn() } as unknown as RedisClient
      const prefix = uniquePrefix()
      const limiter = createBlockingRateLimiter({
        logger,
        client,
        overrides: { points: 1, duration: 60, block: { duration: 30 }, prefix },
      })
      const key = randomUUID()

      await limiter.isBlocked({ key })
      expect(fallbackWarnings(logger)).toEqual([{ message: FALLBACK_TRIGGERED_MESSAGE, context: { prefix } }])

      await limiter.consume({ key })
      expect(fallbackWarnings(logger)).toEqual([
        { message: FALLBACK_TRIGGERED_MESSAGE, context: { prefix } },
        { message: FALLBACK_TRIGGERED_MESSAGE, context: { prefix } },
      ])
    })

    it('warns on the factory logger even when a per-call logger is given', async () => {
      const factoryLogger = createLoggerStub()
      const requestLogger = createLoggerStub()
      const client = { status: 'end', del: vi.fn() } as unknown as RedisClient
      const limiter = createBlockingRateLimiter({
        logger: factoryLogger,
        client,
        overrides: { prefix: uniquePrefix() },
      })
      const key = randomUUID()

      await limiter.isBlocked({ key, logger: requestLogger })
      await limiter.consume({ key, logger: requestLogger })

      expect(fallbackWarnings(factoryLogger)).toHaveLength(2)
      expect(fallbackWarnings(requestLogger)).toEqual([])
    })

    it('warns when a reset falls back because Redis could not be cleared', async () => {
      const logger = createLoggerStub()
      const storeError = new Error('Redis connection is not ready')
      const client = { status: 'end', del: vi.fn().mockRejectedValue(storeError) } as unknown as RedisClient
      const prefix = uniquePrefix()
      const limiter = createBlockingRateLimiter({ logger, client, overrides: { prefix } })

      await expect(limiter.reset({ key: randomUUID() })).rejects.toBe(storeError)

      expect(fallbackWarnings(logger)).toEqual([{ message: FALLBACK_TRIGGERED_MESSAGE, context: { prefix } }])
    })

    it('does not warn per call when no client is configured', async () => {
      const logger = createLoggerStub()
      const limiter = createBlockingRateLimiter({ logger, overrides: { prefix: uniquePrefix() } })
      const key = randomUUID()

      await limiter.isBlocked({ key })
      await limiter.consume({ key })
      await limiter.reset({ key })

      expect(fallbackWarnings(logger)).toEqual([])
    })
  })

  it('reports at factory creation when no Redis client is configured', () => {
    const logger = createLoggerStub()
    const prefix = uniquePrefix()

    createBlockingRateLimiter({ logger, overrides: { prefix } })

    expect(logger.error).toHaveBeenCalledWith({
      message:
        'No Redis client configured, using in-memory failure counters and block state. Limits are per-instance and not shared across replicas.',
      context: { prefix, points: 100, duration: 3600, block: { duration: 3600 } },
    })
  })

  it('clamps invalid allowance, window, and block duration values to 1', async () => {
    const limiter = createBlockingRateLimiter({
      logger: defaultLogger,
      overrides: { points: 0, duration: NaN, block: { duration: Infinity }, prefix: uniquePrefix() },
    })
    const key = randomUUID()

    await limiter.consume({ key })
    await limiter.consume({ key })
    const error = await limiter.isBlocked({ key }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(RateLimitExceededError)
    expect((error as RateLimitExceededError).info.points.consumed).toBe(2)
    expect((error as RateLimitExceededError).info.msToNextWindow).toBeGreaterThan(0)
    expect((error as RateLimitExceededError).info.msToNextWindow).toBeLessThanOrEqual(1000)
  })

  it('names the clamped field and reports the original and clamped values in the context', () => {
    const logger = createLoggerStub()
    const prefix = uniquePrefix()

    createBlockingRateLimiter({ logger, overrides: { duration: 60.7, prefix } })

    expect(logger.warn).toHaveBeenCalledWith({
      message: 'Rate limit duration was clamped',
      context: { value: 60.7, clamped: 60, prefix },
    })
  })

  it('warns once per clamped field when several configuration fields are clamped at once', () => {
    const logger = createLoggerStub()

    createBlockingRateLimiter({
      overrides: { points: 0, duration: NaN, block: { duration: Infinity }, prefix: uniquePrefix() },
      logger,
    })

    const clampedFields = logger.warn.mock.calls
      .map(([input]) => /^Rate limit (.+?) was clamped$/.exec(input.message)?.[1])
      .filter(field => field !== undefined)
    expect(clampedFields.sort()).toEqual(['block duration', 'duration', 'points'])
    for (const [input] of logger.warn.mock.calls) {
      expect(input.context).toMatchObject({ clamped: 1 })
    }
  })

  it('stays silent when every configuration value is already valid', () => {
    const logger = createLoggerStub()

    createBlockingRateLimiter({
      overrides: { points: 5, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
      logger,
    })

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('routes the block warning to the per-call logger instead of the factory logger', async () => {
    const factoryLogger = createLoggerStub()
    const requestLogger = createLoggerStub()
    const limiter = createBlockingRateLimiter({
      logger: factoryLogger,
      overrides: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })
    const key = randomUUID()

    await limiter.consume({ key })
    await limiter.consume({ key, logger: requestLogger })

    const isBlockWarning = (input: { message: string }) =>
      input.message === 'Rate limit block engaged after failure allowance was exceeded'
    expect(requestLogger.warn.mock.calls.some(([input]) => isBlockWarning(input))).toBe(true)
    expect(factoryLogger.warn.mock.calls.some(([input]) => isBlockWarning(input))).toBe(false)
  })

  it('reports and rethrows an unexpected isBlocked store error', async () => {
    const logger = createLoggerStub()
    const storeError = new Error('boom')
    const spy = vi.spyOn(RateLimiterMemory.prototype, 'get').mockRejectedValue(storeError)
    try {
      const limiter = createBlockingRateLimiter({ logger, overrides: { prefix: uniquePrefix() } })

      await expect(limiter.isBlocked({ key: randomUUID() })).rejects.toBe(storeError)

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Unexpected rate limiter error', error: storeError }),
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('reports and rethrows an unexpected consume store error', async () => {
    const logger = createLoggerStub()
    const storeError = new Error('boom')
    const spy = vi.spyOn(RateLimiterMemory.prototype, 'consume').mockRejectedValue(storeError)
    try {
      const limiter = createBlockingRateLimiter({ logger, overrides: { prefix: uniquePrefix() } })

      await expect(limiter.consume({ key: randomUUID() })).rejects.toBe(storeError)

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Unexpected rate limiter error', error: storeError }),
      )
    } finally {
      spy.mockRestore()
    }
  })
})
