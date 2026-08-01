# 10. Clamp the insurance limiter's fallback allowance

Date: 2026-07-22
Status: Accepted (amends [0009](./0009-rate-limit-package-design.md))

## Context

[ADR 0009](./0009-rate-limit-package-design.md) gives the in-memory limiter
two roles: insurance behind each Redis-backed window during an outage, and
the sole enforcement when no `client` is configured. In both roles it is
built with the same `points` and `duration` as the primary window.

The memory limiter is per-instance, so a deployment with N replicas
multiplies its limit by N the moment Redis goes down. An outage is also when
a service is most likely to be under pressure.

Reusing the primary allowance makes the limiter more permissive exactly when
the system can least support it.

## Decision

### The fallback allowance is a fixed constant, 10/s or 5/s

The insurance limiter behind each Redis-backed window, and the sole limiter
when no `client` is configured, use a fixed fallback allowance instead of
the primary `points` and `duration`:

- **`createRateLimiter` and `createGlobalRateLimiter`: 10 points per
  second.** The global limiter's primary default is 100/s, so an outage
  tightens it 10x.
- **`createLocalRateLimiter`: 5 points per second.** This matches its own
  roughly 5 rps steady default. The base 10/s would be looser than normal
  operation.

A fixed constant is simpler to reason about than a fallback derived from the
primary window. The trade-off is that a caller with a primary window tighter
than the constant, such as a per-route override of
`{ points: 5, duration: 60 }`, gets a fallback more lenient than that
route's normal enforcement. Such callers should set `overrides.fallback`
explicitly (see below).

### Burst is disabled while running in fallback

The burst limiter exists to soak up spikes. When the system is degraded, a
spike is more likely to hurt it, so no burst allowance applies when Redis is
not available.

When no `client` is configured, the fallback is a plain in-memory limiter
with no burst leg.

When Redis is configured, the burst leg's insurance is an in-memory limiter
with `points: 0`. A caller who exceeds the steady fallback during an outage
then still gets `RateLimitExceededError` rather than a Redis error.

> Alerting when enforcement is running on the insurance limiter is deferred to
> a future ADR.

### Configuration using a nested fallback option

`RateLimitConfig`, passed through `CreateRateLimiterOptions.overrides`, gains:

```ts
overrides?: {
  fallback?: {
    points: number
    duration: number
  }
}
```

Omitting `fallback` uses the factory's fallback constant. An override must
provide both `points` and `duration`.

## Consequences

- During a Redis outage, an N-replica deployment's effective limit per
  window is bounded by roughly N × 10/s (N × 5/s for the local limiter)
  instead of N × the primary points.
- A caller whose primary window is tighter than the fallback constant gets a
  more lenient fallback while degraded, and must set `overrides.fallback`
  explicitly to track it.
- The memory-only mode (no `client`) stops reflecting the configured
  `points` and `duration`. Tests that rely on a small `points` value must
  pass `overrides.fallback` explicitly. This is a correction, since 0009 already
  documents this mode as unfit for replica-safe production use.
- Bursty configurations lose their burst allowance while degraded, so
  callers see 429s sooner during an outage.
- Callers who know their replica count can set an exact figure via
  `overrides.fallback`.
