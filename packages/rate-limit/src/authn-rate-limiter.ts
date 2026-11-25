import type { CreateBlockingRateLimiterOptions } from './blocking-rate-limiter.js'
import { createBlockingRateLimiter, mergeBlockingConfig } from './blocking-rate-limiter.js'
import { AUTHN_RATE_LIMIT_DEFAULTS } from './constants.js'
import { resolveIpBucket } from './ip-bucket.js'
import type { Logger } from './types.js'

/**
 * A failure-counting limiter keyed by client IP for authentication paths.
 * Obtain one via {@link createAuthnRateLimiter}.
 *
 * @public
 */
export interface AuthnRateLimiter {
  /**
   * Read the block state of `ip` before credential verification. Throws
   * {@link RateLimitExceededError} when it is blocked.
   *
   * IPs are keyed as in {@link GlobalRateLimiter.check}. An unparseable IP
   * falls into a shared `'unknown'` bucket and logs an error. `null`,
   * `undefined`, and non-string values are treated the same way.
   *
   * Pass a request-scoped `logger` to attach request identity to anything
   * this call logs. Omit it to fall back to the factory logger. The
   * fallback warning is the exception. The limiter logs it to the factory
   * logger whenever the in-memory fallback serves a call during a Redis
   * outage.
   */
  isBlocked(args: { ip: string | null | undefined; logger?: Logger }): Promise<void>
  /** Record one presented credential from `ip` that failed verification. */
  consume(args: { ip: string | null | undefined; logger?: Logger }): Promise<void>
}

/**
 * Options for creating an authentication failure limiter keyed by client IP.
 *
 * @public
 */
export interface CreateAuthnRateLimiterOptions extends CreateBlockingRateLimiterOptions {
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
 * Create a failure-counting authentication limiter keyed by client IP.
 *
 * Defaults to an allowance of 100 failed verifications per hour. The failure
 * that exceeds the allowance engages a one-hour block. Override via
 * {@link CreateBlockingRateLimiterOptions.overrides}. Pass
 * `skipKeyNormalization: true` to use each IP string verbatim as the store
 * key.
 *
 * Call `isBlocked` before verification and `consume` only when a presented
 * credential fails verification. Missing credentials and authorization
 * failures must not be consumed. This wrapper deliberately exposes no reset:
 * one successful credential must not erase failures accumulated by other
 * clients sharing an IP.
 *
 * @public
 */
export const createAuthnRateLimiter = (options: CreateAuthnRateLimiterOptions): AuthnRateLimiter => {
  const { skipKeyNormalization = false, ...blockingOptions } = options
  const limiter = createBlockingRateLimiter({
    ...blockingOptions,
    overrides: mergeBlockingConfig(AUTHN_RATE_LIMIT_DEFAULTS, blockingOptions.overrides),
  })

  const resolve = (ip: unknown, logger?: Logger) =>
    resolveIpBucket({
      ip,
      skipKeyNormalization,
      // Prefer the request-scoped logger so the extraction failure carries
      // request identity.
      logger: logger ?? blockingOptions.logger,
    })

  return {
    isBlocked: ({ ip, logger }) => limiter.isBlocked({ key: resolve(ip, logger), logger }),
    consume: ({ ip, logger }) => limiter.consume({ key: resolve(ip, logger), logger }),
  }
}
