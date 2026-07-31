import { LOCAL_RATE_LIMIT_DEFAULTS } from './constants.js'
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
   * `actor` is caller-defined: a user ID, an API-key ID, or a client IP for
   * anonymous traffic. Colons in either value are replaced with `-` so they cannot shift
   * the `actor:resource` key boundary.
   *
   * `resource` must be a normalized route identity, such as an Express route
   * template (`/users/:id`), never the raw request URL. Raw URLs make every
   * parameter value its own bucket, which fragments the actor's quota and
   * grows store key cardinality without bound.
   *
   * Pass a request-scoped `logger` to attach request identity to anything
   * this call logs. Omit it to fall back to the factory logger.
   *
   * Throws {@link RateLimitExceededError} when the allowance is exhausted.
   */
  check(args: {
    actor: string
    resource: string
    logger?: Logger
  }): Promise<RateLimitInfo>
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
 * Override via {@link CreateRateLimiterOptions.defaults}.
 *
 * @public
 */
export const createLocalRateLimiter = (
  options: CreateLocalRateLimiterOptions,
): LocalRateLimiter => {
  const limiter = createRateLimiter({
    ...options,
    defaults: mergeConfig(LOCAL_RATE_LIMIT_DEFAULTS, options.defaults),
  })
  return {
    check: ({ actor, resource, logger }) =>
      limiter.check({
        key: `${actor.replaceAll(':', '-')}:${resource.replaceAll(':', '-')}`,
        logger,
      }),
  }
}
