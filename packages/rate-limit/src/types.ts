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
 * Fallback allowance for the in-memory limiter used as insurance during a
 * Redis outage, and as the sole limiter when no `client` is configured. Both
 * fields are required when overriding the factory's built-in fallback.
 *
 * @public
 */
export interface FallbackConfig {
  /** Consumption points available per fallback window. */
  points: number
  /** Fallback window in seconds. */
  duration: number
}

/**
 * Configuration for a rate-limit window. Omitted fields inherit the
 * limiter's defaults.
 *
 * @public
 */
export interface RateLimitConfig {
  /** Consumption points available per steady window. */
  points?: number
  /** Steady window in seconds. */
  duration?: number
  /**
   * Burst window layered on top of the steady window. Omit to inherit the
   * limiter's default burst. Pass `null` to disable bursting entirely.
   *
   * Disabled during a Redis outage, and when no client is configured.
   */
  burst?: BurstConfig | null
  /**
   * Fallback allowance for the in-memory limiter used as insurance during a
   * Redis outage, and as the sole limiter when no client is configured.
   */
  fallback?: FallbackConfig
  /**
   * Namespace segment isolating this limiter's counters from other limiters
   * sharing the same store.
   *
   * By default, steady counters are stored under
   * `rate-limit:<prefix>:` and burst counters under `rate-limit-burst:<prefix>:`.
   */
  prefix?: string
}

export type RequiredRateLimitConfig = Required<RateLimitConfig> & {
  fallback: Required<FallbackConfig>
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
 * The subset of a structured logger this package needs.
 *
 * Any logger whose `warn`/`error` accept `{ message, context?, error? }`
 * satisfies it, including the logger from `@opengovsg/logging`.
 *
 * @public
 */
export interface Logger {
  warn(input: { message: string; context?: Record<string, unknown>; error?: unknown }): void
  error(input: { message: string; context?: Record<string, unknown>; error?: unknown }): void
}

/**
 * The `ioredis` client used to share rate-limit counters across instances.
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
   * not shared across replicas.
   */
  client?: RedisClient | null
  /**
   * Configuration merged over the limiter's built-in defaults.
   *
   * Numeric values are clamped to safe positive integers: non-finite or
   * below-1 values degrade to 1 and fractions are truncated, since the
   * Redis-backed limiter rejects non-integer arguments at runtime.
   */
  overrides?: RateLimitConfig
  /**
   * Logger receiving configuration warnings and runtime
   * problems such as an unexpected store failure. Per-request logging
   * takes a separate logger on each {@link RateLimiter.check | check}.
   */
  logger: Logger
}
