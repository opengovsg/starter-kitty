/**
 * Roughly 5 requests per second, measured over a 10-second window to smooth
 * out spikes, plus a burst allowance for flurries like a page load firing
 * parallel API calls.
 */
export const BASE_RATE_LIMIT_DEFAULTS = {
  points: 50,
  duration: 10,
  burst: { points: 20, duration: 30 },
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
  prefix: 'global',
}

export const LOCAL_RATE_LIMIT_DEFAULTS = {
  ...BASE_RATE_LIMIT_DEFAULTS,
  prefix: 'local',
}

/**
 * The local limiter's fallback allowance (ADR 0010): tighter than the
 * package-wide 10 points/second default, since 5 points/second already
 * approximates this limiter's own steady default (50 points/10s).
 */
export const LOCAL_RATE_LIMIT_FALLBACK = { points: 5, duration: 1 }

/**
 * Key for a shared bucket for requests whose client IP is unparseable.
 */
export const UNKNOWN_BUCKET = 'unknown'
