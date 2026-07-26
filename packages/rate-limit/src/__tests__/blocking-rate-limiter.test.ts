import { randomUUID } from 'node:crypto'

import { RateLimiterMemory } from 'rate-limiter-flexible'
import { describe, expect, it, vi } from 'vitest'

import { createBlockingRateLimiter, type Logger, RateLimitExceededError, type RedisClient } from '../index.js'

const uniquePrefix = () => `test-${randomUUID()}`

const createLoggerStub = () => {
  const warn = vi.fn<Logger['warn']>()
  const error = vi.fn<Logger['error']>()
  return { warn, error } satisfies Logger
}

describe('createBlockingRateLimiter', () => {
  it('checks an unseen key without minting state or consuming a point', async () => {
    const getSpy = vi.spyOn(RateLimiterMemory.prototype, 'get')
    const consumeSpy = vi.spyOn(RateLimiterMemory.prototype, 'consume')
    try {
      const limiter = createBlockingRateLimiter({ defaults: { prefix: uniquePrefix() } })
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
      defaults: { points: 2, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
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
    const limiter = createBlockingRateLimiter({
      logger,
      defaults: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })
    const key = randomUUID()

    await limiter.consume({ key })
    await limiter.consume({ key })
    await limiter.consume({ key })

    const blockWarnings = logger.warn.mock.calls.filter(
      ([input]) => input.message === 'Rate limit block engaged after failure allowance was exceeded',
    )
    expect(blockWarnings).toHaveLength(1)
    expect(blockWarnings[0]?.[0].context).toEqual({ bucket: key, consumed: 2, block: { duration: 30 } })
  })

  it('resets a blocked key', async () => {
    const limiter = createBlockingRateLimiter({
      defaults: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
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
      client,
      defaults: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })
    const key = randomUUID()

    await limiter.consume({ key })
    await limiter.consume({ key })
    await expect(limiter.isBlocked({ key })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('clears stale insurance state when reset succeeds after Redis recovers', async () => {
    const clientState = { status: 'end', del: vi.fn().mockResolvedValue(1) }
    const limiter = createBlockingRateLimiter({
      client: clientState as unknown as RedisClient,
      defaults: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })
    const key = randomUUID()

    await limiter.consume({ key })
    await limiter.consume({ key })
    await expect(limiter.isBlocked({ key })).rejects.toBeInstanceOf(RateLimitExceededError)

    clientState.status = 'ready'
    await expect(limiter.reset({ key })).resolves.toBeUndefined()
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
      client,
      defaults: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })
    const key = randomUUID()

    await limiter.consume({ key })
    await limiter.consume({ key })
    await expect(limiter.isBlocked({ key })).rejects.toBeInstanceOf(RateLimitExceededError)

    await expect(limiter.reset({ key })).rejects.toBe(storeError)
    await expect(limiter.isBlocked({ key })).resolves.toBeUndefined()
  })

  it('reports at factory creation when no Redis client is configured', () => {
    const logger = createLoggerStub()
    const prefix = uniquePrefix()

    createBlockingRateLimiter({ logger, defaults: { prefix } })

    expect(logger.error).toHaveBeenCalledWith({
      message:
        'No Redis client configured, using in-memory failure counters and block state. Limits are per-instance and not shared across replicas.',
      context: { prefix, points: 100, duration: 3600, block: { duration: 3600 } },
    })
  })

  it('clamps invalid allowance, window, and block duration values to 1', async () => {
    const limiter = createBlockingRateLimiter({
      defaults: { points: 0, duration: NaN, block: { duration: Infinity }, prefix: uniquePrefix() },
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

  it('routes the block warning to the per-call logger instead of the factory logger', async () => {
    const factoryLogger = createLoggerStub()
    const requestLogger = createLoggerStub()
    const limiter = createBlockingRateLimiter({
      logger: factoryLogger,
      defaults: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
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
      const limiter = createBlockingRateLimiter({ logger, defaults: { prefix: uniquePrefix() } })

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
      const limiter = createBlockingRateLimiter({ logger, defaults: { prefix: uniquePrefix() } })

      await expect(limiter.consume({ key: randomUUID() })).rejects.toBe(storeError)

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Unexpected rate limiter error', error: storeError }),
      )
    } finally {
      spy.mockRestore()
    }
  })
})
