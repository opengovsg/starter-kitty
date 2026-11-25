# 12. Log every insurance-limiter invocation

Date: 2026-08-10
Status: Accepted (amends [0010](./0010-clamp-insurance-limiter-fallback.md))

## Context

[ADR 0010](./0010-clamp-insurance-limiter-fallback.md) clamps the fallback
allowance used as insurance behind a Redis-backed window, and as the sole
limiter when no `client` is configured. It leaves to a future ADR how to
alert when enforcement runs on that fallback limiter.

An operator needs to know when a service is running on the fallback path,
since it is more restrictive than the primary window and signals that Redis
is unavailable or was never configured. The package already takes a
`Logger` (`CreateRateLimiterOptions.logger`) for configuration warnings and
store failures.

The fallback limiter has two roles, and they need different logging. As
insurance behind a Redis-backed window, it should only run during a Redis
outage, so every invocation means Redis is failing and is worth logging. As
the sole limiter when no `client` is configured, it runs on every `check()`
call in normal operation, for example in local development or tests where
Redis is not set up. Logging every invocation there would add a line per
request and tell the operator nothing.

## Decision

### `LoggedFallbackRateLimiter` wraps `RateLimiterMemory`, only for the insurance case

`buildLimiter` builds the insurance limiter behind a Redis-backed window as
`LoggedFallbackRateLimiter` (`packages/rate-limit/src/logged-fallback-rate-limiter.ts`)
instead of a plain `RateLimiterMemory`. The class overrides `consume`,
`penalty`, `reward`, `get`, `set`, `block`, and `delete`. Each override logs
a `warn` line, `"Fallback rate limiter triggered"`, with the limiter's
`prefix` in context, then calls `super.<method>`.

With `burst` configured there are two insurance limiters, one behind each
Redis-backed window. Only the steady window's is a
`LoggedFallbackRateLimiter`. The burst window's stays a plain
`RateLimiterMemory` with `points: 0` (ADR 0010). During an outage a check
only reaches it after the steady insurance limiter has already rejected the
check and logged, so a check logs once, not once per window.

The context omits the key. The key is a client IP for the global limiter and
a caller-defined actor for the local limiter, so it may contain personal
data. The limiter logs this line for every check during an outage, including
checks from callers within the limit. `prefix` is enough to tell which
limiter is running on its fallback.

When no `client` is configured, the fallback is the sole limiter and stays
a plain `RateLimiterMemory`. `buildLimiter` logs once, at construction, with
`logger.error`. This keeps the existing one-time "no Redis client
configured" log rather than adding a log line to every subsequent `check()`
call.

### The warning goes to the factory logger, not the per-check logger

`check()` accepts a request-scoped `logger`, but the insurance limiter logs
with the factory `logger` it was built with. `rate-limiter-flexible` calls
the insurance limiter itself after a Redis failure, and its typings give no
type-safe way to pass a per-call value through `consume`. The alternatives
were an unsafe cast on the `consume` options, or carrying the logger in
`AsyncLocalStorage`, which adds a dependency on `node:async_hooks`. This ADR
rejects both. The warning exists so operators can count fallback checks per
limiter, which `prefix` already identifies, so it does not need request
identity.

The package does not alert. Operators alert on the warn line in their log
platform, for example on its volume. This reuses the existing `Logger`
interface instead of adding a dependency on a specific metrics or alerting
backend.

## Consequences

- Every check served by the insurance limiter logs one warning, regardless
  of whether it exceeds the fallback's points or whether `burst` is
  configured. Operators alert on the rate of this message, not only on
  `RateLimitExceededError`.
- The warning does not carry request identity, even when `check()` is given
  a request-scoped logger. Everything else a check logs goes to that logger.
- When no `client` is configured, the limiter logs once, at creation.
  Running the package with no Redis client, as in local development or
  tests, does not produce a warning per request.
- The package gains no dependency. Alerting happens in whatever consumes the
  `Logger` output.
- A caller without log-based alerting gets no alert. The package only emits
  the log line.
