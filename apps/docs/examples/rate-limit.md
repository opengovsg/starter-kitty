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

`ioredis` is an optional peer dependency. Install it only if you back the
limiter with Redis.

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

### Global rate limiter

Use the global limiter before authentication to protect work such as session,
API-key, or OTP verification. It groups requests by client IP, so it can reject
a flood before the caller's identity is known.

The global limiter validates and normalizes IP addresses by default.
When the IP is invalid or missing, requests are bucketed into an `unknown` bucket.

If the application already supplies a trusted, canonical key, pass `skipKeyNormalization: true`
to use every string verbatim. This also disables IPv6 /64 bucketing
and IPv4-mapped normalization, so do not use it with attacker-controlled or
unnormalized values.

### Local rate limiter

Use the local limiter after authentication to apply per-actor, per-resource
quotas, such as limiting a user or API key on a particular route or procedure.
This prevents one identified caller from monopolizing an endpoint.

## Why two limiters?

**Mount the global limiter before authentication.** Verifying a session, an
API key, or an OTP may hit critical infrastructure such as your database. A
per-user limiter only engages _after_ identity is established, so it cannot
shield that infrastructure from an unauthenticated flood. The global limiter
is keyed purely by client IP (100 points/second by default) and
stands in front of authentication. The local limiter (keyed by `actor` + `resource`,
50 points/10 s with a 20 points/30 s burst by default) enforces fair per-user quotas
once identity exists.

## Express

```javascript
import { RateLimitExceededError } from '@opengovsg/rate-limit'

import { globalRateLimiter, localRateLimiter } from '~/rate-limiters'

const respond429 = (res, error) => res.status(429).set(error.toHttpHeaders()).json({ message: error.message })

// Before authn: coarse per-IP shielding.
app.use(async (req, res, next) => {
  try {
    // IP extraction depends on your application's deployment.
    await globalRateLimiter.check({ ip: req.ip })
    next()
  } catch (error) {
    if (error instanceof RateLimitExceededError) return respond429(res, error)
    next(error) // Unexpected error: your call whether to fail open or closed
  }
})

// After authn: fair per-actor, per-route quotas. Passing the request logger
// means anything logged for this request carries its identity (path, user, IP).
const rateLimited = limiter => async (req, res, next) => {
  try {
    await limiter.check({ actor: req.session.userId, resource: `${req.method} ${req.route.path}`, logger: req.log })
    next()
  } catch (error) {
    if (error instanceof RateLimitExceededError) return respond429(res, error)
    next(error)
  }
}

app.post('/api/submission', authenticate, rateLimited(localRateLimiter), createSubmission)
```

Configuration is fixed at creation, so a route that needs different limits
gets its own limiter. Naming limiters after their use case keeps every policy
reviewable in one module:

```javascript
// src/rate-limiters.ts
export const reportRateLimiter = createLocalRateLimiter({
  client: redis,
  logger,
  overrides: {
    points: 5,
    duration: 60,
  },
})
```

```javascript
app.get('/api/reports', authenticate, rateLimited(reportRateLimiter), generateReport)
```

Client-IP resolution belongs to the application because it depends on the
deployment's trusted-proxy configuration. Pass the same trusted value used for
request logging. Do not accept forwarding headers from untrusted clients.

## tRPC

Drive per-procedure limits from procedure `meta`, referencing a limiter
instance:

```typescript
import type { LocalRateLimiter } from '@opengovsg/rate-limit'
import { createLocalRateLimiter, RateLimitExceededError } from '@opengovsg/rate-limit'
import { initTRPC, TRPCError } from '@trpc/server'

import { localRateLimiter } from '~/rate-limiters'
import { redis } from '~/redis'

interface Meta {
  // Defaults to `localRateLimiter`. Set to `null` to opt out of rate limiting.
  rateLimiter?: LocalRateLimiter | null
}

const t = initTRPC.context().meta<Meta>().create()

const rateLimitMiddleware = t.middleware(async ({ ctx, meta, path, next }) => {
  if (meta?.rateLimiter === null) return next() // opt-out per procedure
  const limiter = meta?.rateLimiter ?? localRateLimiter
  try {
    await limiter.check({
      actor: ctx.session?.userId ?? ctx.clientIp ?? 'unknown',
      resource: path,
      logger: ctx.logger, // request-scoped, so anything logged carries request identity
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

// Stricter limits where it matters: a dedicated limiter, referenced from meta.
const otpRateLimiter = createLocalRateLimiter({
  client: redis,
  overrides: { points: 5, duration: 60, burst: { points: 3, duration: 120 } },
})

const requestOtp = publicProcedure.meta({ rateLimiter: otpRateLimiter }).mutation(/* ... */)
```

## Choosing an actor

In the local rate limiter, `actor` is caller-defined. Use a stable identifier for the authenticated principal such as a user ID or an API-key ID.

When a request can carry more than one kind of identity, prefix the actor
with its type, such as `userId:123` or `apiKey:123`, so different identity
classes cannot share a bucket.

Hash actors that are secrets or may contain PII, such as bearer tokens or
email-based auth subjects, so raw values never become store keys:

```javascript
import { createHash } from 'node:crypto'

const actor = createHash('sha256').update(bearerToken).digest('hex')
await localRateLimiter.check({ actor, resource: 'mcp.callTool' })
```

## Custom keys

`createRateLimiter` exposes the core limiter with a caller-supplied `key`,
for work the global and local shapes do not fit, such as throttling a write
to a hot database row:

```javascript
// src/rate-limiters.ts
import { createRateLimiter } from '@opengovsg/rate-limit'

/** At most one `lastUsedAt` write per API key every ten minutes. */
export const apiKeyTouchRateLimiter = createRateLimiter({
  client: redis,
  logger,
  overrides: { prefix: 'api-key-touch', points: 1, duration: 600, burst: null },
})
```

```javascript
async function touchLastUsed(keyId) {
  // Best-effort: a throttled window or a limiter error skips the write.
  try {
    await apiKeyTouchRateLimiter.check({ key: keyId })
  } catch {
    return
  }
  await db.apiKey.update({ where: { id: keyId }, data: { lastUsedAt: new Date() } })
}
```

Keys are used verbatim, so normalize or hash caller-controlled values before
keying.
