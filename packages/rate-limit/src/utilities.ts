import ipaddr from 'ipaddr.js'

import { COLON_REPLACEMENT } from './constants.js'
import {
  FallbackConfig,
  RateLimitConfig,
  RequiredRateLimitConfig,
} from './types.js'

/**
 * Derive the store key for a client IP, or `null` when the input is not a
 * valid IP address so the caller can warn and fall back to the shared bucket.
 *
 * IPv4 addresses, including IPv4-mapped IPv6 addresses, are keyed per
 * address. IPv6 addresses are keyed by their /64 prefix, since a subscriber
 * typically holds an entire /64 and could otherwise mint a fresh bucket per
 * request by rotating within it.
 *
 * Output keys have their colons replaced with `|-|` to avoid colliding with
 * the common `namespace:subkey` Redis convention.
 *
 * @public
 */
export const normalizeIp = (ip: string): string | null => {
  if (!ipaddr.IPv4.isValidFourPartDecimal(ip) && !ipaddr.IPv6.isValid(ip))
    return null

  // `process` normalizes every spelling of an IPv4-mapped IPv6 address to
  // IPv4 so all representations of the client share one bucket.
  const address = ipaddr.process(ip)
  if (address instanceof ipaddr.IPv4) {
    return address.toString().replaceAll(':', COLON_REPLACEMENT)
  }

  // The first four 16-bit groups form the /64 key. Parsed groups make
  // compressed, expanded, and zone-bearing spellings equivalent. Dashes keep
  // colons out of the common `namespace:subkey` Redis convention.
  return address.parts
    .slice(0, 4)
    .map(group => group.toString(16))
    .join(COLON_REPLACEMENT)
}

/**
 * Clamp to a safe positive integer. Non-finite and below-1 values degrade to
 * 1, where a negative would otherwise replenish the allowance. Fractions are
 * truncated because the Redis-backed limiter rejects non-integer arguments
 * at runtime.
 */
export const clamp = (value: number): number => {
  return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : 1
}

/**
 * Merge a partial config over a resolved base. Omitted `burst`
 * values inherit the base's. An explicit `null` disables bursting.
 */
export const mergeConfig = (
  base: RequiredRateLimitConfig,
  override?: RateLimitConfig,
): RequiredRateLimitConfig => ({
  points: override?.points ?? base.points,
  duration: override?.duration ?? base.duration,
  burst: override?.burst !== undefined ? override.burst : base.burst,
  prefix: override?.prefix ?? base.prefix,
})

/**
 * Merge a partial fallback config over a fully-resolved base fallback.
 */
export const mergeFallback = (
  base: Required<FallbackConfig>,
  override?: FallbackConfig,
): Required<FallbackConfig> => ({
  points: override?.points ?? base.points,
  duration: override?.duration ?? base.duration,
})
