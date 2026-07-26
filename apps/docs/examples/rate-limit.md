# @opengovsg/rate-limit

A framework-agnostic rate-limiting core built on
[rate-limiter-flexible](https://github.com/animir/node-rate-limiter-flexible).
Counters live in an injected Redis ([ioredis](https://github.com/redis/ioredis))
client so limits are shared across replicas, with an in-memory insurance
limiter keeping enforcement alive through Redis outages — and a memory-only
fallback when no client is configured at all.

## Installation

```bash
npm i --save @opengovsg/rate-limit
```

`ioredis` is an optional peer dependency; install it only if you back the
limiter with Redis.

## Setup

Create the limiters once, injecting your app's Redis client, and re-export
them:

```javascript
// src/rate-limiters.ts — owned by your app
import { createGlobalRateLimiter, createLocalRateLimiter } from '@opengovsg/rate-limit'

import { systemLogger } from '~/logger' // a base/system logger
import { redis } from '~/redis' // your ioredis client

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

The factory `logger` receives a configuration warning when no client is
configured. Out-of-range rate-limit values are silently clamped to a safe
minimum. Per-request warnings take a separate, request-scoped logger on each
`check` (see below).

Omit `client` and the limiter runs on in-memory counters — fine for tests,
local development, and single-instance deployments, but limits are then
per-instance and not shared across replicas. The factory `logger` fires once
per configuration to make that explicit.

## Why two limiters?

**Mount the global limiter before authentication.** Verifying a session, an
API key, or an OTP hits critical infrastructure — usually your database. A
per-user limiter only engages _after_ identity is established, so it cannot
shield that infrastructure from an unauthenticated flood. The global limiter
is keyed purely by client IP (100 points/second by default, no burst) and
stands in front of auth; the local limiter (keyed by `actor` + `resource`,
50 points/10 s with a 20/30 s burst by default) enforces fair per-user quotas
once identity exists.

A `null` IP falls into a shared `unknown` bucket rather than being exempted.

## Express

```javascript
import { constructRateLimitHeaders, RateLimitExceededError } from '@opengovsg/rate-limit'

import { globalRateLimiter, localRateLimiter } from '~/rate-limiters'

const respond429 = (res, error) =>
  res.status(429).set(constructRateLimitHeaders(error)).json({ message: error.message })

// Before auth: coarse per-IP shielding.
app.use(async (req, res, next) => {
  try {
    await globalRateLimiter.check({ ip: req.ip ?? null })
    next()
  } catch (error) {
    if (error instanceof RateLimitExceededError) return respond429(res, error)
    next(error) // infra error: your call whether to fail open or closed
  }
})

// After auth: fair per-actor, per-route quotas. Passing the request logger
// means any request warnings carry this request's identity (path, user, IP).
const rateLimited = options => async (req, res, next) => {
  try {
    await localRateLimiter.check({ actor: req.session.userId, resource: req.route.path, options, logger: req.log })
    next()
  } catch (error) {
    if (error instanceof RateLimitExceededError) return respond429(res, error)
    next(error)
  }
}

app.post('/api/bookings', authenticate, rateLimited({ points: 5, duration: 60 }), createBooking)
```

Client-IP resolution belongs to the application because it depends on the
deployment's trusted-proxy configuration. Pass the same trusted value used for
request logging; do not accept forwarding headers from untrusted clients.

## tRPC

Drive per-procedure limits from procedure `meta`:

```javascript
import { RateLimitExceededError } from '@opengovsg/rate-limit'
import { initTRPC, TRPCError } from '@trpc/server'

import { localRateLimiter } from '~/rate-limiters'

const t = initTRPC
  .context()
  .meta()
  .create({ defaultMeta: { rateLimitOptions: {} } })

const rateLimitMiddleware = t.middleware(async ({ ctx, meta, path, next }) => {
  if (meta?.rateLimitOptions === null) return next() // opt-out per procedure
  try {
    await localRateLimiter.check({
      actor: ctx.session?.userId ?? ctx.clientIp ?? 'unknown',
      path,
      options: meta?.rateLimitOptions,
      logger: ctx.logger, // request-scoped, so request warnings carry request identity
    })
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: error.message })
    }
    throw error
  }
  return next()
})

export const publicProcedure = t.procedure.use(rateLimitMiddleware)

// Stricter limits where it matters:
const login = publicProcedure
  .meta({ rateLimitOptions: { points: 5, duration: 60, burst: { points: 3, duration: 120 } } })
  .mutation(/* ... */)
```

## Choosing an actor

`actor` is caller-defined. Use a stable identifier for the authenticated
principal — a user ID or an API-key ID. For bearer tokens, hash before keying
so raw secrets never become store keys:

```javascript
import { createHash } from 'node:crypto'

const actor = createHash('sha256').update(bearerToken).digest('hex')
await localRateLimiter.check({ actor, resource: 'mcp.callTool' })
```

## Beyond HTTP

The core `createRateLimiter` fits any throttling job — e.g. limiting a
`lastUsedAt` bookkeeping write to once per key per ten minutes:

```javascript
import { createRateLimiter, RateLimitExceededError } from '@opengovsg/rate-limit'

const touchThrottle = createRateLimiter({
  client: redis,
  defaults: { points: 1, duration: 600, burst: null, prefix: 'secretkey-touch' },
})

try {
  await touchThrottle.check({ key: apiKeyId })
  await db.apiKey.update({ where: { id: apiKeyId }, data: { lastUsedAt: new Date() } })
} catch (error) {
  if (!(error instanceof RateLimitExceededError)) throw error
  // Throttled: skip the write.
}
```
