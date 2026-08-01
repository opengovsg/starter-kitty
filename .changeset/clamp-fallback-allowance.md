---
'@opengovsg/rate-limit': minor
---

The in-memory limiter used as insurance during a Redis outage, and as the sole limiter when no `client` is configured, now enforces a fixed fallback allowance (10 points/second, 5 for `createLocalRateLimiter`) instead of the primary `points`/`duration`, and grants nothing extra from burst while running off memory.

A new `overrides.fallback` setting overrides the default. See [ADR 0010](https://github.com/opengovsg/starter-kitty/blob/develop/docs/adr/0010-clamp-insurance-limiter-fallback.md) for the rationale.

Creating a limiter with no Redis client is now reported to `logger.error` instead of `logger.warn`, since enforcement in that mode is degraded. This makes it alertable distinctly from routine configuration warnings such as a clamped rate-limit value, which still go to `warn`.
