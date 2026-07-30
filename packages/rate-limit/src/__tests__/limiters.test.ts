import { randomUUID } from 'node:crypto'

import { RateLimiterMemory } from 'rate-limiter-flexible'
import { describe, expect, it, vi } from 'vitest'

import {
  createAuthnRateLimiter,
  createGlobalRateLimiter,
  createLocalRateLimiter,
  type Logger,
  RateLimitExceededError,
} from '../index.js'

const uniquePrefix = () => `test-${randomUUID()}`

// A Logger stub whose `warn`/`error` methods are vitest mocks, for asserting
// which diagnostics reached which logger.
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
      overrides: {
        points: 1,
        duration: 10,
        fallback: { points: 1, duration: 10 },
        prefix: uniquePrefix(),
      },
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
      overrides: {
        points: 1,
        duration: 10,
        fallback: { points: 1, duration: 10 },
        prefix: uniquePrefix(),
      },
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
      overrides: {
        points: 1,
        duration: 10,
        fallback: { points: 1, duration: 10 },
        prefix: uniquePrefix(),
      },
    })

    await limiter.check({ ip: '2001:db8::1' })
    // Expanded spelling of the same /64 (2001:db8:0:0).
    await expect(limiter.check({ ip: '2001:0db8:0000:0000:1111::2' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('keys a compressed spelling whose tail reaches into the /64 prefix identically to its expanded form', async () => {
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      overrides: {
        points: 1,
        duration: 10,
        fallback: { points: 1, duration: 10 },
        prefix: uniquePrefix(),
      },
    })

    // `::` here compresses a single zero group inside the first four groups,
    // so the /64 prefix must be assembled from tail groups too.
    await limiter.check({ ip: '2001:db8::3:4:5:6:7' })
    await expect(limiter.check({ ip: '2001:db8:0:3:4:5:6:7' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('ignores IPv6 zone IDs, which never occupy the /64 prefix', async () => {
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      overrides: {
        points: 1,
        duration: 10,
        fallback: { points: 1, duration: 10 },
        prefix: uniquePrefix(),
      },
    })

    await limiter.check({ ip: 'fe80::1%eth0' })
    await expect(limiter.check({ ip: 'fe80::2%wlan0' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('normalizes IPv4-mapped IPv6 spellings to their embedded IPv4 address', async () => {
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      overrides: {
        points: 2,
        duration: 10,
        fallback: { points: 2, duration: 10 },
        prefix: uniquePrefix(),
      },
    })

    await limiter.check({ ip: '1.2.3.4' })
    await expect(limiter.check({ ip: '::ffff:1.2.3.4' })).resolves.toMatchObject({ points: { remaining: 0 } })
    await expect(limiter.check({ ip: '::ffff:0102:0304' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('funnels unparseable IPs into the unknown bucket, logging an error', async () => {
    const requestLogger = createLoggerStub()
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      overrides: {
        points: 1,
        duration: 10,
        fallback: { points: 1, duration: 10 },
        prefix: uniquePrefix(),
      },
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

  it.each([null, undefined])('funnels a %s IP into the unknown bucket, logging an error', async invalidIp => {
    const requestLogger = createLoggerStub()
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      overrides: {
        points: 1,
        duration: 10,
        fallback: { points: 1, duration: 10 },
        prefix: uniquePrefix(),
      },
    })

    await limiter.check({ ip: invalidIp, logger: requestLogger })
    expect(requestLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Client IP extraction did not return a string, using the shared unknown bucket',
        context: { ip: String(invalidIp) },
      }),
    )
    // Shares the unknown bucket with unparseable strings rather than minting
    // its own.
    await expect(limiter.check({ ip: 'not-an-ip' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it.each([42, {}])(
    'funnels the non-string IP %o from a JavaScript caller into the unknown bucket',
    async invalidIp => {
      const requestLogger = createLoggerStub()
      const limiter = createGlobalRateLimiter({
        logger: defaultLogger,
        overrides: {
          points: 1,
          duration: 10,
          fallback: { points: 1, duration: 10 },
          prefix: uniquePrefix(),
        },
      })

      // @ts-expect-error simulates a JavaScript caller with no type checking.
      await limiter.check({ ip: invalidIp, logger: requestLogger })
      expect(requestLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Client IP extraction did not return a string, using the shared unknown bucket',
          context: { ip: String(invalidIp) },
        }),
      )
      await expect(limiter.check({ ip: 'not-an-ip' })).rejects.toBeInstanceOf(RateLimitExceededError)
    },
  )

  it('funnels non-string IPs into the unknown bucket even when key normalization is skipped', async () => {
    const requestLogger = createLoggerStub()
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      skipKeyNormalization: true,
      overrides: {
        points: 1,
        duration: 10,
        fallback: { points: 1, duration: 10 },
        prefix: uniquePrefix(),
      },
    })

    await limiter.check({ ip: undefined, logger: requestLogger })
    expect(requestLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Client IP extraction did not return a string, using the shared unknown bucket',
      }),
    )
    await expect(limiter.check({ ip: null })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('uses IP strings verbatim when key normalization is skipped', async () => {
    const requestLogger = createLoggerStub()
    const limiter = createGlobalRateLimiter({
      logger: defaultLogger,
      skipKeyNormalization: true,
      overrides: {
        points: 1,
        duration: 10,
        fallback: { points: 1, duration: 10 },
        prefix: uniquePrefix(),
      },
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
      overrides: {
        points: 1,
        duration: 10,
        fallback: { points: 1, duration: 10 },
        prefix: uniquePrefix(),
      },
    })

    await limiter.check({ ip: '2001:db8::1' })
    await expect(limiter.check({ ip: '2001:db8::2' })).resolves.toMatchObject({
      points: { remaining: 0 },
    })
  })

  // The global limiter's literal built-in default (100 points/second, no
  // burst) can no longer be observed via the no-client path — the fallback
  // allowance (10/s) governs it instead, per ADR 0010. See
  // `rate-limiter.docker.test.ts` for that coverage against a real Redis.

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

describe('createAuthnRateLimiter', () => {
  it('records failures by IP and blocks only after the allowance is exceeded', async () => {
    const limiter = createAuthnRateLimiter({
      defaults: { points: 2, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })
    const ip = '1.2.3.4'

    await limiter.consume({ ip })
    await limiter.consume({ ip })
    await expect(limiter.isBlocked({ ip })).resolves.toBeUndefined()

    await limiter.consume({ ip })
    await expect(limiter.isBlocked({ ip })).rejects.toBeInstanceOf(RateLimitExceededError)
    await expect(limiter.isBlocked({ ip: '5.6.7.8' })).resolves.toBeUndefined()
  })

  it('buckets IPv6 addresses by /64 prefix', async () => {
    const limiter = createAuthnRateLimiter({
      defaults: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })

    await limiter.consume({ ip: '2001:db8:85a3:1::1' })
    await limiter.consume({ ip: '2001:db8:85a3:1:ffff:abcd::2' })

    await expect(limiter.isBlocked({ ip: '2001:db8:85a3:1::3' })).rejects.toBeInstanceOf(RateLimitExceededError)
    await expect(limiter.isBlocked({ ip: '2001:db8:85a3:2::1' })).resolves.toBeUndefined()
  })

  it('normalizes IPv4-mapped IPv6 spellings to the embedded IPv4 bucket', async () => {
    const limiter = createAuthnRateLimiter({
      defaults: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })

    await limiter.consume({ ip: '1.2.3.4' })
    await limiter.consume({ ip: '::ffff:0102:0304' })

    await expect(limiter.isBlocked({ ip: '::ffff:1.2.3.4' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('funnels null and unparseable IPs into the shared unknown bucket', async () => {
    const logger = createLoggerStub()
    const limiter = createAuthnRateLimiter({
      defaults: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })

    await limiter.consume({ ip: null, logger })
    await limiter.consume({ ip: 'not-an-ip', logger })

    await expect(limiter.isBlocked({ ip: null, logger })).rejects.toBeInstanceOf(RateLimitExceededError)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Client IP extraction returned null, using the shared unknown bucket' }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Client IP is not a valid IPv4 or IPv6 address, using the shared unknown bucket',
        context: { ip: 'not-an-ip' },
      }),
    )
  })

  it('uses non-null strings verbatim when validation is disabled', async () => {
    const logger = createLoggerStub()
    const limiter = createAuthnRateLimiter({
      validate: false,
      defaults: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })

    await limiter.consume({ ip: 'not-an-ip', logger })
    await limiter.consume({ ip: 'not-an-ip', logger })

    await expect(limiter.isBlocked({ ip: 'not-an-ip', logger })).rejects.toBeInstanceOf(RateLimitExceededError)
    await expect(limiter.isBlocked({ ip: null, logger })).resolves.toBeUndefined()
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Client IP is not a valid IPv4 or IPv6 address, using the shared unknown bucket',
      }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Client IP extraction returned null, using the shared unknown bucket' }),
    )
  })

  it('routes IP and block warnings to the per-call logger', async () => {
    const factoryLogger = createLoggerStub()
    const requestLogger = createLoggerStub()
    const limiter = createAuthnRateLimiter({
      logger: factoryLogger,
      defaults: { points: 1, duration: 60, block: { duration: 30 }, prefix: uniquePrefix() },
    })

    await limiter.consume({ ip: null, logger: requestLogger })
    await limiter.consume({ ip: null, logger: requestLogger })

    expect(requestLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Client IP extraction returned null, using the shared unknown bucket' }),
    )
    expect(requestLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Rate limit block engaged after failure allowance was exceeded' }),
    )
    expect(factoryLogger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Rate limit block engaged after failure allowance was exceeded' }),
    )
  })

  it('resolves its own defaults, not the base blocking limiter defaults', () => {
    const logger = createLoggerStub()

    createAuthnRateLimiter({ logger })

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { prefix: 'authn', points: 100, duration: 3600, block: { duration: 3600 } },
      }),
    )
  })

  it('warns about a clamped configuration value through the wrapper', () => {
    const logger = createLoggerStub()
    const prefix = uniquePrefix()

    createAuthnRateLimiter({ logger, defaults: { duration: 60.7, prefix } })

    // Once, not twice: the wrapper merges its own defaults and the factory
    // merges again over the base, but only the factory validates.
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith({
      message: 'Rate limit duration was clamped',
      context: { value: 60.7, clamped: 60, prefix },
    })
  })

  it('does not expose reset on the IP-keyed wrapper', () => {
    const limiter = createAuthnRateLimiter({ defaults: { prefix: uniquePrefix() } })

    expect('reset' in limiter).toBe(false)
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
        fallback: { points: 1, duration: 10 },
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
        fallback: { points: 1, duration: 10 },
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
