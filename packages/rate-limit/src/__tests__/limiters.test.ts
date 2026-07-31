import { randomUUID } from 'node:crypto'

import { RateLimiterMemory } from 'rate-limiter-flexible'
import { describe, expect, it, vi } from 'vitest'

import { createGlobalRateLimiter, createLocalRateLimiter, type Logger, RateLimitExceededError } from '../index.js'

const uniquePrefix = () => `test-${randomUUID()}`

// A Logger stub whose single `warn` method is a vitest mock, for asserting
// which warnings reached which logger.
const createLoggerStub = () => {
  const warn = vi.fn<Logger['warn']>()
  return { warn } satisfies Logger
}

describe('createGlobalRateLimiter', () => {
  it('keys purely by IP, isolating distinct clients', async () => {
    const limiter = createGlobalRateLimiter({
      defaults: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: '1.2.3.4' })
    await expect(limiter.check({ ip: '1.2.3.4' })).rejects.toBeInstanceOf(RateLimitExceededError)
    await expect(limiter.check({ ip: '5.6.7.8' })).resolves.toMatchObject({ points: { remaining: 0 } })
  })

  it('buckets null IPs together as unknown instead of exempting them', async () => {
    const limiter = createGlobalRateLimiter({
      defaults: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: null })
    await expect(limiter.check({ ip: null })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('buckets IPv6 addresses by /64 prefix', async () => {
    const limiter = createGlobalRateLimiter({
      defaults: { points: 1, duration: 10, prefix: uniquePrefix() },
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
      defaults: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: '2001:db8::1' })
    // Expanded spelling of the same /64 (2001:db8:0:0).
    await expect(limiter.check({ ip: '2001:0db8:0000:0000:1111::2' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('keys a compressed spelling whose tail reaches into the /64 prefix identically to its expanded form', async () => {
    const limiter = createGlobalRateLimiter({
      defaults: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    // `::` here compresses a single zero group inside the first four groups,
    // so the /64 prefix must be assembled from tail groups too.
    await limiter.check({ ip: '2001:db8::3:4:5:6:7' })
    await expect(limiter.check({ ip: '2001:db8:0:3:4:5:6:7' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('ignores IPv6 zone IDs, which never occupy the /64 prefix', async () => {
    const limiter = createGlobalRateLimiter({
      defaults: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: 'fe80::1%eth0' })
    await expect(limiter.check({ ip: 'fe80::2%wlan0' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('normalizes IPv4-mapped IPv6 spellings to their embedded IPv4 address', async () => {
    const limiter = createGlobalRateLimiter({
      defaults: { points: 2, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: '1.2.3.4' })
    await expect(limiter.check({ ip: '::ffff:1.2.3.4' })).resolves.toMatchObject({ points: { remaining: 0 } })
    await expect(limiter.check({ ip: '::ffff:0102:0304' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('warns when the IP is null, preferring the per-check logger', async () => {
    const factoryLogger = createLoggerStub()
    const requestLogger = createLoggerStub()
    const limiter = createGlobalRateLimiter({
      logger: factoryLogger,
      defaults: { points: 5, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: null, logger: requestLogger })
    expect(requestLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Client IP extraction returned null, using the shared unknown bucket' }),
    )
    // The factory logger still receives configuration warnings (no Redis
    // client), but the null-IP request warning must go to the request logger.
    expect(factoryLogger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Client IP extraction returned null, using the shared unknown bucket' }),
    )

    await limiter.check({ ip: null })
    expect(factoryLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Client IP extraction returned null, using the shared unknown bucket' }),
    )
  })

  it('funnels unparseable IPs into the unknown bucket with a warning', async () => {
    const requestLogger = createLoggerStub()
    const limiter = createGlobalRateLimiter({
      defaults: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: 'not-an-ip', logger: requestLogger })
    expect(requestLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Client IP is not a valid IPv4 or IPv6 address, using the shared unknown bucket',
        context: { ip: 'not-an-ip' },
      }),
    )
    // Shares the unknown bucket with null IPs rather than minting its own.
    await expect(limiter.check({ ip: null })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('uses non-null IP strings verbatim when validation is disabled', async () => {
    const requestLogger = createLoggerStub()
    const limiter = createGlobalRateLimiter({
      validate: false,
      defaults: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: 'not-an-ip', logger: requestLogger })
    await expect(limiter.check({ ip: 'not-an-ip' })).rejects.toBeInstanceOf(RateLimitExceededError)
    expect(requestLogger.warn).not.toHaveBeenCalled()

    // The invalid string has its own verbatim bucket rather than sharing the
    // unknown bucket, but null remains an extraction failure and is warned.
    await expect(limiter.check({ ip: null, logger: requestLogger })).resolves.toMatchObject({
      points: { remaining: 0 },
    })
    expect(requestLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Client IP extraction returned null, using the shared unknown bucket' }),
    )
  })

  it('skips IPv6 /64 bucketing when validation is disabled', async () => {
    const limiter = createGlobalRateLimiter({
      validate: false,
      defaults: { points: 1, duration: 10, prefix: uniquePrefix() },
    })

    await limiter.check({ ip: '2001:db8::1' })
    await expect(limiter.check({ ip: '2001:db8::2' })).resolves.toMatchObject({ points: { remaining: 0 } })
  })

  it('defaults to 100 points per second with no burst', async () => {
    const limiter = createGlobalRateLimiter({
      defaults: { prefix: uniquePrefix() },
    })
    const ip = `10.0.0.${Math.floor(Math.random() * 255)}`

    const first = await limiter.check({ ip })
    expect(first.points.remaining).toBe(99)

    const rest = await limiter.check({ ip, points: 99 })
    expect(rest.points.remaining).toBe(0)
    await expect(limiter.check({ ip })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('forwards a per-check logger through to the underlying limiter', async () => {
    const requestLogger = createLoggerStub()
    const storeError = new Error('boom')
    const spy = vi.spyOn(RateLimiterMemory.prototype, 'consume').mockRejectedValue(storeError)
    try {
      const limiter = createGlobalRateLimiter({
        defaults: { points: 5, duration: 10, burst: null, prefix: uniquePrefix() },
      })

      await expect(limiter.check({ ip: '1.2.3.4', logger: requestLogger })).rejects.toBe(storeError)

      expect(requestLogger.warn).toHaveBeenCalledWith(
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
      defaults: { points: 1, duration: 10, burst: null, prefix: uniquePrefix() },
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
      defaults: { points: 1, duration: 10, burst: null, prefix: uniquePrefix() },
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
        defaults: { points: 5, duration: 10, burst: null, prefix: uniquePrefix() },
      })

      await expect(
        limiter.check({ actor: randomUUID(), resource: 'bookings.create', logger: requestLogger }),
      ).rejects.toBe(storeError)

      expect(requestLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Unexpected rate limiter error' }),
      )
    } finally {
      spy.mockRestore()
    }
  })
})
