/**
 * A framework-agnostic rate-limiting core built on
 * {@link https://github.com/animir/node-rate-limiter-flexible | rate-limiter-flexible}.
 *
 * Counters live in an injected Redis (`ioredis`) client so limits are shared
 * across replicas, with an in-memory fallback that keeps enforcement alive
 * through Redis outages or when no client is configured. A steady window can
 * be composed with a short burst allowance to absorb legitimate spikes.
 *
 * {@link createGlobalRateLimiter} guards pre-authentication traffic by client
 * IP. {@link createLocalRateLimiter} enforces per-actor, per-resource quotas
 * for identified traffic.
 *
 * {@link createRateLimiter} exposes the underlying core for anything else.
 *
 * @packageDocumentation
 */

export { RateLimitExceededError } from './errors.js'
export type { CreateGlobalRateLimiterOptions, GlobalRateLimiter } from './global-rate-limiter.js'
export { createGlobalRateLimiter } from './global-rate-limiter.js'
export type { CreateLocalRateLimiterOptions, LocalRateLimiter } from './local-rate-limiter.js'
export { createLocalRateLimiter } from './local-rate-limiter.js'
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
export { normalizeIp } from './utilities.js'
