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

## The opinionated limiters

Most deployments want all three, mounted in this order:

1. **`createGlobalRateLimiter`** — keyed purely by client IP, mounted
   **before** authentication. Authentication itself hits critical infrastructure
   (database lookups for sessions, API keys, OTPs); a per-user limiter cannot
   protect that because unauthenticated traffic has no user yet. Defaults to
   100 points per second per IP, no burst. IPv4-mapped IPv6 addresses are
   normalized to their embedded IPv4 address; other IPv6 clients are bucketed
   by /64 prefix (a subscriber typically holds a whole /64, so finer keying
   would allow bucket-minting by address rotation). An unparseable IP shares
   one `unknown` bucket and is reported through the request logger.
2. **`createAuthnRateLimiter`** — keyed by client IP and mounted around
   credential verification. It reads block state before verification and
   records only presented credentials that fail verification. Defaults to an
   allowance of 100 failures/hour and a one-hour block when the allowance is
   exceeded.
3. **`createLocalRateLimiter`** — keyed by `actor` + `resource`, mounted
   after identity exists. Enforces fair per-actor quotas per resource.
   Defaults to 50 points per 10 seconds with a burst of 20 per 30 seconds.

`createRateLimiter` exposes the underlying core for anything else (custom
keys, throttling non-HTTP work such as database writes).

## Setup

Create the limiters once, injecting your app's Redis client, and re-export
them:

```ts
// src/rate-limiters.ts — owned by your app
import { createAuthnRateLimiter, createGlobalRateLimiter, createLocalRateLimiter } from '@opengovsg/rate-limit'

// Recommended to use `@opengovsg/logging`.
import { logger } from '~/logger' // a base/system logger
import { redis } from '~/redis' // your ioredis client

export const globalRateLimiter = createGlobalRateLimiter({ client: redis, logger })
export const authnRateLimiter = createAuthnRateLimiter({ client: redis, logger })
export const localRateLimiter = createLocalRateLimiter({ client: redis, logger })
```

The global and authn limiters validate and normalize IP addresses by default.
If the application already supplies a trusted, canonical key, pass
`skipKeyNormalization: true` to the global limiter or `validate: false` to the
authn limiter to use each string verbatim. This disables IPv6 /64 bucketing
and IPv4-mapped normalization, so do not use it with attacker-controlled or
unnormalized values.

When `client` is omitted, the limiter runs on in-memory counters. This is suitable for tests and local development. However, as limits are
per-instance and not shared across replicas, this is not suitable for a production use case.

## Checking limits

```ts
// Before auth: coarse per-IP shielding.
await globalRateLimiter.check({ ip: req.ip })

// Around credential verification: read first, record only failures.
await authnRateLimiter.isBlocked({ ip: req.ip ?? null })
const credential = readPresentedCredential(req)
if (credential !== null) {
  const identity = await verifyPresentedCredential(credential)
  if (identity === null) await authnRateLimiter.consume({ ip: req.ip ?? null })
}

// After auth: fair per-actor, per-resource quotas.
await localRateLimiter.check({
  actor: session.userId,
  // A normalized route identity (route template or procedure name), never
  // the raw URL: raw URLs give every parameter value its own bucket.
  resource: 'bookings.create',
  // Optional request-scoped logger: request diagnostics (an unexpected store
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

## Failed-authentication limiting

Mount authentication protection in this order:

1. health/readiness probes
2. global request limiter
3. authn `isBlocked`
4. credential verification
5. authn `consume` only when a presented credential fails verification
6. local limiter after identity exists

A recordable failure means that a credential was presented but was unknown,
revoked, malformed, expired, or carried an invalid signature. Failed webhook
signatures count too. Do **not** consume for a request with no credential at
all, or for a verified credential that lacks permission (a 403): neither is a
failed authentication attempt. Return the same 401 body for all verification
failures so callers cannot distinguish a credential that never existed from
one that was revoked.

The IP-keyed authn limiter deliberately never resets. A success from one
client behind a shared NAT says nothing about failures from another, and an
attacker holding any valid credential could otherwise erase their probing
history. The generic primitive exposes `reset` for custom keys that are scoped
to the authenticator that actually succeeded.

### Express recipe and shadow mode

```ts
import { RateLimitExceededError } from '@opengovsg/rate-limit'

import { authnRateLimiter } from './rate-limiters.js'

const AUTHN_SHADOW_MODE = true
const uniform401 = res => res.status(401).json({ message: 'Invalid credentials' })

// Place after the global limiter and before credential verification.
const rejectBlockedAuthn = async (req, res, next) => {
  try {
    await authnRateLimiter.isBlocked({ ip: req.ip ?? null, logger: req.log })
    next()
  } catch (error) {
    if (AUTHN_SHADOW_MODE) {
      req.log.warn({ message: 'Authn rate limiter would reject request', error })
      return next() // observe first; admit while thresholds are calibrated
    }
    if (error instanceof RateLimitExceededError) {
      return res.status(429).set(error.toHttpHeaders()).json({ message: error.message })
    }
    next(error) // store failure: choose fail-open or fail-closed for your app
  }
}

const authenticate = async (req, res, next) => {
  const credential = readCredential(req)
  if (credential === null) return uniform401(res) // missing: do not consume

  const identity = await verifyCredential(credential) // identity or null; infrastructure errors throw
  if (identity === null) {
    try {
      await authnRateLimiter.consume({ ip: req.ip ?? null, logger: req.log })
    } catch (error) {
      // Shadow/fail-open for limiter infrastructure only. The credential still
      // failed, so the request remains a uniform 401 rather than being admitted.
      req.log.warn({ message: 'Could not record failed authentication', error })
    }
    return uniform401(res)
  }

  req.identity = identity
  next()
}

app.use(globalRateLimit, rejectBlockedAuthn, authenticate)
app.post('/api/bookings', localRateLimit, createBooking)
```

Start with shadow mode long enough to measure shared-egress false positives,
then turn enforcement on explicitly. A blocked check returns 429 with
`Retry-After`; the failure that first engages the block still returns the
uniform 401, and later attempts see the block.

### Custom failure keys

Use `createBlockingRateLimiter` for an account, authenticator, or other custom
bucket. Never place a raw credential in a store key. For an expensive
credential verifier, a service may add a second limiter keyed by a one-way hash
of the presented credential to collapse a distributed retry storm of the same
dead secret. This is an optional extension, not a replacement for the IP
limiter: it does not detect probes that present each candidate only once.
With Redis configured, `reset` clears both Redis and insurance state; if Redis
cannot be cleared, it clears the in-memory state but rejects so the caller can
retry after recovery.

```ts
import { createHash } from 'node:crypto'
import { createBlockingRateLimiter } from '@opengovsg/rate-limit'

const credentialFailures = createBlockingRateLimiter({
  client: redis,
  defaults: { points: 20, duration: 3600, block: { duration: 3600 }, prefix: 'credential-authn' },
})
const bucket = createHash('sha256').update(presentedCredential).digest('hex')

await credentialFailures.isBlocked({ key: bucket })
// verify; call consume on failure. Call reset on success only when this exact
// bucket represents the authenticator that succeeded.
```

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

| Field      | Default                                         | Meaning                                                                           |
| ---------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `points`   | `50`                                            | Consumption points per steady window                                              |
| `duration` | `10`                                            | Steady window in seconds                                                          |
| `burst`    | `{ points: 20, duration: 30 }`                  | Extra short-lived allowance; omit to inherit, `null` to disable                   |
| `fallback` | `{ points: 10, duration: 1 }` (`5/1` for local) | Independent in-memory allowance, with burst granting nothing extra while degraded |
| `prefix`   | `'api'` / `'global'` / `'local'`                | Namespace segment isolating this limiter's counters in the shared store           |

Configuration is fixed at creation. A route that needs different limits
creates its own limiter with its own `overrides`.

```ts
const reportRateLimiter = createLocalRateLimiter({
  client: redis,
  logger,
  overrides: {
    points: 5,
    duration: 60,
    burst: { points: 10, duration: 15 },
    fallback: { points: 5, duration: 60 },
    prefix: 'reports',
  },
})
```

Fallback is independent of the primary window. Omit `fallback` to use the
factory default: 10 points per second for the base and global limiters, or 5
points per second for the local limiter. An override must provide both
`points` and `duration`.

Store keys live under `rate-limit:<prefix>:` (steady) and
`rate-limit-burst:<prefix>:` (burst).

`createBlockingRateLimiter` and `createAuthnRateLimiter` instead accept
`defaults` with `points` (failure allowance), `duration` (counting window),
`block: { duration }` (block length in seconds), and `prefix`. Their store keys
live under `rate-limit-block:<prefix>:`. The authn wrapper defaults to
`{ points: 100, duration: 3600, block: { duration: 3600 }, prefix: 'authn' }`.

See the [documentation website](https://kit.open.gov.sg/) for full API docs,
and [ADR-0009](../../docs/adr/0009-rate-limit-package-design.md) for the
request-limiter design rationale. See
[ADR-0011](../../docs/adr/0011-failed-authentication-rate-limiting.md) for the
failed-authentication threat model and policy decisions.
