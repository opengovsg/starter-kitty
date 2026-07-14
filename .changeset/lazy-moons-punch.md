---
'@opengovsg/starter-kitty-rate-limit': minor
---

Initial release: a framework-agnostic rate-limiting core built on rate-limiter-flexible, extracted from the production patterns shared by several OGP applications.

- `createGlobalRateLimiter`: pre-authentication limiter keyed purely by client IP, shielding the infrastructure that authentication itself hits.
- `createLocalRateLimiter`: per-actor, per-resource quotas for identified traffic.
- `createRateLimiter`: the underlying core — injected ioredis client with in-memory insurance/fallback, steady window composed with an optional burst allowance, per-configuration memoization.
- `RateLimitExceededError` and `constructRateLimitHeaders` (Retry-After) helpers.
- A structural `Logger` interface (`warn({ message, context?, error? })`): a factory `logger` receives configuration warnings, and an optional per-`check` `logger` receives request warnings, falling back to the factory logger when omitted.
