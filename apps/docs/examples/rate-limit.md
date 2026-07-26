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
// src/rate-limiters.ts — owned by your app
import { createAuthnRateLimiter, createGlobalRateLimiter, createLocalRateLimiter } from '@opengovsg/rate-limit'

// Recommended to use `@opengovsg/logging`.
import { logger } from '~/logger' // a base/system logger
import { redis } from '~/redis' // your ioredis client

export const globalRateLimiter = createGlobalRateLimiter({ client: redis, logger })
export const authnRateLimiter = createAuthnRateLimiter({ client: redis, logger })
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

If the application already supplies a trusted, canonical key, pass
`skipKeyNormalization: true` to the global limiter or `validate: false` to the
authn limiter to use each string verbatim. This disables IPv6 /64 bucketing
and IPv4-mapped normalization, so do not use it with attacker-controlled or
unnormalized values. A `null` authn IP still uses the shared `unknown` bucket.

### Local rate limiter

Use the local limiter after authentication to apply per-actor, per-resource
quotas, such as limiting a user or API key on a particular route or procedure.
This prevents one identified caller from monopolizing an endpoint.

## Where each limiter fits

**Mount the global limiter before authentication.** Verifying a session, an
API key, or an OTP may hit critical infrastructure such as your database. A
per-user limiter only engages _after_ identity is established, so it cannot
shield that infrastructure from an unauthenticated flood. The global limiter
is keyed purely by client IP (100 points/second by default, no burst) and
stands in front of auth. The authn limiter then counts failed credential
verification by IP (100 failures/hour and a one-hour block by default). The
local limiter (keyed by `actor` + `resource`, 50 points/10 s with a 20/30 s
burst by default) enforces fair per-user quotas once identity exists.

A `null` IP falls into a shared `unknown` bucket rather than being exempted.

## Failed-authentication limiting

Mount protection in this order: probes → global limiter → authn `isBlocked` →
credential verification → authn `consume` on failure → local limiter after
identity exists. The read-only precheck does not mint a key. The failure that
exceeds the allowance engages the block; future checks throw
`RateLimitExceededError` with the usual `Retry-After` information.

Consume only when a credential was presented and failed verification: unknown,
revoked, malformed, expired, or carrying a bad signature. Failed webhook
signature checks count too. These two cases never count:

- No credential was presented. Missing credentials carry no guessing signal.
- A valid credential lacks permission (403). That is authorization, not
  authentication.

Return one uniform 401 response for all verification failures. Do not reveal
whether a credential never existed, expired, or was revoked; those distinctions
turn the API into a credential-validity oracle.

The IP-keyed authn limiter intentionally exposes no `reset`. A successful
client behind a shared NAT must not erase failures from another client, and an
attacker with any valid credential must not be able to reset their probing
budget. `createBlockingRateLimiter` exposes `reset` for custom buckets scoped
to the authenticator that actually succeeded.

## Express

```javascript
import { RateLimitExceededError } from '@opengovsg/rate-limit'

import { authnRateLimiter, globalRateLimiter, localRateLimiter } from '~/rate-limiters'

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

// Start in shadow mode to measure false positives behind shared egress. In
// enforcement mode a block returns 429; in shadow mode it is logged and the
// request proceeds to ordinary credential verification.
const AUTHN_SHADOW_MODE = true
const uniform401 = res => res.status(401).json({ message: 'Invalid credentials' })

app.use(async (req, res, next) => {
  try {
    await authnRateLimiter.isBlocked({ ip: req.ip ?? null, logger: req.log })
    next()
  } catch (error) {
    if (AUTHN_SHADOW_MODE) {
      req.log.warn({ message: 'Authn rate limiter would reject request', error })
      return next() // catch, log, admit while calibrating
    }
    if (error instanceof RateLimitExceededError) return respond429(res, error)
    next(error) // store failure: choose fail-open or fail-closed for your app
  }
})

app.use(async (req, res, next) => {
  const credential = readCredential(req)
  if (credential === null) return uniform401(res) // missing: do not consume

  const identity = await verifyCredential(credential) // identity or null; infrastructure errors throw
  if (identity === null) {
    try {
      await authnRateLimiter.consume({ ip: req.ip ?? null, logger: req.log })
    } catch (error) {
      // Fail open for limiter infrastructure only. Authentication still failed,
      // so this remains a uniform 401 rather than admitting the request.
      req.log.warn({ message: 'Could not record failed authentication', error })
    }
    return uniform401(res)
  }

  req.identity = identity
  next()
})

// After auth: fair per-actor, per-route quotas. Passing the request logger
// means any request warnings carry this request's identity (path, user, IP).
const rateLimited = limiter => async (req, res, next) => {
  try {
    await limiter.check({ actor: req.identity.id, resource: req.route.path, logger: req.log })
    next()
  } catch (error) {
    if (error instanceof RateLimitExceededError) return respond429(res, error)
    next(error)
  }
}

app.post('/api/bookings', rateLimited(localRateLimiter), createBooking)
```

Configuration is fixed at creation, so a route that needs different limits
gets its own limiter:

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

```javascript
import { createLocalRateLimiter, RateLimitExceededError } from '@opengovsg/rate-limit'
import { initTRPC, TRPCError } from '@trpc/server'

import { localRateLimiter } from '~/rate-limiters'
import { redis } from '~/redis'

const t = initTRPC.context().meta().create()

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
  logger,
  overrides: { points: 5, duration: 60, burst: { points: 3, duration: 120 }, prefix: 'otp' },
})

const requestOtp = publicProcedure.meta({ rateLimiter: otpRateLimiter }).mutation(/* ... */)
```

## Choosing an actor

In the local rate limiter, `actor` is caller-defined. Use a stable identifier for the authenticated principal such as a user ID or an API-key ID.

For bearer tokens, hash before keying
so raw secrets never become store keys:

```javascript
import { createHash } from 'node:crypto'

const actor = createHash('sha256').update(bearerToken).digest('hex')
await localRateLimiter.check({ actor, resource: 'mcp.callTool' })
```
## Custom failure keys

`createBlockingRateLimiter` provides the same `isBlocked`/`consume`/`reset`
primitive for account or authenticator buckets. Never place a raw credential
in a store key. Services with expensive verification may optionally add a
second limiter keyed by a one-way credential hash, collapsing a distributed
retry storm of the same dead secret. This does not replace the IP limiter or
catch probing where every candidate is tried once.
With Redis configured, `reset` clears both Redis and insurance state; if Redis
cannot be cleared, it clears the in-memory state but rejects so the caller can
retry after recovery.

```javascript
import { createHash } from 'node:crypto'
import { createBlockingRateLimiter } from '@opengovsg/rate-limit'

const credentialFailures = createBlockingRateLimiter({
  client: redis,
  defaults: { points: 20, duration: 3600, block: { duration: 3600 }, prefix: 'credential-authn' },
})
const bucket = createHash('sha256').update(presentedCredential).digest('hex')

await credentialFailures.isBlocked({ key: bucket })
// Verify, then call consume on failure. Reset on success only when this exact
// bucket represents the authenticator that succeeded.
```

## Beyond HTTP

The core `createRateLimiter` fits any throttling job — e.g. limiting a
`lastUsedAt` bookkeeping write to once per key per ten minutes:

```javascript
import { createRateLimiter, RateLimitExceededError } from '@opengovsg/rate-limit'

const touchThrottle = createRateLimiter({
  client: redis,
  logger,
  overrides: { points: 1, duration: 600, burst: null, prefix: 'secretkey-touch' },
})

try {
  await touchThrottle.check({ key: apiKeyId })
  await db.apiKey.update({ where: { id: apiKeyId }, data: { lastUsedAt: new Date() } })
} catch (error) {
  if (!(error instanceof RateLimitExceededError)) throw error
  // Throttled: skip the write.
}
```
