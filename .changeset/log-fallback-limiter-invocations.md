---
'@opengovsg/rate-limit': patch
---

fix(rate-limit): log every insurance-limiter invocation

The in-memory fallback limiter now logs a warn line, `"Fallback rate limiter triggered"`, on every call when it is acting as insurance behind a Redis-backed window, since those calls only happen during a Redis outage and are a signal worth alerting on.

When no `client` is configured and the fallback is the sole limiter, it keeps the existing single `logger.error` at creation instead of logging per call, since that limiter is used on every request in normal operation, for example in local development or tests without Redis. See [ADR 0011](https://github.com/opengovsg/starter-kitty/blob/develop/docs/adr/0011-log-fallback-limiter-invocations.md) for the rationale.
