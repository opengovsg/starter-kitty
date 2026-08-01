import type { RateLimiterAbstract } from 'rate-limiter-flexible'
import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible'

import { RateLimitExceededError } from './errors.js'
import { isRateLimiterRes, toRateLimitInfo } from './internal.js'
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

const BASE_DEFAULTS: Config = {
  points: 100,
  duration: 3600,
  block: {
    duration: 3600,
  },
  prefix: 'block',
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
const validateConfig = (config: Config, logger?: Logger): Config => {
  const validated: Config = {
    points: clamp(config.points),
    duration: clamp(config.duration),
    block: {
      duration: clamp(config.block.duration),
    },
    prefix: config.prefix,
  }

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
  if (validated.block.duration !== config.block.duration) {
    logger?.warn({
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
 * Configuration for a failure-counting limiter. All fields are optional;
 * omitted fields inherit from the factory's defaults.
 *
 * Numeric values are clamped to safe positive integers. Non-finite or below-1
 * values degrade to 1, and fractional values are truncated toward zero, since
 * the Redis-backed limiter rejects non-integer arguments at runtime. Each
 * clamp is logged to the factory logger.
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
  /** Redis client used to share failure counters and block state across instances. */
  client?: RedisClient | null
  /** Default allowance, counting window, block duration, and namespace. */
  defaults?: BlockingRateLimitConfig
  /**
   * Factory logger for configuration and request warnings: `warn` when a
   * configuration value is clamped to a safe integer, `error` once when no
   * Redis client is configured. Request diagnostics prefer the logger passed
   * to the individual call and fall back to this one.
   */
  logger?: Logger
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
   * this clears both Redis and the in-memory insurance state, and rejects if
   * Redis could not be cleared so an incomplete reset is never reported as a
   * success.
   */
  reset(args: { key: string }): Promise<void>
}

/**
 * Create a failure-counting limiter backed by Redis with a matching in-memory
 * insurance limiter, or by per-instance memory when no client is configured.
 *
 * Call {@link BlockingRateLimiter.isBlocked | isBlocked} before verification
 * and {@link BlockingRateLimiter.consume | consume} only after verification
 * fails. Use {@link BlockingRateLimiter.reset | reset} only when the key is
 * scoped to the authenticator that successfully verified; an IP-wide counter
 * must not be reset by one successful credential.
 *
 * @public
 */
export const createBlockingRateLimiter = (options: CreateBlockingRateLimiterOptions = {}): BlockingRateLimiter => {
  const { client = null, logger } = options
  const config = validateConfig(mergeBlockingConfig(BASE_DEFAULTS, options.defaults), logger)
  const { points, duration, block, prefix } = config

  let limiter: RateLimiterAbstract
  let resetKey: (key: string) => Promise<void>
  if (client) {
    const insuranceLimiter = new RateLimiterMemory({
      points,
      duration,
      blockDuration: block.duration,
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
      // Always clear any outage-era state. If Redis failed above, reject after
      // clearing memory so the caller knows to retry once the store recovers.
      await insuranceLimiter.delete(key)
      if (redisError !== undefined) throw redisError
    }
  } else {
    logger?.error({
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
        lgr?.error({
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
            lgr?.warn({
              message: 'Rate limit block engaged after failure allowance was exceeded',
              context: {
                bucket: key,
                consumed: error.consumedPoints,
                block,
              },
            })
          }
          return
        }
        lgr?.error({
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
