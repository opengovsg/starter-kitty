import { randomUUID } from 'node:crypto'

import { RateLimiterMemory } from 'rate-limiter-flexible'
import { describe, expect, it, vi } from 'vitest'

import { createGlobalRateLimiter, createLocalRateLimiter, type Logger, RateLimitExceededError } from '../index.js'

const uniquePrefix = () => `test-${randomUUID()}`

// A Logger stub whose `warn` and `error` methods are vitest mocks, for
// asserting which log reached which logger.
const createLoggerStub = () => {
  const warn = vi.fn<Logger['warn']>()
  const error = vi.fn<Logger['error']>()
  return { warn, error } satisfies Logger
}

const defaultLogger = createLoggerStub()

describe('createGlobalRateLimiter', () => {
  it('keys purely by IP, isolating distinct clients', async () => {
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      overrides: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: '1.2.3.4' })
    await expect(limiter.check({ ip: '1.2.3.4' })).rejects.toBeInstanceOf(RateLimitExceededError)
    await expect(limiter.check({ ip: '5.6.7.8' })).resolves.toMatchObject({
      points: { remaining: 0 },
    })
  })

  it('buckets IPv6 addresses by /64 prefix', async () => {
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      overrides: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: '2001:db8:85a3:1::1' })
    // Same /64, different interface identifier: shares the bucket.
    await expect(limiter.check({ ip: '2001:db8:85a3:1:ffff:abcd::2' })).rejects.toBeInstanceOf(RateLimitExceededError)
    // The adjacent /64 gets its own bucket.
    await expect(limiter.check({ ip: '2001:db8:85a3:2::1' })).resolves.toMatchObject({
      points: { remaining: 0 },
    })
  })

  it('normalizes equivalent IPv6 spellings into one bucket', async () => {
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      overrides: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: '2001:db8::1' })
    // Expanded spelling of the same /64 (2001:db8:0:0).
    await expect(limiter.check({ ip: '2001:0db8:0000:0000:1111::2' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('keys a compressed spelling whose tail reaches into the /64 prefix identically to its expanded form', async () => {
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      overrides: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    // `::` here compresses a single zero group inside the first four groups,
    // so the /64 prefix must be assembled from tail groups too.
    await limiter.check({ ip: '2001:db8::3:4:5:6:7' })
    await expect(limiter.check({ ip: '2001:db8:0:3:4:5:6:7' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('ignores IPv6 zone IDs, which never occupy the /64 prefix', async () => {
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      overrides: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: 'fe80::1%eth0' })
    await expect(limiter.check({ ip: 'fe80::2%wlan0' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('normalizes IPv4-mapped IPv6 spellings to their embedded IPv4 address', async () => {
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      overrides: { points: 2, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: '1.2.3.4' })
    await expect(limiter.check({ ip: '::ffff:1.2.3.4' })).resolves.toMatchObject({ points: { remaining: 0 } })
    await expect(limiter.check({ ip: '::ffff:0102:0304' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('funnels unparseable IPs into the unknown bucket, logging an error', async () => {
    const requestLogger = createLoggerStub()
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      overrides: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: 'not-an-ip', logger: requestLogger })
    expect(requestLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Client IP is not a valid IPv4 or IPv6 address, using the shared unknown bucket',
        context: { ip: 'not-an-ip' },
      }),
    )
    // Every unparseable value shares the unknown bucket rather than minting
    // its own.
    await expect(limiter.check({ ip: 'also-not-an-ip' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('uses IP strings verbatim when key normalization is skipped', async () => {
    const requestLogger = createLoggerStub()
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      skipKeyNormalization: true,
      overrides: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: 'not-an-ip', logger: requestLogger })
    await expect(limiter.check({ ip: 'not-an-ip' })).rejects.toBeInstanceOf(RateLimitExceededError)
    expect(requestLogger.warn).not.toHaveBeenCalled()
    expect(requestLogger.error).not.toHaveBeenCalled()
  })

  it('skips IPv6 /64 bucketing when key normalization is skipped', async () => {
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      skipKeyNormalization: true,
      overrides: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: '2001:db8::1' })
    await expect(limiter.check({ ip: '2001:db8::2' })).resolves.toMatchObject({
      points: { remaining: 0 },
    })
  })

  it('defaults to 100 points per second with no burst', async () => {
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      overrides: { prefix: uniquePrefix() },
    })
    const ip = `10.0.0.${Math.floor(Math.random() * 255)}`

    const first = await limiter.check({ ip })
    expect(first.points.remaining).toBe(99)

    for (let i = 0; i < 99; i++) {
      await limiter.check({ ip })
    }
    await expect(limiter.check({ ip })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('forwards a per-check logger through to the underlying limiter', async () => {
    const requestLogger = createLoggerStub()
    const storeError = new Error('boom')
    const spy = vi.spyOn(RateLimiterMemory.prototype, 'consume').mockRejectedValue(storeError)
    try {
      const limiter = createGlobalRateLimiter({
        logger: defaultLogger,
        overrides: {
          points: 5,
          duration: 10,
          burst: null,
          prefix: uniquePrefix(),
        },
      })

      await expect(limiter.check({ ip: '1.2.3.4', logger: requestLogger })).rejects.toBe(storeError)

      expect(requestLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Unexpected rate limiter error' }),
      )
    } finally {
      spy.mockRestore()
    }
  })
})

describe('createLocalRateLimiter', () => {
  it('gives the same actor an independent allowance per resource', async () => {
    const limiter = createLocalRateLimiter({
      logger: defaultLogger,
      overrides: {
        points: 1,
        duration: 10,
        burst: null,
        prefix: uniquePrefix(),
      },
    })
    const actor = randomUUID()

    await limiter.check({ actor, resource: 'bookings.create' })
    await expect(limiter.check({ actor, resource: 'bookings.create' })).rejects.toBeInstanceOf(RateLimitExceededError)
    await expect(limiter.check({ actor, resource: 'bookings.list' })).resolves.toMatchObject({
      points: { remaining: 0 },
    })
  })

  it('isolates different actors on the same resource', async () => {
    const limiter = createLocalRateLimiter({
      logger: defaultLogger,
      overrides: {
        points: 1,
        duration: 10,
        burst: null,
        prefix: uniquePrefix(),
      },
    })
    const resource = 'auth.login'

    await limiter.check({ actor: randomUUID(), resource })
    await expect(limiter.check({ actor: randomUUID(), resource })).resolves.toMatchObject({
      points: { remaining: 0 },
    })
  })

  it('forwards a per-check logger through to the underlying limiter', async () => {
    const requestLogger = createLoggerStub()
    const storeError = new Error('boom')
    const spy = vi.spyOn(RateLimiterMemory.prototype, 'consume').mockRejectedValue(storeError)
    try {
      const limiter = createLocalRateLimiter({
        logger: defaultLogger,
        overrides: {
          points: 5,
          duration: 10,
          burst: null,
          prefix: uniquePrefix(),
        },
      })

      await expect(
        limiter.check({
          actor: randomUUID(),
          resource: 'bookings.create',
          logger: requestLogger,
        }),
      ).rejects.toBe(storeError)

      expect(requestLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Unexpected rate limiter error' }),
      )
    } finally {
      spy.mockRestore()
    }
  })
})
