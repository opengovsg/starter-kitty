import type { RateLimiterAbstract } from 'rate-limiter-flexible'
import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible'

import { BLOCKING_RATE_LIMIT_DEFAULTS } from './constants.js'
import { RateLimitExceededError } from './errors.js'
import { isRateLimiterRes, toRateLimitInfo } from './internal.js'
import { LoggedFallbackRateLimiter } from './logged-fallback-rate-limiter.js'
import type { Logger, RedisClient } from './types.js'
import { clamp } from './utilities.js'

const BLOCK_NAMESPACE = 'rate-limit-block:'

interface Config {
  points: number
  duration: number
  block: {
    duration: number
  }
  prefix: string
}

export const mergeBlockingConfig = (base: Config, override?: BlockingRateLimitConfig): Config => ({
  points: override?.points ?? base.points,
  duration: override?.duration ?? base.duration,
  block: {
    duration: override?.block?.duration ?? base.block.duration,
  },
  prefix: override?.prefix ?? base.prefix,
})

/**
 * Apply {@link clamp} to every numeric field, since `override` values in
 * {@link mergeBlockingConfig} come from caller input and aren't validated at
 * the type level. Each correction is surfaced rather than silently applied, so a
 * misconfigured allowance or block duration shows up in logs instead of only
 * as unexpected block behaviour.
 */
const validateConfig = (config: Config, logger: Logger): Config => {
  const validated: Config = {
    points: clamp(config.points),
    duration: clamp(config.duration),
    block: {
      duration: clamp(config.block.duration),
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
  if (validated.block.duration !== config.block.duration) {
    logger.warn({
      message: 'Rate limit block duration was clamped',
      context: {
        value: config.block.duration,
        clamped: validated.block.duration,
        prefix: config.prefix,
      },
    })
  }

  return validated
}

/**
 * Configuration for a failure-counting limiter. Omitted fields inherit the
 * limiter's defaults.
 *
 * @public
 */
export interface BlockingRateLimitConfig {
  /** Failures allowed per counting window. Defaults to 100. */
  points?: number
  /** Counting window in seconds. Defaults to 3600. */
  duration?: number
  /** How long a key stays blocked once it exceeds the allowance. */
  block?: {
    /** Time in seconds to block a key after it exceeds the allowance. Defaults to 3600. */
    duration?: number
  }
  /**
   * Namespace segment isolating this limiter's failure counters and block state
   * from other limiters sharing the same store. Keys are stored under
   * `rate-limit-block:<prefix>:`. Defaults to `'block'`.
   */
  prefix?: string
}

/**
 * Options for creating a failure-counting limiter.
 *
 * @public
 */
export interface CreateBlockingRateLimiterOptions {
  /**
   * The Redis client backing the limiter's failure counters and block state.
   * When absent or `null`, the limiter falls back to in-memory state, which
   * is per-instance and not shared across replicas.
   */
  client?: RedisClient | null
  /**
   * Configuration merged over the limiter's built-in defaults.
   *
   * Numeric values are clamped to safe positive integers: non-finite or
   * below-1 values degrade to 1 and fractions are truncated, since the
   * Redis-backed limiter rejects non-integer arguments at runtime.
   */
  overrides?: BlockingRateLimitConfig
  /**
   * Logger receiving configuration warnings and runtime problems such as an
   * unexpected store failure. Per-request logging takes a separate logger
   * on each call.
   *
   * It also receives the fallback warning, logged whenever the in-memory
   * fallback serves a call during a Redis outage, even if that call has its
   * own logger.
   */
  logger: Logger
}

/**
 * A failure-counting limiter placed around caller-owned verification logic.
 * Obtain one via {@link createBlockingRateLimiter}.
 *
 * @public
 */
export interface BlockingRateLimiter {
  /**
   * Read the current state without minting a key or consuming a point. Throws
   * {@link RateLimitExceededError} when `key` is blocked.
   *
   * Pass a request-scoped `logger` to attach request identity to anything
   * this call logs. Omit it to fall back to the factory logger. The
   * fallback warning is the exception. The limiter logs it to the factory
   * logger whenever the in-memory fallback serves a call during a Redis
   * outage.
   */
  isBlocked(args: { key: string; logger?: Logger }): Promise<void>
  /**
   * Record one failed verification. The failure that exceeds the allowance
   * engages the block and emits one warning, but this call resolves normally;
   * subsequent {@link BlockingRateLimiter.isBlocked | isBlocked} calls reject.
   */
  consume(args: { key: string; logger?: Logger }): Promise<void>
  /**
   * Delete the key's counter and any active block. When Redis is configured,
   * this clears both Redis and the in-memory fallback state, and rejects if
   * Redis could not be cleared so an incomplete reset is never reported as a
   * success.
   */
  reset(args: { key: string }): Promise<void>
}

/**
 * Create a failure-counting limiter backed by the injected Redis client with
 * a matching in-memory fallback, or by in-memory state alone when no client
 * is configured.
 *
 * Defaults to an allowance of 100 failures per hour, then a one-hour block.
 * Override via {@link CreateBlockingRateLimiterOptions.overrides}.
 *
 * Call {@link BlockingRateLimiter.isBlocked | isBlocked} before verification
 * and {@link BlockingRateLimiter.consume | consume} only after verification
 * fails. Use {@link BlockingRateLimiter.reset | reset} only when the key is
 * scoped to the authenticator that successfully verified; an IP-wide counter
 * must not be reset by one successful credential.
 *
 * @public
 */
export const createBlockingRateLimiter = (options: CreateBlockingRateLimiterOptions): BlockingRateLimiter => {
  const { client = null, logger } = options
  const config = validateConfig(mergeBlockingConfig(BLOCKING_RATE_LIMIT_DEFAULTS, options.overrides), logger)
  const { points, duration, block, prefix } = config

  let limiter: RateLimiterAbstract
  let resetKey: (key: string) => Promise<void>
  if (client) {
    const insuranceLimiter = new LoggedFallbackRateLimiter({
      points,
      duration,
      blockDuration: block.duration,
      logger,
      prefix,
    })
    const redisLimiter = new RateLimiterRedis({
      storeClient: client,
      rejectIfRedisNotReady: true,
      points,
      duration,
      blockDuration: block.duration,
      keyPrefix: `${BLOCK_NAMESPACE}${prefix}:`,
      insuranceLimiter,
    })
    limiter = redisLimiter
    resetKey = async key => {
      let redisError: unknown
      try {
        await client.del(redisLimiter.getKey(key))
      } catch (error) {
        redisError = error
      }
      // Always clear any outage-era state. Only a failed Redis delete counts
      // as a fallback invocation, so a healthy reset logs no fallback warning.
      if (redisError === undefined) {
        await insuranceLimiter.deleteSilently(key)
        return
      }
      // Reject after clearing memory so the caller knows to retry once the
      // store recovers.
      await insuranceLimiter.delete(key)
      throw redisError
    }
  } else {
    logger.error({
      message:
        'No Redis client configured, using in-memory failure counters and block state. Limits are per-instance and not shared across replicas.',
      context: { prefix, points, duration, block },
    })
    limiter = new RateLimiterMemory({
      points,
      duration,
      blockDuration: block.duration,
    })
    resetKey = async key => {
      await limiter.delete(key)
    }
  }

  return {
    isBlocked: async ({ key, logger: checkLogger }) => {
      const lgr = checkLogger ?? logger
      try {
        const res = await limiter.get(key)
        if (res !== null && res.consumedPoints > points) {
          throw new RateLimitExceededError(toRateLimitInfo(res))
        }
      } catch (error) {
        if (error instanceof RateLimitExceededError) throw error
        lgr.error({
          message: 'Unexpected rate limiter error',
          context: { prefix },
          error,
        })
        throw error
      }
    },
    consume: async ({ key, logger: consumeLogger }) => {
      const lgr = consumeLogger ?? logger
      try {
        await limiter.consume(key, 1)
      } catch (error) {
        if (isRateLimiterRes(error)) {
          const justBlocked = error.consumedPoints > points && error.consumedPoints <= points + 1
          if (justBlocked) {
            lgr.warn({
              message: 'Rate limit block engaged after failure allowance was exceeded',
              context: {
                prefix,
                bucket: key,
                consumed: error.consumedPoints,
                block,
              },
            })
          }
          return
        }
        lgr.error({
          message: 'Unexpected rate limiter error',
          context: { prefix },
          error,
        })
        throw error
      }
    },
    reset: async ({ key }) => {
      await resetKey(key)
    },
  }
}
