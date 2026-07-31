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
   * Consume `points` (default 1) from the allowance of `ip`.
   *
   * With validation enabled, IPv4 addresses are keyed per address and IPv6
   * addresses by their /64 prefix, since a subscriber typically holds an
   * entire /64 and could otherwise mint a fresh bucket per request.
   * IPv4-mapped IPv6 addresses are keyed by the embedded IPv4 address. With
   * validation disabled, every non-null string is used verbatim.
   *
   * A `null` or unparseable IP falls into a shared `'unknown'` bucket rather
   * than being exempted, and emits a warning so a broken extractor shows up
   * in logs, not just as 429s.
   *
   * Pass a request-scoped `logger` to attach request identity to any
   * warnings this call emits. Omit it to fall back to the factory logger.
   *
   * Throws {@link RateLimitExceededError} when the allowance is exhausted.
   */
  check(args: { ip: string | null; points?: number; logger?: Logger }): Promise<RateLimitInfo>
}

/**
 * Options for creating a global rate limiter.
 *
 * @public
 */
export interface CreateGlobalRateLimiterOptions extends CreateRateLimiterOptions {
  /**
   * Whether to validate and normalize non-null IPs before using them as
   * store keys. Defaults to `true`.
   *
   * Set this to `false` only when the caller already supplies a trusted,
   * canonical key, which is then used verbatim with no /64 bucketing and no
   * `unknown` fallback for unparseable strings. A `null` IP still uses the
   * `unknown` bucket and emits a warning.
   */
  validate?: boolean
}

/**
 * Create a pre-authentication rate limiter keyed purely by client IP.
 *
 * Mount this before authentication. Credential checks hit critical
 * infrastructure such as a database, and a per-user limiter cannot protect
 * it because unauthenticated traffic has no user yet.
 *
 * Defaults to 100 points per second with no burst. Override via
 * {@link CreateRateLimiterOptions.defaults}. Pass `validate: false` to use
 * each non-null IP string verbatim as the store key.
 *
 * @public
 */
export const createGlobalRateLimiter = (options: CreateGlobalRateLimiterOptions = {}): GlobalRateLimiter => {
  const { validate = true, ...rateLimiterOptions } = options
  const limiter = createRateLimiter({
    ...rateLimiterOptions,
    defaults: mergeConfig(GLOBAL_RATE_LIMIT_DEFAULTS, rateLimiterOptions.defaults),
  })
  return {
    check: ({ ip, points, logger }) => {
      const key = ip === null ? null : validate ? normalizeIp(ip) : ip
      if (key === null) {
        // Prefer the request-scoped logger so the extraction failure carries
        // request identity.
        const warnLogger = logger ?? rateLimiterOptions.logger
        warnLogger?.warn(
          ip === null
            ? {
                message: 'Client IP extraction returned null, using the shared unknown bucket',
              }
            : {
                message: 'Client IP is not a valid IPv4 or IPv6 address, using the shared unknown bucket',
                // Truncated because an unparseable value is attacker-controlled
                // input and must not flood logs.
                context: { ip: ip.slice(0, 64) },
              },
        )
      }
      return limiter.check({
        key: key?.replaceAll(':', '-') ?? UNKNOWN_BUCKET,
        points,
        logger,
      })
    },
  }
}
