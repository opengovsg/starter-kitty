import type { RateLimiterAbstract, RateLimiterRes } from 'rate-limiter-flexible'
import { BurstyRateLimiter, RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible'

import { RateLimitExceededError } from './errors.js'
import type {
  BurstConfig,
  CreateRateLimiterOptions,
  Logger,
  RateLimitConfig,
  RateLimitInfo,
  RedisClient,
} from './types.js'

const STEADY_NAMESPACE = 'rate-limit:'
const BURST_NAMESPACE = 'rate-limit-burst:'

interface Config {
  points: number
  duration: number
  burst: BurstConfig | null
  prefix: string
}

/**
 * Roughly 5 requests per second, measured over a 10-second window to smooth
 * out spikes, plus a burst allowance for flurries like a page load firing
 * parallel API calls.
 */
const BASE_DEFAULTS: Config = {
  points: 50,
  duration: 10,
  burst: { points: 20, duration: 30 },
  prefix: 'api',
}

/**
 * Merge a partial config over a resolved base. An omitted `burst` inherits
 * the base's. An explicit `null` disables bursting.
 */
export const mergeConfig = (base: Config, override?: RateLimitConfig): Config => ({
  points: override?.points ?? base.points,
  duration: override?.duration ?? base.duration,
  burst: override?.burst !== undefined ? override.burst : base.burst,
  prefix: override?.prefix ?? base.prefix,
})

/**
 * Clamp to a safe positive integer. Non-finite and below-1 values degrade to
 * 1, where a negative would otherwise replenish the allowance. Fractions are
 * truncated because the Redis-backed limiter rejects non-integer arguments
 * at runtime.
 */
const clamp = (value: number): number => {
  return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : 1
}

/**
 * Clamp every numeric field, since caller input is not validated at the type
 * level.
 */
const validateConfig = (config: Config, logger?: Logger): Config => {
  const validated = {
    points: clamp(config.points),
    duration: clamp(config.duration),
    burst: config.burst
      ? {
          points: clamp(config.burst.points),
          duration: clamp(config.burst.duration),
        }
      : null,
    prefix: config.prefix,
  }

  if (logger) {
    if (validated.points !== config.points) {
      logger?.warn({
        message: 'Rate limit points was clamped',
        context: {
          value: config.points,
          clamped: validated.points,
          prefix: config.prefix,
        },
      })
    }
    if (validated.duration !== config.duration) {
      logger?.warn({
        message: 'Rate limit duration was clamped',
        context: {
          value: config.duration,
          clamped: validated.duration,
          prefix: config.prefix,
        },
      })
    }
    if (config.burst && validated.burst) {
      if (validated.burst.points !== config.burst.points) {
        logger?.warn({
          message: 'Rate limit burst points was clamped',
          context: {
            value: config.burst.points,
            clamped: validated.burst.points,
            prefix: config.prefix,
          },
        })
      }
      if (validated.burst.duration !== config.burst.duration) {
        logger?.warn({
          message: 'Rate limit burst duration was clamped',
          context: {
            value: config.burst.duration,
            clamped: validated.burst.duration,
            prefix: config.prefix,
          },
        })
      }
    }
  }

  return {
    ...validated,
  }
}

const toRateLimitInfo = (res: RateLimiterRes): RateLimitInfo => ({
  points: {
    remaining: res.remainingPoints,
    consumed: res.consumedPoints,
  },
  msToNextWindow: res.msBeforeNext,
  isFirstInWindow: res.isFirstInDuration,
})

/**
 * Match a limit rejection by shape, since `instanceof RateLimiterRes` is
 * unreliable when a dual CJS/ESM dependency is loaded twice.
 */
const isRateLimiterRes = (value: unknown): value is RateLimiterRes => {
  if (typeof value !== 'object' || value === null) return false
  const res = value as Partial<RateLimiterRes>
  return typeof res.remainingPoints === 'number' && typeof res.msBeforeNext === 'number'
}

/**
 * A rate limiter. Obtain one via {@link createRateLimiter},
 * {@link createGlobalRateLimiter} or {@link createLocalRateLimiter}.
 *
 * @public
 */
export interface RateLimiter {
  /**
   * Consume `points` (default 1) from `key`'s allowance. Numeric values are
   * clamped to safe positive integers and each clamp is logged. See
   * {@link RateLimitConfig} for the clamping rules.
   *
   * Resolves with a {@link RateLimitInfo} snapshot when within limits. Throws
   * {@link RateLimitExceededError} when the allowance is exhausted. Any other
   * error is reported to `logger` and rethrown as-is, so the caller decides
   * between failing open and failing closed.
   *
   * Pass a request-scoped `logger` to attach request identity to the warnings
   * this call may emit. Omit it to fall back to the factory logger.
   */
  check(args: { key: string; points?: number; logger?: Logger }): Promise<RateLimitInfo>
}

const buildLimiter = (
  config: Config,
  client: RedisClient | null,
  logger?: Logger,
): RateLimiterAbstract | BurstyRateLimiter => {
  const { points, duration, burst } = config
  const steadyMemoryLimiter = new RateLimiterMemory({ points, duration })
  const burstMemoryLimiter = burst
    ? new RateLimiterMemory({
        points: burst.points,
        duration: burst.duration,
      })
    : null

  if (!client) {
    logger?.warn({
      message:
        'No Redis client configured, using in-memory rate limiting. Limits are per-instance and not shared across replicas.',
      context: { prefix: config.prefix },
    })
    return burstMemoryLimiter ? new BurstyRateLimiter(steadyMemoryLimiter, burstMemoryLimiter) : steadyMemoryLimiter
  }

  const steady = new RateLimiterRedis({
    storeClient: client,
    rejectIfRedisNotReady: true,
    points,
    duration,
    keyPrefix: `${STEADY_NAMESPACE}${config.prefix}:`,
    insuranceLimiter: steadyMemoryLimiter,
  })
  if (!burst || !burstMemoryLimiter) {
    return steady
  }
  return new BurstyRateLimiter(
    steady,
    new RateLimiterRedis({
      storeClient: client,
      rejectIfRedisNotReady: true,
      points: burst.points,
      duration: burst.duration,
      keyPrefix: `${BURST_NAMESPACE}${config.prefix}:`,
      insuranceLimiter: burstMemoryLimiter,
    }),
  )
}

/**
 * Create a rate limiter backed by the injected Redis client, or by in-memory
 * counters when no client is configured.
 *
 * @public
 */
export const createRateLimiter = (options: CreateRateLimiterOptions = {}): RateLimiter => {
  const { client = null, logger } = options

  const config = validateConfig(mergeConfig(BASE_DEFAULTS, options.defaults), logger)

  const limiter = buildLimiter(config, client, logger)

  return {
    check: async ({ key, points = 1, logger: checkLogger }) => {
      const lgr = checkLogger ?? logger
      const clampedPoints = clamp(points)
      if (clampedPoints !== points) {
        lgr?.warn({
          message: 'Rate limit consumption points was clamped',
          context: {
            value: points,
            clamped: clampedPoints,
            prefix: config.prefix,
          },
        })
      }
      try {
        const res = await limiter.consume(key, clampedPoints)
        return toRateLimitInfo(res)
      } catch (error) {
        if (isRateLimiterRes(error)) {
          throw new RateLimitExceededError(toRateLimitInfo(error))
        }
        lgr?.warn({
          message: 'Unexpected rate limiter error',
          context: { prefix: config.prefix },
          error,
        })
        throw error
      }
    },
  }
}
