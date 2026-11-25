import type { RateLimiterRes } from 'rate-limiter-flexible'

import type { RateLimitInfo } from './types.js'

export const toRateLimitInfo = (res: RateLimiterRes): RateLimitInfo => ({
  points: {
    remaining: res.remainingPoints,
    consumed: res.consumedPoints,
  },
  msToNextWindow: res.msBeforeNext,
  isFirstInWindow: res.isFirstInDuration,
})

/**
 * Match a limit rejection by shape, since `instanceof RateLimiterRes` is
 * unreliable when a dual CJS/ESM dependency is loaded twice.
 */
export const isRateLimiterRes = (value: unknown): value is RateLimiterRes => {
  if (typeof value !== 'object' || value === null) return false
  const res = value as Partial<RateLimiterRes>
  return typeof res.remainingPoints === 'number' && typeof res.msBeforeNext === 'number'
}
