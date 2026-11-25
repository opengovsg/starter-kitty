---
'@opengovsg/rate-limit': patch
---

feat(rate-limit): log every insurance-limiter invocation

The in-memory fallback limiter now logs a warn line, `"Fallback rate limiter triggered"`, on every call when it acts as insurance behind a Redis-backed window. Those calls only happen during a Redis outage, so you can alert on them.

When no `client` is configured, the fallback is the sole limiter and runs on every request in normal operation, for example in local development or tests without Redis. It keeps the single `logger.error` at creation and does not log per call. See [ADR 0012](https://github.com/opengovsg/starter-kitty/blob/develop/docs/adr/0012-log-fallback-limiter-invocations.md) for the rationale.
