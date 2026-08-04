---
'@opengovsg/rate-limit': minor
---

Initial release: a framework-agnostic rate-limiting core built on rate-limiter-flexible.

- `createGlobalRateLimiter`: pre-authentication limiter keyed purely by client IP, shielding the infrastructure that authentication itself hits.
- `createLocalRateLimiter`: per-actor, per-resource quotas for identified traffic.
- `createRateLimiter`: the underlying core, an injected ioredis client with in-memory insurance/fallback and a steady window composed with an optional burst allowance.
- `RateLimitExceededError`, with a `toHttpHeaders()` method for the `Retry-After` header.
