# 11. Log every fallback-limiter invocation

Date: 2026-08-10
Status: Accepted (amends [0010](./0010-clamp-insurance-limiter-fallback.md))

## Context

[ADR 0010](./0010-clamp-insurance-limiter-fallback.md) clamps the fallback
allowance used as insurance behind a Redis-backed window, and as the sole
limiter when no `client` is configured. It defers alerting when enforcement
is running on that fallback limiter to a future ADR.

An operator needs to know when a service is running on the fallback path,
since it is more restrictive than the primary window and signals that Redis
is unavailable or was never configured. The package already takes a
`Logger` (`CreateRateLimiterOptions.logger`) for configuration warnings and
store failures.

The fallback limiter serves two different roles, and they warrant different
logging. As insurance behind a Redis-backed window, it should only run
during a Redis outage, so every invocation is itself a signal worth logging.
As the sole limiter when no `client` is configured, it runs on every
`check()` call in normal operation, for example in local development or
tests where Redis is not set up. Logging every invocation there produces
constant noise instead of a signal.

## Decision

### `LoggedFallbackRateLimiter` wraps `RateLimiterMemory`, only for the insurance case

`buildLimiter` constructs the insurance limiter behind a Redis-backed window
as `LoggedFallbackRateLimiter` (`packages/rate-limit/src/logged-fallback-rate-limiter.ts`)
instead of a plain `RateLimiterMemory`. It overrides `consume`, `penalty`,
`reward`, `get`, `set`, `block`, and `delete` to log a `warn` line, `"Fallback
rate limiter triggered"`, with the key in context, then delegates to
`super.<method>`.

When no `client` is configured, the fallback is the sole limiter and stays
a plain `RateLimiterMemory`. `buildLimiter` logs once, at construction, with
`logger.error`. This keeps the one-time "no Redis client configured" log
from ADR 0009 rather than adding a log line to every subsequent `check()`
call.

Alerting on the per-invocation warn line, for example a volume-based alert
in the operator's log platform, is left outside the package. This reuses
the existing `Logger` interface instead of adding a dependency on a
specific metrics or alerting backend.

## Consequences

- Every insurance-limiter call logs a warning, regardless of whether it
  exceeds the fallback's points. Operators alert on the rate of this
  message, not only on `RateLimitExceededError`.
- When no `client` is configured, only the initial construction logs.
  Running the package with no Redis client, as in local development or
  tests, does not produce a warning per request.
- No new dependency: alerting is entirely downstream of the existing
  `Logger` interface.
- A caller without log-based alerting gets no alert. This ADR guarantees
  the signal exists, not that it is wired to a page.
