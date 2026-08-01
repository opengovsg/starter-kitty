import { randomUUID } from 'node:crypto'

import { getMappedPort, redis } from '@opengovsg/testcontainers'
import { createGlobalSetup, type ProvidedContainers } from '@opengovsg/testcontainers/vitest'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { TestProject } from 'vitest/node'

import { createGlobalRateLimiter, createLocalRateLimiter, type Logger, RateLimitExceededError } from '../index.js'

const uniquePrefix = () => `test-${randomUUID()}`

const createLoggerStub = () => {
  const warn = vi.fn<Logger['warn']>()
  const error = vi.fn<Logger['error']>()
  return { warn, error } satisfies Logger
}

const defaultLogger = createLoggerStub()

// Real Docker required: boots a single Redis container for this file via the
// testcontainers globalSetup factory, torn down after all tests run. Exists
// because the fallback allowance (ADR 0010) now governs the no-client and
// Redis-not-ready paths, so verifying that a *healthy* Redis genuinely
// enforces the primary points/duration configuration (not the fallback)
// requires a real, reachable Redis — no stub can demonstrate this.
describe('rate limiters against a real, healthy Redis', () => {
  let client: Redis
  let teardown: () => Promise<void>

  beforeAll(async () => {
    let provided: ProvidedContainers | undefined
    const project = {
      provide: (_key: string, value: ProvidedContainers) => {
        provided = value
      },
    } as unknown as TestProject

    teardown = await createGlobalSetup([redis()])(project)
    const info = provided!.redis!
    client = new Redis({ host: info.host, port: getMappedPort(info, 6379) })
    await client.ping()
  }, 180_000)

  afterAll(async () => {
    client.disconnect()
    await teardown()
  })

  it("enforces the global limiter's built-in default of 100 points per second when Redis is healthy", async () => {
    const limiter = createGlobalRateLimiter({
      client,
      logger: defaultLogger,
      overrides: { prefix: uniquePrefix() },
    })
    const ip = `10.0.0.${Math.floor(Math.random() * 255)}`

    const first = await limiter.check({ ip })
    expect(first.points.remaining).toBe(99)

    let rest = first
    for (let i = 0; i < 99; i++) {
      rest = await limiter.check({ ip })
    }
    expect(rest.points.remaining).toBe(0)
    await expect(limiter.check({ ip })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it("enforces the local limiter's creation-time defaults when Redis is healthy", async () => {
    const limiter = createLocalRateLimiter({
      client,
      logger: defaultLogger,
      overrides: {
        points: 1,
        duration: 10,
        burst: null,
        prefix: uniquePrefix(),
      },
    })
    const actor = randomUUID()

    await limiter.check({ actor, resource: 'auth.otp' })
    await expect(limiter.check({ actor, resource: 'auth.otp' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it('grants extra requests from the burst allowance when Redis is healthy', async () => {
    const limiter = createLocalRateLimiter({
      client,
      logger: defaultLogger,
      overrides: {
        points: 1,
        duration: 10,
        burst: { points: 2, duration: 30 },
        prefix: uniquePrefix(),
      },
    })
    const actor = randomUUID()

    await limiter.check({ actor, resource: 'bookings.create' })
    await limiter.check({ actor, resource: 'bookings.create' })
    await limiter.check({ actor, resource: 'bookings.create' })
    await expect(limiter.check({ actor, resource: 'bookings.create' })).rejects.toBeInstanceOf(RateLimitExceededError)
  })
})
