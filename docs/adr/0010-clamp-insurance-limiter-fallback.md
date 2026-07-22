# 10. Clamp the insurance limiter's fallback allowance

Date: 2026-07-22
Status: Accepted (amends [0009](./0009-rate-limit-package-design.md))

## Context

[ADR 0009](./0009-rate-limit-package-design.md) establishes that an in-memory
limiter is always present, in two roles: as the `insuranceLimiter` behind each
Redis-backed window during an outage, and as the sole enforcement when no
`client` is configured at all. In both roles, the memory limiter is built with
the same `points`/`duration` as the primary configuration.

That equivalence has a consequence 0009 names but doesn't correct: because the
memory limiter is per-instance, a deployment running N replicas effectively
multiplies its rate limit by N the moment Redis becomes unavailable — every
replica enforces the full configured window independently, with no shared
counter. A limiter is most likely to matter exactly when a service is under
elevated load or attack, which is also when Redis is more likely to be
degraded (contention, failover, network partition). Reusing the primary
allowance for the fallback path means the limiter gets *more* permissive
exactly when the system is least able to afford it.

The same reasoning applies to the memory-only path (no `client` configured at
all): that configuration is not shared across replicas either, and is equally
unfit to carry a production-sized allowance per instance.

## Decision

### The fallback allowance defaults to 10 points/second, 5 for the local limiter

Every memory limiter this package builds — the insurance limiter behind each
Redis-backed window, and the sole limiter when no `client` is configured —
uses a clamped **fallback** configuration instead of the primary `points`/
`duration`. Rather than deriving the fallback from whatever primary
`points`/`duration` a caller happens to configure, it is a small, fixed set of
constants, one per factory:

- `createRateLimiter` (bare) and `createGlobalRateLimiter`: **10 points per
  second**. The global limiter's own primary default is 100/s, so this is a
  deliberate 10x tightening during an outage.
- `createLocalRateLimiter`: **5 points per second**, overriding the base 10/s
  down to match its own ~5 rps steady default, so the fallback path isn't
  needlessly looser than the local limiter's already-conservative baseline in
  the common case.

Fixed constants are simpler to reason about and implement than deriving the
fallback from the resolved primary window: no computation, no rounding rules,
one number (or two) to remember. The trade-off is that they don't
automatically track a caller's own tightening. A caller who configures a
much stricter primary window than the relevant constant above — e.g. a
per-route override on the local limiter such as
`{ points: 5, duration: 60 }` (~0.08 rps), well under the local limiter's 5/s
fallback — will see the fallback path be *more lenient* than that route's own
primary configuration during a degraded state. This is an accepted trade-off:
callers with such tightly-scoped routes set `fallback` explicitly (see below)
alongside the per-check override if they need the fallback to track it.

### Burst is disabled while running in fallback

Bursting exists to be lenient — it absorbs legitimate spikes on top of an
already-permissive steady window. That is the opposite of what a degraded,
possibly-under-attack path should do, so burst grants nothing extra whenever
enforcement is running off memory, regardless of whether the primary
configuration has a `burst` window.

This isn't free: `BurstyRateLimiter` (from `rate-limiter-flexible`) only
consults its burst leg when the steady leg *rejects*, and each leg's
`insuranceLimiter` is only ever consulted when that leg's own Redis call
throws an infrastructure error, never on an ordinary over-limit rejection. A
naive implementation would leave the burst window's insurance limiter
configured with the primary's full, unclamped burst allowance, which would
grant its whole burst window on top of the clamped steady fallback during an
outage, undermining the entire premise of this ADR.

The burst window's insurance limiter is therefore built as a dedicated,
zero-capacity memory limiter (`points: 0`, a valid finite value the
underlying library accepts): it rejects immediately and cleanly with a
`RateLimiterRes` whenever it's asked to consume, so a caller who exceeds the
clamped steady fallback during an outage still gets an ordinary
`RateLimitExceededError`, never a raw infrastructure error. This limiter sits
completely inert whenever Redis is healthy, since insurance is consulted only
on infra failure, never on a legitimate rejection.

An alternative considered was pointing the burst leg's insurance at the same
memory limiter instance used for the steady fallback, so both legs draw from
one shared bucket. That was rejected: on every rejected request during an
outage, the steady leg would consume from the shared bucket, then the burst
leg would consume from it again on retry, double-counting against a bucket
that's already over limit. The dedicated zero-capacity limiter avoids that
without depending on call-order coincidences.

### A `fallback` option, narrower than `RateLimitConfig`

`CreateRateLimiterOptions` gains:

```ts
fallback?: {
  points?: number
  duration?: number
}
```

Values given here override the factory's built-in fallback constant the same
way `defaults` already overrides `BASE_DEFAULTS`: set only `points` to keep
the default duration, only `duration` to keep the default points, or both.

The type is deliberately narrower than `RateLimitConfig` — no `burst`, no
`prefix`. Excluding `burst` from the type makes it structurally impossible to
reintroduce burst leniency into the fallback path by passing a config
object. The only way to loosen it is to raise `fallback.points` explicitly,
which is a visible, intentional choice at the call site. `prefix` isn't
meaningful here: the fallback limiter shares the primary window's key
namespace, since it stands in for the same window rather than a separate one.

This is a factory-level option only, not exposed per-check. Per-check
`options` already exist to express a route's *primary* window. The fallback
behaviour is a property of how conservatively the factory degrades, which
argues for one answer per factory rather than one that could silently vary
by call site.

## Consequences

- An N-replica deployment's effective rate limit during a Redis outage is
  bounded by roughly `N × 10/s` (`N × 5/s` for the local limiter) per window
  instead of `N × points`, per the threat model in
  [ADR 0009](./0009-rate-limit-package-design.md#threat-model-single-source-floods-only):
  a degraded system should assume it's more likely to be under attack, not
  less. The global limiter's 100/s default sees a real, material tightening
  (10x) during an outage.
- Because the fallback is a fixed constant rather than derived from the
  resolved primary window, a caller whose primary configuration is already
  tighter than the relevant constant (e.g. a per-route override well under
  5 or 10 rps) will see the fallback path be *more lenient* than that route's
  own normal enforcement during a degraded state. This is a known, accepted
  trade-off of picking simple fixed numbers over a derived cap. Such callers
  set `fallback` explicitly if they need the fallback to track their tighter
  primary.
- The memory-only deployment mode (no `client` configured) is now subject to
  the same fixed fallback constants, and stops reflecting whatever `points`/
  `duration` a caller configured. This lands hardest on the exact scenario
  0009 recommends this mode for: tests and local development, where a small
  configured `points` value (e.g. `points: 1` to make a test deterministic)
  no longer bounds enforcement at all once no `client` is passed — the
  fallback constant does. Callers who need memory-only enforcement to match
  a specific configured value (test assertions included) must pass
  `fallback` explicitly rather than relying on `points`/`duration` alone.
  This is treated as a correction, not a backwards-compatibility concern,
  since 0009 already documents this mode as unfit for shared, replica-safe
  production use, but it is a real, deliberate ergonomics cost accepted here
  rather than an oversight.
- Bursty configurations lose their burst allowance entirely while degraded.
  Callers relying on burst to absorb legitimate spikes will see 429s sooner
  than before during an outage. This is the intended trade-off: a tighter
  steady-only fallback beats a fallback that's accidentally as lenient as
  the primary window.
- Consumers who've measured their own replica count, or configured a
  primary window far tighter than the built-in fallback constant, can
  express an exact fallback figure via the new `fallback` option, without
  reaching for `RateLimitConfig`'s full shape.
