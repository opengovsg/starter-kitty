import type { RateLimitExceededError } from './errors.js'

/**
 * Derive the standard `Retry-After` HTTP 429 response header from a
 * {@link RateLimitExceededError}.
 *
 * @public
 */
export const constructRateLimitHeaders = (error: RateLimitExceededError): { 'Retry-After': string } => ({
  'Retry-After': String(Math.max(1, Math.ceil(error.info.msToNextWindow / 1000))),
})
