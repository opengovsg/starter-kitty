import ipaddr from 'ipaddr.js'

import { createRateLimiter, mergeConfig } from './rate-limiter.js'
import type { CreateRateLimiterOptions, Logger, RateLimitConfig, RateLimitInfo } from './types.js'

/**
 * Pre-authentication guard values: coarse but cheap shielding, keyed purely by
 * client IP, mounted before credential checks that hit critical infrastructure
 * (session lookups, API-key lookups, OTP tables).
 */
const GLOBAL_DEFAULTS = {
  points: 100,
  duration: 1,
  burst: null,
  prefix: 'global',
}

const LOCAL_DEFAULTS = {
  points: 50,
  duration: 10,
  burst: { points: 20, duration: 30 },
  prefix: 'local',
}

/**
 * The bucket shared by every request whose client IP is missing or
 * unparseable. Unidentifiable traffic is never exempted, and never allowed to
 * mint fresh buckets from attacker-controlled input.
 */
const UNKNOWN_BUCKET = 'unknown'

/**
 * Derive the store key for a client IP, or `null` when the input is not a
 * valid IP address so the caller can warn and fall back to the shared bucket.
 */
const resolveIpKey = (ip: string): string | null => {
  if (!ipaddr.IPv4.isValidFourPartDecimal(ip) && !ipaddr.IPv6.isValid(ip)) return null

  // IPv4-mapped IPv6 addresses are IPv4 traffic arriving on a dual-stack
  // socket. `process` normalizes both their dotted and hexadecimal spellings
  // to IPv4 so every representation of the client shares one bucket.
  const address = ipaddr.process(ip)
  if (address instanceof ipaddr.IPv4) return address.toString()

  // Use the first four 16-bit groups as the IPv6 /64 key. Working from parsed
  // groups makes compressed, expanded, embedded-IPv4, and zone-bearing
  // spellings equivalent. Colons are avoided for compatibility with the
  // common `namespace:subkey` Redis convention.
  return address.parts
    .slice(0, 4)
    .map(group => group.toString(16))
    .join('-')
}

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
   * With the default validation enabled, IPv4 addresses are keyed per address;
   * IPv6 addresses are bucketed by their /64 prefix, because a subscriber
   * typically holds an entire /64 and per-address keying would let an attacker
   * mint a fresh bucket per request by rotating within their prefix.
   * IPv4-mapped IPv6 addresses (`::ffff:a.b.c.d`) are keyed by the embedded
   * IPv4 address. With validation disabled, every non-null string is used
   * verbatim instead.
   *
   * A `null` IP, or an unparseable IP when validation is enabled, falls into a
   * shared `'unknown'` bucket rather than being exempted, and emits a request
   * warning so a broken extractor shows up in logs, not just as 429s.
   *
   * Pass a request-scoped `logger` to attach request identity to any request
   * warnings this call emits; omit it to fall back to the factory logger.
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
   * Whether to validate and normalize non-null IP addresses before using them
   * as store keys. Defaults to `true`.
   *
   * Set this to `false` only when the caller already supplies a trusted,
   * canonical key. The value is then used verbatim: IPv6 addresses are not
   * bucketed by /64, IPv4-mapped IPv6 addresses are not converted to IPv4,
   * and unparseable strings do not fall into the shared `unknown` bucket. A
   * `null` IP still uses the `unknown` bucket and emits a warning.
   */
  validate?: boolean
}

/**
 * Create a pre-authentication rate limiter keyed purely by client IP.
 *
 * Mount this before authentication: credential checks usually hit critical
 * infrastructure (a database, an OTP table), and a per-user limiter cannot
 * protect that infrastructure because unauthenticated traffic has no user yet.
 *
 * Defaults to 100 points per second with no burst; override via
 * {@link CreateRateLimiterOptions.defaults}. IP validation and normalization
 * are enabled by default; pass `validate: false` to use each non-null IP
 * string verbatim as the store key.
 *
 * @public
 */
export const createGlobalRateLimiter = (options: CreateGlobalRateLimiterOptions = {}): GlobalRateLimiter => {
  const { validate = true, ...rateLimiterOptions } = options
  const limiter = createRateLimiter({
    ...rateLimiterOptions,
    defaults: mergeConfig(GLOBAL_DEFAULTS, rateLimiterOptions.defaults),
  })
  return {
    check: ({ ip, points, logger }) => {
      const key = ip === null ? null : validate ? resolveIpKey(ip) : ip
      if (key === null) {
        // Request warning: prefer the per-check (request-scoped) logger so the
        // extraction failure carries request identity, like other request
        // warnings.
        const warnLogger = logger ?? rateLimiterOptions.logger
        warnLogger?.warn(
          ip === null
            ? { message: 'Client IP extraction returned null; using the shared unknown bucket' }
            : {
                message: 'Client IP is not a valid IPv4 or IPv6 address; using the shared unknown bucket',
                // Truncated: an unparseable value is attacker-controlled input
                // and must not flood logs at request rate.
                context: { ip: ip.slice(0, 64) },
              },
        )
      }
      return limiter.check({ key: key ?? UNKNOWN_BUCKET, points, logger })
    },
  }
}

/**
 * A rate limiter keyed by actor and resource, for identified traffic. Obtain
 * one via {@link createLocalRateLimiter}.
 *
 * @public
 */
export interface LocalRateLimiter {
  /**
   * Consume `points` (default 1) from the allowance of `actor` on `resource`.
   *
   * `actor` is caller-defined: a user ID, an API-key ID, a hash of a bearer
   * token (hash secrets yourself so they never become store keys), or a
   * client IP for anonymous traffic. Avoid `:` in actors — the store key is
   * `actor:resource`, so a colon shifts the boundary between the two.
   *
   * `resource` must be a normalized route identity — an Express route
   * template (`/users/:id`), a tRPC procedure name — never the raw request
   * URL. Keying on raw URLs makes every parameter value its own bucket,
   * which fragments the actor's quota (defeating the limit), grows store key
   * cardinality without bound, and breaks per-route overrides. Each actor
   * gets an independent allowance per resource.
   *
   * Pass a request-scoped `logger` to attach request identity to any request
   * warnings this call emits; omit it to fall back to the factory logger.
   *
   * Throws {@link RateLimitExceededError} when the allowance is exhausted.
   */
  check(args: {
    actor: string
    resource: string
    options?: RateLimitConfig
    points?: number
    logger?: Logger
  }): Promise<RateLimitInfo>
}

/**
 * Create a rate limiter enforcing per-actor, per-resource quotas for
 * identified traffic — the fair-use complement to
 * {@link createGlobalRateLimiter}.
 *
 * Defaults to 50 points per 10 seconds with a burst allowance of 20 per 30
 * seconds; override via {@link CreateRateLimiterOptions.defaults} or per
 * check.
 *
 * @public
 */
export const createLocalRateLimiter = (options: CreateRateLimiterOptions = {}): LocalRateLimiter => {
  const limiter = createRateLimiter({
    ...options,
    defaults: mergeConfig(LOCAL_DEFAULTS, options.defaults),
  })
  return {
    check: ({ actor, resource, options: checkOptions, points, logger }) =>
      limiter.check({
        key: `${actor}:${resource}`,
        options: checkOptions,
        points,
        logger,
      }),
  }
}
