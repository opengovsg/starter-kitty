/**
 * Roughly 5 requests per second, measured over a 10-second window to smooth
 * out spikes, plus a burst allowance for flurries like a page load firing
 * parallel API calls.
 */
export const BASE_RATE_LIMIT_DEFAULTS = {
  points: 50,
  duration: 10,
  burst: { points: 20, duration: 30 },
  fallback: { points: 10, duration: 1 },
  prefix: 'api',
}

/**
 * Coarse but cheap pre-authentication shielding, sized for the shared IPs a
 * per-IP key must absorb.
 */
export const GLOBAL_RATE_LIMIT_DEFAULTS = {
  points: 100,
  duration: 1,
  burst: null,
  fallback: { points: 10, duration: 1 },
  prefix: 'global',
}

export const LOCAL_RATE_LIMIT_DEFAULTS = {
  ...BASE_RATE_LIMIT_DEFAULTS,
  // Tighter than the package-wide 10 points/second fallback because 5
  // points/second already approximates the local limiter's steady default.
  fallback: { points: 5, duration: 1 },
  prefix: 'local',
}

/**
 * Key for a shared bucket for requests whose client IP is unparseable.
 */
export const UNKNOWN_BUCKET = 'unknown'
