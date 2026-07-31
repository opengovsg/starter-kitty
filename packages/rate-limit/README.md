# `@opengovsg/rate-limit`

A framework-agnostic rate-limiting core built on
[rate-limiter-flexible](https://github.com/animir/node-rate-limiter-flexible).
Counters live in an injected Redis ([ioredis](https://github.com/redis/ioredis))
client so limits are shared across replicas, with an in-memory insurance
limiter keeping enforcement alive through Redis outages — and a memory-only
fallback when no client is configured at all.

The package reads **no environment variables** of its own and depends on no
HTTP framework. `ioredis` is an optional peer dependency. Install it only if
you back the limiter with Redis.

## The two limiters

Most deployments want both, mounted in this order:

1. **`createGlobalRateLimiter`**, mounted **before** authentication.
   Protects session, API-key, and OTP verification from unauthenticated floods.
   Keyed by client IP, defaulting to 100 points per second.
2. **`createLocalRateLimiter`**, mounted after identity exists. Keyed by
   `actor` + `resource`, enforcing fair per-actor quotas per resource so one
   identified caller cannot monopolize an endpoint. Defaults to 50 points per
   10 seconds with a burst of 20 per 30 seconds.

`createRateLimiter` exposes the underlying core for anything else (custom
keys, throttling non-HTTP work such as database writes).

## Setup

Create the limiters once, injecting your app's Redis client, and re-export
them:

```javascript
// src/rate-limiters.ts
import { createGlobalRateLimiter, createLocalRateLimiter } from '@opengovsg/rate-limit'

// Recommended to use `@opengovsg/logging`.
import { logger } from '~/logger' // a base/system logger
import { redis } from '~/redis' // your ioredis client

export const globalRateLimiter = createGlobalRateLimiter({ client: redis, logger })
export const localRateLimiter = createLocalRateLimiter({ client: redis, logger })
```

When `client` is omitted, the limiter runs on in-memory counters. This is suitable for tests and local development. However, as limits are
per-instance and not shared across replicas, this is not suitable for a production use case.

## Checking limits

```ts
// Before auth: coarse per-IP shielding.
await globalRateLimiter.check({ ip: req.ip })

// After auth: fair per-actor, per-resource quotas.
await localRateLimiter.check({
  actor: session.userId,
  // A normalized route identity (route template or procedure name), never
  // the raw URL: raw URLs give every parameter value its own bucket.
  resource: 'bookings.create',
  // Optional request-scoped logger: request errors (an unexpected store
  // error) then carry this request's identity.
  logger: req.log,
})
```

Resolving the client IP is application-owned because the correct source depends
on the deployment's trusted-proxy configuration. Pass the same trusted value
your app uses for request logging. Do not accept forwarding headers from
untrusted clients.

`actor` is caller-defined: a user ID, an API-key ID. `check` throws
`RateLimitExceededError` when the allowance is exhausted. Any other error is
reported via the per-call `logger`'s `error` method (falling back to the
factory `logger`) and rethrown, so failing open or closed stays your decision.

## Handling rejections

```ts
import { RateLimitExceededError } from '@opengovsg/rate-limit'

try {
  await localRateLimiter.check({ actor, resource })
} catch (error) {
  if (error instanceof RateLimitExceededError) {
    const headers = error.toHttpHeaders() // { 'Retry-After': '3' }
    return res.status(429).set(headers).json({ message: error.message })
  }
  throw error
}
```

`instanceof` assumes a single copy of the package. If a mixed ESM/CJS
dependency graph loads multiple copies, the constructors differ and the check
can fail. At that boundary, use a structural guard that checks `name`, `info`,
and `toHttpHeaders` instead.

## Configuration

Every limiter accepts `overrides` of shape:

| Field      | Default                          | Meaning                                                                 |
| ---------- | -------------------------------- | ----------------------------------------------------------------------- |
| `points`   | `50`                             | Consumption points per steady window                                    |
| `duration` | `10`                             | Steady window in seconds                                                |
| `burst`    | `{ points: 20, duration: 30 }`   | Extra short-lived allowance (omit to inherit, `null` to disable)        |
| `prefix`   | `'api'` / `'global'` / `'local'` | Namespace segment isolating this limiter's counters in the shared store |

Configuration is fixed at creation. A route that needs different limits
creates its own limiter with its own `overrides`.

Store keys live under `rate-limit:<prefix>:` (steady) and
`rate-limit-burst:<prefix>:` (burst).

See the [documentation website](https://kit.open.gov.sg/) for full API docs,
and [ADR-0009](../../docs/adr/0009-rate-limit-package-design.md) for the
design rationale.
