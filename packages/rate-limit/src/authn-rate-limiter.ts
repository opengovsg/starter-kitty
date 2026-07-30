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
   * Read the IP bucket's block state before credential verification. Throws
   * {@link RateLimitExceededError} when the bucket is blocked.
   */
  isBlocked(args: { ip: string | null; logger?: Logger }): Promise<void>
  /** Record one presented credential that failed verification. */
  consume(args: { ip: string | null; logger?: Logger }): Promise<void>
}

/**
 * Options for creating an authentication failure limiter keyed by client IP.
 *
 * @public
 */
export interface CreateAuthnRateLimiterOptions extends CreateBlockingRateLimiterOptions {
  /**
   * Whether to validate and normalize non-null IP addresses before using them
   * as store keys. Defaults to `true`. Set this to `false` only for trusted,
   * canonical keys; `null` still uses the shared `unknown` bucket.
   */
  validate?: boolean
}

/**
 * Create a failure-counting authentication limiter keyed by client IP.
 *
 * Defaults to an allowance of 100 failed verifications per hour. The failure
 * that exceeds the allowance engages a one-hour block. Call `isBlocked`
 * before verification and `consume` only when a presented credential fails
 * verification. Missing credentials and authorization failures must not be
 * consumed. This wrapper deliberately exposes no reset: one successful
 * credential must not erase failures accumulated by other clients sharing an
 * IP.
 *
 * @public
 */
export const createAuthnRateLimiter = (options: CreateAuthnRateLimiterOptions = {}): AuthnRateLimiter => {
  const { validate = true, ...blockingOptions } = options
  const limiter = createBlockingRateLimiter({
    ...blockingOptions,
    defaults: mergeBlockingConfig(AUTHN_RATE_LIMIT_DEFAULTS, blockingOptions.defaults),
  })

  const resolve = (ip: string | null, logger?: Logger) =>
    resolveIpBucket({
      ip,
      validate,
      logger,
      factoryLogger: blockingOptions.logger,
    })

  return {
    isBlocked: ({ ip, logger }) => limiter.isBlocked({ key: resolve(ip, logger), logger }),
    consume: ({ ip, logger }) => limiter.consume({ key: resolve(ip, logger), logger }),
  }
}
