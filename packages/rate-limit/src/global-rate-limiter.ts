import { GLOBAL_RATE_LIMIT_DEFAULTS } from './constants.js'
import { resolveIpBucket } from './ip-bucket.js'
import { createRateLimiter } from './rate-limiter.js'
import type { CreateRateLimiterOptions, Logger, RateLimitInfo } from './types.js'
import { mergeConfig } from './utilities.js'

/**
 * A rate limiter keyed purely by client IP, for use before authentication.
 * Obtain one via {@link createGlobalRateLimiter}.
 *
 * @public
 */
export interface GlobalRateLimiter {
  /**
   * Consume from the allowance of `ip`.
   *
   * By default, IPv4 addresses are keyed per address and IPv6 addresses by
   * their /64 prefix, since a subscriber typically holds an entire /64 and
   * could otherwise mint a fresh bucket per request. IPv4-mapped IPv6
   * addresses are keyed by the embedded IPv4 address.
   *
   * An unparseable IP falls into a shared `'unknown'` bucket rather than
   * being exempted, and logs an error so a broken extractor shows up in
   * logs, not just as 429s. `null`, `undefined`, and non-string values from
   * JavaScript callers are treated the same way.
   *
   * Pass `skipKeyNormalization: true` to use every string verbatim instead.
   *
   * Pass a request-scoped `logger` to attach request identity to anything
   * this call logs. Omit it to fall back to the factory logger. The
   * fallback warning is the exception. The limiter logs it to the factory
   * logger whenever the in-memory fallback serves a check during a Redis
   * outage.
   *
   * Throws {@link RateLimitExceededError} when the allowance is exhausted.
   */
  check(args: { ip: string | null | undefined; logger?: Logger }): Promise<RateLimitInfo>
}

/**
 * Options for creating a global rate limiter.
 *
 * @public
 */
export interface CreateGlobalRateLimiterOptions extends CreateRateLimiterOptions {
  /**
   * Whether to skip normalizing IPs before using them as store keys.
   * Defaults to `false`.
   *
   * Set this to `true` only when the caller already supplies a trusted,
   * canonical key, which is then used verbatim with no /64 bucketing and no
   * `unknown` fallback for unparseable strings.
   */
  skipKeyNormalization?: boolean
}

/**
 * Create a pre-authentication rate limiter keyed purely by client IP.
 *
 * Mount this before authentication flows that rely on querying critical infrastructure.
 *
 * Defaults to 100 points per second with no burst. Override via
 * {@link CreateRateLimiterOptions.overrides}. Pass `skipKeyNormalization: true`
 * to use each IP string verbatim as the store key.
 *
 * @public
 */
export const createGlobalRateLimiter = (options: CreateGlobalRateLimiterOptions): GlobalRateLimiter => {
  const { skipKeyNormalization = false, ...rateLimiterOptions } = options
  const limiter = createRateLimiter({
    ...rateLimiterOptions,
    overrides: mergeConfig(GLOBAL_RATE_LIMIT_DEFAULTS, rateLimiterOptions.overrides),
  })
  return {
    check: ({ ip, logger }) =>
      limiter.check({
        key: resolveIpBucket({
          ip,
          skipKeyNormalization,
          // Prefer the request-scoped logger so the extraction failure carries
          // request identity.
          logger: logger ?? rateLimiterOptions.logger,
        }),
        logger,
      }),
  }
}
