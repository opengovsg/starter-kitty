# `@opengovsg/starter-kitty-rate-limit`

A framework-agnostic rate-limiting core built on
[rate-limiter-flexible](https://github.com/animir/node-rate-limiter-flexible),
extracted from the production patterns shared by several OGP applications.

Counters live in an injected Redis ([ioredis](https://github.com/redis/ioredis))
client so limits are shared across replicas, with an in-memory insurance
limiter keeping enforcement alive through Redis outages — and a memory-only
fallback when no client is configured at all. A steady fixed window is
composed with a short-lived burst allowance, so the sustained rate stays
honest while legitimate spikes (a page load firing parallel API calls, users
behind shared IPs) are absorbed.

The package reads **no environment variables** of its own and depends on no
HTTP framework. `ioredis` is an optional peer dependency — memory-only usage
needs nothing extra.

## The two limiters

Most deployments want both, mounted in this order:

1. **`createGlobalRateLimiter`** — keyed purely by client IP, mounted
   **before** authentication. Authentication itself hits critical infrastructure
   (database lookups for sessions, API keys, OTPs); a per-user limiter cannot
   protect that because unauthenticated traffic has no user yet. Defaults to
   100 points per second per IP, no burst. IPv4-mapped IPv6 addresses are
   normalized to their embedded IPv4 address; other IPv6 clients are bucketed
   by /64 prefix (a subscriber typically holds a whole /64, so finer keying
   would allow bucket-minting by address rotation). A `null` or unparseable IP
   shares one `unknown` bucket and emits a request warning.
2. **`createLocalRateLimiter`** — keyed by `actor` + `resource`, mounted
   after identity exists. Enforces fair per-actor quotas per resource.
   Defaults to 50 points per 10 seconds with a burst of 20 per 30 seconds.

`createRateLimiter` exposes the underlying core for anything else (custom
keys, throttling non-HTTP work such as database writes).

## Setup

```ts
// src/rate-limiters.ts — owned by your app
import { createGlobalRateLimiter, createLocalRateLimiter } from '@opengovsg/starter-kitty-rate-limit'

import { redis } from './redis.js' // your ioredis client (or omit for memory-only)
import { systemLogger } from './logger.js' // a base/system logger

// `logger` needs only a `warn({ message, context?, error? })` method, so any
// structured logger satisfies it — pass it directly, no wrapper.
export const globalRateLimiter = createGlobalRateLimiter({ client: redis, logger: systemLogger })
export const localRateLimiter = createLocalRateLimiter({ client: redis, logger: systemLogger })
```

The global limiter validates and normalizes IP addresses by default. If the
application already supplies a trusted, canonical key, pass `validate: false`
to use every non-null string verbatim. This also disables IPv6 /64 bucketing
and IPv4-mapped normalization, so do not use it with attacker-controlled or
unnormalized values. A `null` IP still uses the shared `unknown` bucket.

The factory `logger` receives a configuration warning when no Redis client is
configured. This warning describes the limiter and fires roughly once, so a
base/system logger fits. Out-of-range rate-limit values are silently clamped
to a safe minimum.

Without a `client`, limits are enforced in memory — functional, but
per-instance and not shared across replicas. The factory `logger` surfaces that
trade-off.

## Checking limits

```ts
// Before auth: coarse per-IP shielding.
await globalRateLimiter.check({ ip: req.ip ?? null })

// After auth: fair per-actor, per-resource quotas.
await localRateLimiter.check({
  actor: session.userId,
  // A normalized route identity (route template or procedure name), never
  // the raw URL: raw URLs give every parameter value its own bucket.
  resource: 'bookings.create',
  // Optional per-call override for expensive routes:
  options: { points: 5, duration: 60, burst: null },
  // Optional request-scoped logger: request warnings (an unexpected store
  // error) then carry this request's identity.
  logger: req.log,
})
```

Resolving the client IP is application-owned because the correct source depends
on the deployment's trusted-proxy configuration. Pass the same trusted value
your app uses for request logging; do not accept forwarding headers from
untrusted clients.

`actor` is caller-defined: a user ID, an API-key ID, or a hash of a bearer
token — hash secrets yourself so they never become store keys. `check` throws
`RateLimitExceededError` when the allowance is exhausted; any other error is
reported to the per-call `logger` (falling back to the factory `logger`) and
rethrown, so failing open or closed stays your decision.

## Handling rejections

```ts
import { constructRateLimitHeaders, RateLimitExceededError } from '@opengovsg/starter-kitty-rate-limit'

try {
  await localRateLimiter.check({ actor, resource })
} catch (error) {
  if (error instanceof RateLimitExceededError) {
    const headers = constructRateLimitHeaders(error) // { 'Retry-After': '3' }
    return res.status(429).set(headers).json({ message: error.message })
  }
  throw error
}
```

## Configuration

Every limiter accepts `defaults`, and `createRateLimiter`/`createLocalRateLimiter`
accept per-check `options`, both of shape:

| Field      | Default                          | Meaning                                                                 |
| ---------- | -------------------------------- | ----------------------------------------------------------------------- |
| `points`   | `50`                             | Consumption points per steady window                                    |
| `duration` | `10`                             | Steady window in seconds                                                |
| `burst`    | `{ points: 20, duration: 30 }`   | Extra short-lived allowance; omit to inherit, `null` to disable         |
| `prefix`   | `'api'` / `'global'` / `'local'` | Namespace segment isolating this limiter's counters in the shared store |

Store keys live under `rate-limit:<prefix>:` (steady) and
`rate-limit-burst:<prefix>:` (burst).

See the [documentation website](https://kit.open.gov.sg/) for full API docs,
and [ADR-0009](../../docs/adr/0009-rate-limit-package-design.md) for the
design rationale.
