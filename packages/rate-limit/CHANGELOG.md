# @opengovsg/rate-limit

## 0.1.1

### Patch Changes

- [#106](https://github.com/opengovsg/starter-kitty/pull/106) [`db5d177`](https://github.com/opengovsg/starter-kitty/commit/db5d177d37c7000abb72090719e29807e80991ad) Thanks [@dextertanyj](https://github.com/dextertanyj)! - feat(rate-limit): log every insurance-limiter invocation

  The in-memory fallback limiter now logs a warn line, `"Fallback rate limiter triggered"`, on every call when it acts as insurance behind a Redis-backed window. Those calls only happen during a Redis outage, so you can alert on them.

  When no `client` is configured, the fallback is the sole limiter and runs on every request in normal operation, for example in local development or tests without Redis. It keeps the single `logger.error` at creation and does not log per call. See [ADR 0012](https://github.com/opengovsg/starter-kitty/blob/develop/docs/adr/0012-log-fallback-limiter-invocations.md) for the rationale.

## 0.1.0

### Minor Changes

- [#98](https://github.com/opengovsg/starter-kitty/pull/98) [`33d6390`](https://github.com/opengovsg/starter-kitty/commit/33d6390ffca8d84cb6ded756883dba5065378736) Thanks [@dextertanyj](https://github.com/dextertanyj)! - feat(rate-limit): allow custom rate limiter fallback values

  The in-memory limiter used as insurance during a Redis outage, and as the sole limiter when no `client` is configured, now enforces a fixed fallback allowance (5 points/second, 10 for `createGlobalRateLimiter`) instead of the primary `points`/`duration`, and grants nothing extra from burst while running off memory.

  A new `overrides.fallback` setting overrides the default. See [ADR 0010](https://github.com/opengovsg/starter-kitty/blob/develop/docs/adr/0010-clamp-insurance-limiter-fallback.md) for the rationale.

  Creating a limiter with no Redis client is now reported to `logger.error` instead of `logger.warn`, since enforcement in that mode is degraded. This makes it alertable distinctly from routine configuration warnings such as a clamped rate-limit value, which still go to `warn`.

- [#88](https://github.com/opengovsg/starter-kitty/pull/88) [`cd6847e`](https://github.com/opengovsg/starter-kitty/commit/cd6847e66eb62f559286fc265ddbc6628a43fc27) Thanks [@dextertanyj](https://github.com/dextertanyj)! - Initial release: a framework-agnostic rate-limiting core built on rate-limiter-flexible.

  - `createGlobalRateLimiter`: pre-authentication limiter keyed purely by client IP, shielding the infrastructure that authentication itself hits.
  - `createLocalRateLimiter`: per-actor, per-resource quotas for identified traffic.
  - `createRateLimiter`: the underlying core, an injected ioredis client with in-memory insurance/fallback and a steady window composed with an optional burst allowance.
  - `RateLimitExceededError`, with a `toHttpHeaders()` method for the `Retry-After` header.
