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
  points: 50,
  duration: 10,
  burst: { points: 20, duration: 30 },
  prefix: 'local',
}

/**
 * Shared bucket for requests whose client IP is missing or unparseable.
 * Unidentifiable traffic is limited, never exempted, and cannot mint fresh
 * buckets from attacker-controlled input.
 */
export const UNKNOWN_BUCKET = 'unknown'
