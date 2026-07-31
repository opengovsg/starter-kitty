import type { Redis } from 'ioredis'

/**
 * A short-lived allowance layered on top of the steady window to absorb
 * legitimate spikes, such as a page load firing several parallel API calls.
 *
 * @public
 */
export interface BurstConfig {
  /** Consumption points available per burst window. */
  points: number
  /** Burst window in seconds. */
  duration: number
}

/**
 * Configuration for a rate-limit window. Omitted fields inherit the
 * limiter's defaults.
 *
 * Numeric values are clamped to safe positive integers: non-finite or
 * below-1 values degrade to 1 and fractions are truncated, since the
 * Redis-backed limiter rejects non-integer arguments at runtime. Each clamp
 * is logged when the limiter is created.
 *
 * @public
 */
export interface RateLimitConfig {
  /** Consumption points available per steady window. Defaults to 50. */
  points?: number
  /** Steady window in seconds. Defaults to 10. */
  duration?: number
  /**
   * Burst window layered on top of the steady window. Omit to inherit the
   * limiter's default burst. Pass `null` to disable bursting entirely.
   * Defaults to `{ points: 20, duration: 30 }`.
   */
  burst?: BurstConfig | null
  /**
   * Namespace segment isolating this limiter's counters from other limiters
   * sharing the same store. Steady counters are stored under
   * `rate-limit:<prefix>:` and burst counters under `rate-limit-burst:<prefix>:`.
   * Defaults to `'api'`.
   */
  prefix?: string
}

export type RequiredRateLimitConfig = Required<RateLimitConfig>

/**
 * A snapshot of a key's rate-limit state after a check.
 *
 * @public
 */
export interface RateLimitInfo {
  /** Point usage in the current window. */
  points: {
    /** Points remaining in the current window. */
    remaining: number
    /** Points consumed in the current window, including this check. */
    consumed: number
  }
  /** Milliseconds until the current window resets. */
  msToNextWindow: number
  /** Whether this check opened a new window. */
  isFirstInWindow: boolean
}

/**
 * The subset of a structured logger this package needs: a single `warn`
 * method for non-fatal conditions such as running without Redis. Any logger
 * whose `warn` accepts `{ message, context?, error? }` satisfies it,
 * including the logger from `@opengovsg/logging`. The package takes no
 * logging dependency.
 *
 * An unexpected store error is passed as top-level `error`, not inside
 * `context`, so it reaches a logger's error serializer intact.
 *
 * @public
 */
export interface Logger {
  warn(input: { message: string; context?: Record<string, unknown>; error?: unknown }): void
}

/**
 * The `ioredis` client used to share rate-limit counters across instances.
 * `ioredis` is an optional peer dependency.
 *
 * @public
 */
export type RedisClient = Redis

/**
 * Options for creating a rate limiter.
 *
 * @public
 */
export interface CreateRateLimiterOptions {
  /**
   * The Redis client backing the limiter's counters. When absent or `null`,
   * the limiter falls back to in-memory counters, which are per-instance and
   * not shared across replicas. The factory logger is warned once at
   * creation when this happens.
   */
  client?: RedisClient | null
  /**
   * Configuration merged over the limiter's built-in defaults.
   */
  defaults?: RateLimitConfig
  /**
   * Logger receiving configuration warnings: no Redis client configured, or
   * a rate-limit value clamped to a safe integer. Per-request warnings take
   * a separate logger on each {@link RateLimiter.check | check}.
   */
  logger?: Logger
}
