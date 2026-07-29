import type { RateLimiterAbstract, RateLimiterRes } from 'rate-limiter-flexible'
import { BurstyRateLimiter, RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible'

import { RateLimitExceededError } from './errors.js'
import type { BurstConfig, CreateRateLimiterOptions, Logger, RateLimitConfig, RateLimitInfo } from './types.js'

const STEADY_NAMESPACE = 'rate-limit:'
const BURST_NAMESPACE = 'rate-limit-burst:'

interface Config {
  points: number
  duration: number
  burst: BurstConfig | null
  prefix: string
}

/**
 * Production-tested defaults: 5 requests per second on average, measured over
 * a 10-second window to smooth out legitimate spikes, plus a burst allowance
 * for the occasional flurry (e.g. a page load firing parallel API calls).
 */
const BASE_DEFAULTS: Config = {
  points: 50,
  duration: 10,
  burst: { points: 20, duration: 30 },
  prefix: 'api',
}

/**
 * Merge a partial config over a fully-resolved base. `burst` is inherited only
 * when omitted. An explicit `null` disables bursting.
 */
export const mergeConfig = (base: Config, override?: RateLimitConfig): Config => ({
  points: override?.points ?? base.points,
  duration: override?.duration ?? base.duration,
  burst: override?.burst !== undefined ? override.burst : base.burst,
  prefix: override?.prefix ?? base.prefix,
})

/**
 * Clamp a points/duration value to a safe positive integer. Negative, zero,
 * `NaN`, and `Infinity` all degrade to 1 rather than reaching the underlying
 * limiter, where a negative would replenish the allowance and a non-finite
 * would corrupt the counter. Fractional values are truncated toward zero
 * because the Redis-backed limiter's `INCRBY`/`EXPIRE` calls reject
 * non-integer arguments at runtime.
 */
const clamp = (value: number): number => {
  return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : 1
}

/**
 * Apply {@link clamp} to every numeric field, since `override` values in
 * {@link mergeConfig} come from caller input and aren't validated at the type
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
 * Duck-typed check for a limit rejection. `instanceof RateLimiterRes` is
 * unreliable when a dual CJS/ESM dependency is loaded twice, so match on
 * shape instead.
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
   * Consume `points` (default 1) from `key`'s allowance. `points` and the
   * numeric fields in `options` are clamped to safe positive integers, and
   * each clamp is logged with the original and clamped values. See
   * {@link RateLimitConfig} for the clamping rules.
   *
   * Resolves with a {@link RateLimitInfo} snapshot when the request is within
   * limits. Throws {@link RateLimitExceededError} when the allowance is
   * exhausted. Any other error (e.g. a store failure that escapes the
   * in-memory insurance limiter) is reported to `logger` (falling back to the
   * factory logger) and rethrown as-is, so the caller decides between failing
   * open and failing closed.
   *
   * Pass a request-scoped `logger` to attach request identity (path, user,
   * client IP) to the request warnings this call may emit. Omit it to fall back
   * to the factory {@link CreateRateLimiterOptions.logger}.
   */
  check(args: { key: string; options?: RateLimitConfig; points?: number; logger?: Logger }): Promise<RateLimitInfo>
}

/**
 * Create a rate limiter backed by the injected Redis client, falling back to
 * per-instance in-memory counters when no client is configured.
 *
 * Underlying limiter instances are memoized per distinct configuration, so a
 * single factory can serve many differently-configured checks cheaply.
 *
 * @public
 */
export const createRateLimiter = (options: CreateRateLimiterOptions = {}): RateLimiter => {
  const { client = null, logger } = options
  const defaults = mergeConfig(BASE_DEFAULTS, options.defaults)
  const cache = new Map<string, RateLimiterAbstract | BurstyRateLimiter>()

  const buildLimiter = (resolved: Config): RateLimiterAbstract | BurstyRateLimiter => {
    const { points, duration, burst } = resolved
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
        context: { prefix: resolved.prefix },
      })
      return burstMemoryLimiter ? new BurstyRateLimiter(steadyMemoryLimiter, burstMemoryLimiter) : steadyMemoryLimiter
    }

    const steady = new RateLimiterRedis({
      storeClient: client,
      rejectIfRedisNotReady: true,
      points,
      duration,
      keyPrefix: `${STEADY_NAMESPACE}${resolved.prefix}:`,
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
        keyPrefix: `${BURST_NAMESPACE}${resolved.prefix}:`,
        insuranceLimiter: burstMemoryLimiter,
      }),
    )
  }

  const getLimiter = (config: Config): RateLimiterAbstract | BurstyRateLimiter => {
    // Resolve the config to its validated values to check if it has been memoized already.
    const resolved = validateConfig(config)
    const cacheKey = `${resolved.prefix}:${resolved.points}:${resolved.duration}:${resolved.burst?.points ?? '-'}:${
      resolved.burst?.duration ?? '-'
    }`
    const cached = cache.get(cacheKey)
    if (cached) return cached
    // If there is no memoized limiter, build a new one.
    // While building a new limiter, validate the config and log any fields that are invalid.
    const limiter = buildLimiter(validateConfig(config, logger))
    cache.set(cacheKey, limiter)
    return limiter
  }

  return {
    check: async ({ key, options, points = 1, logger: checkLogger }) => {
      const config = mergeConfig(defaults, options)
      const limiter = getLimiter(config)
      // Request warnings prefer the per-call logger (request-scoped) and fall
      // back to the factory logger.
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
