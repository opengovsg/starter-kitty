import type { Redis } from 'ioredis'

/**
 * An extra, short-lived allowance layered on top of the steady window to absorb
 * legitimate spikes — e.g. a page load firing several parallel API calls, or
 * many users behind a shared IP/NAT.
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
 * Configuration for a rate-limit window. All fields are optional; omitted
 * fields inherit from the limiter's defaults.
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
   * limiter's default burst; pass `null` to disable bursting entirely.
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
 * The subset of a structured logger this package needs: a single `warn` method
 * for non-fatal conditions the consumer should know about, e.g. running without
 * Redis or an unexpected store error. Any logger whose `warn` accepts
 * `{ message, context?, error? }` satisfies it — including the logger from
 * `@opengovsg/logging`, whose `warn` accepts a superset. The
 * package takes no logging dependency; this is a structural interface.
 *
 * The input mirrors a structured log call — `message`, optional structured
 * `context`, and an optional top-level `error` — so an unexpected store error
 * is passed as `error` (kept out of `context`) and reaches a logger's error
 * serializer intact.
 *
 * @public
 */
export interface Logger {
  warn(input: { message: string; context?: Record<string, unknown>; error?: unknown }): void
}

/**
 * The Redis client used to share rate-limit counters across instances.
 * This is an `ioredis` client; `ioredis` is an optional peer dependency.
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
   * the limiter falls back to in-memory counters — functional, but
   * per-instance: limits are not shared across replicas. The factory
   * {@link CreateRateLimiterOptions.logger | logger} is warned once per limiter
   * configuration when this happens.
   */
  client?: RedisClient | null
  /**
   * Default configuration merged under each check's options.
   */
  defaults?: RateLimitConfig
  /**
   * Logger receiving configuration warnings when no Redis client is
   * configured. Per-request warnings take a separate logger on each
   * {@link RateLimiter.check | check}. Optional.
   */
  logger?: Logger
}
