---
'@opengovsg/starter-kitty-rate-limit': minor
---

The in-memory limiter used as insurance during a Redis outage, and as the sole limiter when no `client` is configured, now enforces a fixed fallback allowance (10 points/second, 5 for `createLocalRateLimiter`) instead of the primary `points`/`duration`, and grants nothing extra from burst while running off memory. A new `fallback` option overrides the default. See [ADR 0010](https://github.com/opengovsg/starter-kitty/blob/develop/docs/adr/0010-clamp-insurance-limiter-fallback.md) for the rationale.
