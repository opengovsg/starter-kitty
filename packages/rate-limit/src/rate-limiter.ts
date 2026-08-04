import type { RateLimiterAbstract, RateLimiterRes } from 'rate-limiter-flexible'
import { BurstyRateLimiter, RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible'

import { BASE_RATE_LIMIT_DEFAULTS } from './constants.js'
import { RateLimitExceededError } from './errors.js'
import type { CreateRateLimiterOptions, Logger, RateLimitInfo, RedisClient, RequiredRateLimitConfig } from './types.js'
import { clamp, mergeConfig } from './utilities.js'

const STEADY_NAMESPACE = 'rate-limit:'
const BURST_NAMESPACE = 'rate-limit-burst:'

/**
 * Clamp every numeric field, since caller input is not validated at the type
 * level.
 */
const validateConfig = (config: RequiredRateLimitConfig, logger: Logger): RequiredRateLimitConfig => {
  const validated = {
    points: clamp(config.points),
    duration: clamp(config.duration),
    burst: config.burst
      ? {
          points: clamp(config.burst.points),
          duration: clamp(config.burst.duration),
        }
      : null,
    fallback: {
      points: clamp(config.fallback.points),
      duration: clamp(config.fallback.duration),
    },
    prefix: config.prefix,
  }

  if (validated.points !== config.points) {
    logger.warn({
      message: 'Rate limit points was clamped',
      context: {
        value: config.points,
        clamped: validated.points,
        prefix: config.prefix,
      },
    })
  }
  if (validated.duration !== config.duration) {
    logger.warn({
      message: 'Rate limit duration was clamped',
      context: {
        value: config.duration,
        clamped: validated.duration,
        prefix: config.prefix,
      },
    })
  }
  if (validated.fallback.points !== config.fallback.points) {
    logger.warn({
      message: 'Rate limit fallback points was clamped',
      context: {
        value: config.fallback.points,
        clamped: validated.fallback.points,
        prefix: config.prefix,
      },
    })
  }
  if (validated.fallback.duration !== config.fallback.duration) {
    logger.warn({
      message: 'Rate limit fallback duration was clamped',
      context: {
        value: config.fallback.duration,
        clamped: validated.fallback.duration,
        prefix: config.prefix,
      },
    })
  }
  if (config.burst && validated.burst) {
    if (validated.burst.points !== config.burst.points) {
      logger.warn({
        message: 'Rate limit burst points was clamped',
        context: {
          value: config.burst.points,
          clamped: validated.burst.points,
          prefix: config.prefix,
        },
      })
    }
    if (validated.burst.duration !== config.burst.duration) {
      logger.warn({
        message: 'Rate limit burst duration was clamped',
        context: {
          value: config.burst.duration,
          clamped: validated.burst.duration,
          prefix: config.prefix,
        },
      })
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
   * Consume one point from `key`'s allowance.
   *
   * Resolves with a {@link RateLimitInfo} snapshot when within limits. Throws
   * {@link RateLimitExceededError} when the allowance is exhausted. Any other
   * error is reported via `logger.error` and rethrown as-is, so the caller
   * decides between failing open and failing closed.
   *
   * Pass a request-scoped `logger` to attach request identity to anything
   * this call may log. Omit it to fall back to the factory logger.
   */
  check(args: { key: string; logger?: Logger }): Promise<RateLimitInfo>
}

const buildLimiter = (
  config: RequiredRateLimitConfig,
  client: RedisClient | null,
  logger: Logger,
): RateLimiterAbstract | BurstyRateLimiter => {
  const { points, duration, burst, fallback } = config

  const memory = new RateLimiterMemory({
    points: fallback.points,
    duration: fallback.duration,
  })

  if (!client) {
    logger.error({
      message:
        'No Redis client configured, using in-memory rate limiting at the fallback allowance. Limits are per-instance and not shared across replicas.',
      context: {
        prefix: config.prefix,
        fallbackPoints: fallback.points,
        fallbackDuration: fallback.duration,
      },
    })
    return memory
  }

  const steady = new RateLimiterRedis({
    storeClient: client,
    rejectIfRedisNotReady: true,
    points,
    duration,
    keyPrefix: `${STEADY_NAMESPACE}${config.prefix}:`,
    insuranceLimiter: memory,
  })
  if (!burst) {
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
      /**
       * No burst during Redis outage, but we put a fallback to continue
       * throwing `{@link RateLimitExceededError}` instead.
       */
      insuranceLimiter: new RateLimiterMemory({
        points: 0,
        duration: burst.duration,
      }),
    }),
  )
}

/**
 * Create a rate limiter backed by the injected Redis client, or by in-memory
 * counters when no client is configured.
 *
 * @public
 */
export const createRateLimiter = (options: CreateRateLimiterOptions): RateLimiter => {
  const { client = null, logger } = options

  const config = validateConfig(mergeConfig(BASE_RATE_LIMIT_DEFAULTS, options.overrides), logger)

  const limiter = buildLimiter(config, client, logger)

  return {
    check: async ({ key, logger: checkLogger }) => {
      const lgr = checkLogger ?? logger
      try {
        const res = await limiter.consume(key, 1)
        return toRateLimitInfo(res)
      } catch (error) {
        if (isRateLimiterRes(error)) {
          throw new RateLimitExceededError(toRateLimitInfo(error))
        }
        lgr.error({
          message: 'Unexpected rate limiter error',
          context: { prefix: config.prefix },
          error,
        })
        throw error
      }
    },
  }
}
