/**
 * A framework-agnostic rate-limiting core built on
 * {@link https://github.com/animir/node-rate-limiter-flexible | rate-limiter-flexible},
 * extracted from the production patterns shared by several OGP applications.
 *
 * Counters live in an injected Redis (`ioredis`) client so limits are shared
 * across replicas, with an in-memory insurance limiter keeping enforcement
 * alive through Redis outages — and a memory-only fallback when no client is
 * configured at all. A steady fixed window can be composed with a short-lived
 * burst allowance to absorb legitimate spikes without loosening the sustained
 * rate.
 *
 * Two opinionated limiters cover the common deployment shape:
 * {@link createGlobalRateLimiter} (pre-authentication, keyed purely by client
 * IP, shielding the infrastructure that authentication itself hits) and
 * {@link createLocalRateLimiter} (per-actor, per-resource quotas for identified
 * traffic). {@link createRateLimiter} exposes the underlying core for
 * anything else.
 *
 * @packageDocumentation
 */

export { RateLimitExceededError } from './errors.js'
export { constructRateLimitHeaders } from './headers.js'
export type { CreateGlobalRateLimiterOptions, GlobalRateLimiter, LocalRateLimiter } from './limiters.js'
export { createGlobalRateLimiter, createLocalRateLimiter } from './limiters.js'
export type { RateLimiter } from './rate-limiter.js'
export { createRateLimiter } from './rate-limiter.js'
export type {
  BurstConfig,
  CreateRateLimiterOptions,
  Logger,
  RateLimitConfig,
  RateLimitInfo,
  RedisClient,
} from './types.js'
