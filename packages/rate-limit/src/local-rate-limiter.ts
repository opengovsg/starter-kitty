import { COLON_REPLACEMENT, LOCAL_RATE_LIMIT_DEFAULTS, VERTICAL_BAR } from './constants.js'
import { createRateLimiter } from './rate-limiter.js'
import { CreateRateLimiterOptions, Logger, RateLimitInfo } from './types.js'
import { mergeConfig } from './utilities.js'

/**
 * A rate limiter keyed by actor and resource, for identified traffic. Obtain
 * one via {@link createLocalRateLimiter}.
 *
 * @public
 */
export interface LocalRateLimiter {
  /**
   * Consume from the allowance of `actor` on `resource`.
   *
   * `resource` must be a controlled, safe, normalized route identity. Raw
   * URLs are not suitable, as they make every parameter value its own
   * bucket, which fragments the actor's quota and grows store key
   * cardinality without bound. `:` is replaced with `|-|` to avoid
   * colliding with the common `namespace:subkey` scheme, and `|` is
   * replaced with `||` to avoid colliding with that replacement.
   *
   * `actor` is caller-defined: a user ID, an API-key ID, or a client IP for
   * anonymous traffic.
   *
   * Pass a request-scoped `logger` to attach request identity to anything
   * this call logs. Omit it to fall back to the factory logger.
   *
   * Throws {@link RateLimitExceededError} when the allowance is exhausted.
   */
  check(args: { actor: string; resource: string; logger?: Logger }): Promise<RateLimitInfo>
}

/**
 * Options for creating a local rate limiter.
 *
 * @public
 */
export type CreateLocalRateLimiterOptions = CreateRateLimiterOptions

/**
 * Create a rate limiter enforcing per-actor, per-resource quotas for
 * identified traffic.
 *
 * Defaults to 50 points per 10 seconds with a burst of 20 per 30 seconds.
 * Override via {@link CreateRateLimiterOptions.overrides}.
 *
 * @public
 */
export const createLocalRateLimiter = (options: CreateLocalRateLimiterOptions): LocalRateLimiter => {
  const limiter = createRateLimiter({
    ...options,
    overrides: mergeConfig(LOCAL_RATE_LIMIT_DEFAULTS, options.overrides),
  })
  return {
    check: ({ actor, resource, logger }) =>
      limiter.check({
        key: `resource:${resource.replaceAll('|', VERTICAL_BAR).replaceAll(':', COLON_REPLACEMENT)}:actor:${actor}`,
        logger,
      }),
  }
}
