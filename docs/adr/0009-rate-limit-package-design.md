# 9. Rate-limit package design

Date: 2026-07-14
Status: Accepted

## Context

`@opengovsg/rate-limit` provides a framework-agnostic rate-limiting core:
Redis-backed counters shared across replicas, an in-memory fallback, and
limiters for traffic before and after authentication. This ADR records the
design decisions behind its API and defaults.

## Decision

### Threat model: single-source floods only

The package defends a server against one source (or a few) sending too much
load. Distributed floods are **out of scope**. That protection is delegated
to the CDN/WAF layer in front of the app.

Feature-specific rate limiting (e.g. login brute force) is also out of scope
and left to a future ADR. Neither limiter below is designed to cover it.

### Two limiters: before and after authentication

The package ships two limiters because they protect different things:

- **`createGlobalRateLimiter`** is keyed purely by client IP and mounted
  **before** authentication. Authentication is not free, as verifying a
  session or an API key may hit the database. The global limiter protects
  that resource before user identity is determined. A per-user limiter
  applies only after identity is known, which is too late.
- **`createLocalRateLimiter`** is keyed by `actor` plus `resource` and
  mounted **after** identity is determined. It prevents abuse and starvation
  at a more targeted level: each actor gets its own quota per resource, so
  one noisy client cannot starve the rest. The caller is expected to pick the
  actor (e.g. a user ID) and hash secrets itself.

### Global limiter decisions

The global limiter guards work that runs before identity is known, chiefly
the authentication lookup, and that work is the same on every route. The key
is therefore the client IP alone, one shared bucket per source across the
whole app.

The default is 100 points per second, a rate a production-sized database can
handle empirically when authentication is a simple lookup query. This
relatively large per-IP threshold accounts for shared IPs in offices and
CGNAT setups.

The IP rules close known holes:

- **Parsing and normalisation use
  [`ipaddr.js`](https://github.com/whitequark/ipaddr.js)**, so equivalent
  spellings of an IPv4-mapped IPv6 address share one bucket.
- **IPv6 is bucketed by /64 prefix** (IPv4 stays per-address). A home
  subscriber usually holds an entire /64, so per-address keying would hand an
  attacker a fresh bucket per request just by rotating within their prefix.
- **A `null` or unparseable IP falls into a shared `unknown` bucket**, never
  skipped, and each such check logs a warning. Broken IP extraction funnels
  all traffic into one protective bucket, with logs pointing at the cause.

### Local limiter decisions

The key is `actor:resource`, and `resource` must be a normalised route
identity (e.g. an Express route template, `/users/:id`), **never the raw
request URL**. Raw URLs make every parameter value its own bucket, which
splits an actor's quota, grows the Redis key count without bound, and breaks
per-route overrides.

The default is 50 points per 10 seconds with a burst of 20 per 30 seconds.
This translates to roughly 5 rps sustained per actor per resource, with a
burst buffer for initial page loads that fire waterfall API calls. Expensive
routes may pass a per-check `options` override at the mount site.

A nested `burst` object inherits the limiter's default when omitted, and an
explicit `null` disables it.

### Mounting order

The baseline is **global limiter → authentication → local limiter**, with
the following suggestions for the traffic that does not fit:

- **Health probes** mount before the global limiter: they have no usable
  client IP, and a limiter that fails a health check becomes the outage.
- **Anonymous but expensive routes** use the local limiter with the client IP
  as `actor`, and **webhooks** use the verified source's identity as `actor`
  after signature verification.

### IP extraction is the app's responsibility

The global limiter takes an `ip: string | null` and never reads headers
itself, because the trusted source of a client IP depends on the
application's infrastructure.

### An in-memory limiter is always present

Every Redis-backed window is created with `rejectIfRedisNotReady` and an
`insuranceLimiter` of the same size, so a Redis outage falls back to
per-instance counters instead of failing every request or allowing all traffic
through.

When no `client` is provided, the limiter is memory-only. This provides a
zero-infrastructure path for tests.

Other store errors are reported to the `logger` and rethrown. Whether to fail
open or fail closed is a product decision the package does not make.

### `Retry-After` is the only response header

`constructRateLimitHeaders` returns a `Retry-After` value and nothing else.

The `RateLimit-*` headers are deferred for now because the spec is still a
draft.

### Structural decisions, briefly

- **Wrap `rate-limiter-flexible` (v11), do not hand-roll.** Atomic Redis
  counters, insurance failover, and the bursty composition are solved there.
- **A factory, not a module singleton.** Following
  [ADR-0002](./0002-logging-factory-no-global.md), the library owns no global
  state.
- **An owned error type.** Rejections surface as `RateLimitExceededError`, and
  the dependency's `RateLimiterRes` never appears in the public API. This
  keeps the abstraction boundary intact so internals can be swapped later.
- **No framework adapters.** Express/tRPC middlewares stay in the consuming
  app as documented examples.
- **Apps sharing one Redis must namespace** via a distinct `prefix`, or the
  default `global`/`local` prefixes collide across services.

## Consequences

- Apps get shared, replica-safe rate limiting by passing one `ioredis` client,
  plus a mounting map with rules for probe, anonymous, and webhook traffic.
- The pre-auth/post-auth split is explicit API, so the "per-user limiter that
  never protected the DB" failure mode is harder to reproduce.
- Memory fallback means zero-infrastructure operation at the cost of
  per-instance limits. `ioredis` stays an optional peer dependency.
- Consumers own 429 response shaping and client-IP extraction. The package
  stays framework-neutral, and the docs carry the spoofing warning.
- Existing hand-rolled limiters migrate step by step: a static limiter service
  is a thin shim away from `check({ key, options, points })`.
