import type { RateLimitInfo } from './types.js'

/**
 * Thrown when a key has exhausted its rate-limit allowance.
 *
 * Carries everything needed to build an HTTP 429 response. See
 * {@link RateLimitExceededError.toHttpHeaders} for deriving a `Retry-After`
 * header value.
 *
 * @public
 */
export class RateLimitExceededError extends Error {
  /** Rate-limit state at the time of rejection. */
  readonly info: RateLimitInfo

  constructor(info: RateLimitInfo) {
    const retryAfterSeconds = Math.max(1, Math.ceil(info.msToNextWindow / 1000))
    super(`Rate limit exceeded. Try again in ${retryAfterSeconds}s.`)
    this.name = 'RateLimitExceededError'
    this.info = info
  }

  /** Derive the `Retry-After` HTTP 429 response header from this rejection. */
  toHttpHeaders() {
    return {
      'Retry-After': String(
        Math.max(1, Math.ceil(this.info.msToNextWindow / 1000)),
      ),
    }
  }
}
