---
'@opengovsg/rate-limit': minor
---

The in-memory limiter used as insurance during a Redis outage, and as the sole limiter when no `client` is configured, now enforces a fixed fallback allowance (10 points/second, 5 for `createLocalRateLimiter`) instead of the primary `points`/`duration`, and grants nothing extra from burst while running off memory. A new `fallback` option overrides the default. See [ADR 0010](https://github.com/opengovsg/starter-kitty/blob/develop/docs/adr/0010-clamp-insurance-limiter-fallback.md) for the rationale.

Conditions that mean enforcement itself is degraded, no Redis client configured (the memory-only path) and an unexpected error escaping the in-memory insurance limiter, are now reported to `error` instead of `warn`, so they can be alerted on distinctly from routine configuration warnings (e.g. a clamped rate-limit value, which still goes to `warn`).

Breaking for existing callers: the `Logger` interface now requires an `error` method alongside `warn`, so any custom logger passed as `logger` must implement both.
