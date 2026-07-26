import { GLOBAL_RATE_LIMIT_DEFAULTS, UNKNOWN_BUCKET } from './constants.js'
import { createRateLimiter } from './rate-limiter.js'
import type { CreateRateLimiterOptions, Logger, RateLimitInfo } from './types.js'
import { mergeConfig, normalizeIp } from './utilities.js'

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
   * addresses are keyed by the embedded IPv4 address. Pass
   * `skipKeyNormalization: true` to use every string verbatim instead.
   *
   * An unparseable IP falls into a shared `'unknown'` bucket rather than
   * being exempted, and logs an error so a broken extractor shows up in
   * logs, not just as 429s. `null`, `undefined`, and non-string values from
   * JavaScript callers are treated the same way.
   *
   * Pass a request-scoped `logger` to attach request identity to anything
   * this call logs. Omit it to fall back to the factory logger.
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
    check: ({ ip, logger }) => {
      // Non-strings never reach normalizeIp or the verbatim path, so a broken
      // extractor cannot crash the limiter on either path.
      const key = typeof ip !== 'string' ? null : skipKeyNormalization ? ip : normalizeIp(ip)
      if (key === null) {
        const lgr = logger ?? rateLimiterOptions.logger
        lgr.error({
          message:
            typeof ip !== 'string'
              ? 'Client IP extraction did not return a string, using the shared unknown bucket'
              : 'Client IP is not a valid IPv4 or IPv6 address, using the shared unknown bucket',
          // Truncated because an unparseable value is attacker-controlled
          // input and must not flood logs.
          context: { ip: String(ip).slice(0, 64) },
        })
      }
      return limiter.check({
        key: key?.replaceAll(':', '-') ?? UNKNOWN_BUCKET,
        logger,
      })
    },
  }
}
