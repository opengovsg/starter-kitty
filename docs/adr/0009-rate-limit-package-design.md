# 9. Rate-limit package design

Date: 2026-07-14
Status: Accepted

## Context

OGP product teams keep re-implementing near-identical rate limiters:
`rate-limiter-flexible` counters in Redis via an injected `ioredis` client, an
in-memory limiter as a safety net, a fingerprint scheme for keys, and a
429-with-retry-hint on rejection. Each copy re-decides the same subtle
questions (what to key on before auth, how to handle Redis outages, how to
avoid false positives on bursty-but-legitimate traffic) and some copies answer
them less safely than others.

`@opengovsg/rate-limit` exists to make the well-trodden path the
default one: a framework-agnostic core with the safe answers built in.

## Decision

### Threat model: single-source floods only

The package defends a server against a single source (or a small set of
sources) generating excessive load: a runaway script, one abusive client, a
retry storm from a misbehaving integration. Distributed floods are explicitly
out of scope. A per-IP limiter cannot stop a thousand IPs each sending a
modest rate, and claiming otherwise would be false comfort. That protection
belongs to the CDN/WAF/infrastructure layer in front of the application.

Feature-specific rate limiting — throttling OTP requests, protecting login
endpoints against brute force or denial of service, slowing credential
stuffing — is likewise out of scope and deferred to a future ADR. Neither
limiter below covers it: the global limiter is far too permissive to slow
password or OTP guessing, and the local limiter has no stable actor to key on
before authentication succeeds (the client IP is the wrong key for protecting
a targeted account).

### Two categories of limiter: before and after authentication

The package ships two opinionated limiters rather than one, because a single
limiter cannot protect both of the things that need protecting:

- **`createGlobalRateLimiter`** — keyed purely by client IP, mounted **before**
  authentication. Authentication is not free: verifying a session, an API key,
  or an OTP typically hits critical infrastructure such as the database. A
  per-user limiter engages only _after_ identity is established, so it can do
  nothing about an unauthenticated flood — by the time it could act, the DB
  has already served every credential lookup. The global limiter is coarse and
  cheap, and its only job is to stand in front of that infrastructure.
- **`createLocalRateLimiter`** — keyed by `actor` + `resource`, mounted
  **after** identity exists. This is the fairness limiter: each actor (user
  ID, API-key ID, hashed bearer token — the caller decides, and hashes secrets
  itself) gets an independent quota per resource, so one noisy client cannot
  starve the rest, and expensive routes can carry stricter per-call overrides.

`createRateLimiter` remains exported for shapes the two categories don't
cover (e.g. a limiter used as a database write throttle).

### The global limiter: 100 points per second per IP, no burst

The default is deliberately permissive, for two reasons:

- **Shared egress IPs are normal traffic.** Institutional users — an office or
  a school behind one NAT egress IP — are hundreds of humans sharing a single
  bucket. A default tight enough to catch low-rate abuse would 429 exactly the
  users a government service least wants to reject. Deployments serving large
  institutions during traffic spikes should measure aggregate per-IP rates and
  raise the default rather than trust it blindly.
- **The pre-authentication path must stay cheap.** The global limiter runs on
  every request, so it forgoes the burst composition used by the local limiter.
  A bursty composition consults the burst window only when the steady window
  rejects — which under a flood is every check, so the extra Redis operation
  lands exactly when Redis is most stressed. And a 1-second window is already
  spike-tolerant because it fully resets every second, so a burst layer buys
  little here in the first place.

The IP-handling rules close known holes:

- **IP parsing and normalisation use
  [`ipaddr.js`](https://github.com/whitequark/ipaddr.js).** This keeps IPv6
  expansion, zone IDs, and embedded IPv4 handling out of a custom parser.
  Equivalent dotted and hexadecimal spellings of an IPv4-mapped IPv6 address
  are normalised to the embedded IPv4 address so they share one bucket. This
  safe behaviour is the default. `validate: false` is an explicit escape hatch
  for callers that already hold a trusted, canonical key. It uses non-null
  strings verbatim, including invalid strings, and disables both mapped-address
  normalisation and /64 bucketing. It must not receive attacker-controlled or
  unnormalised input. A `null` value still uses the `unknown` bucket.
- **IPv6 is bucketed by /64 prefix** (IPv4 stays per-address). A residential
  IPv6 subscriber typically holds an entire /64 — 2^64 addresses — so
  per-address keying would hand an attacker a fresh bucket on every request
  simply by rotating source addresses within their prefix. A /64 bucket is
  coarse enough to close the rotation hole and fine enough that distinct
  subscribers rarely share one.
- **A `null` or unparseable IP falls into a shared `unknown` bucket** rather
  than being exempted or allowed to mint fresh buckets from
  attacker-controlled input, and each such check emits a request-scoped
  warning. If IP
  extraction breaks systematically, all traffic funnels into one bucket and
  starts getting rejected — which is protective, but the warning ensures the
  logs point at the cause ("client IP extraction returned null") rather than
  leaving user-facing 429s as the only symptom.

### The local limiter: `resource` is a route identity, not a URL

The local limiter's key is `actor:resource`, and `resource` must be a
_normalised route identity_: an Express route template (`/users/:id`), a tRPC
procedure name — never the raw request URL. Keying on raw URLs makes every
parameter value its own bucket, which fragments an actor's quota (defeating
the limit), grows Redis key cardinality without bound within each window, and
breaks per-route overrides. The parameter is named `resource` rather than
`path` precisely so it does not suggest `req.path`.

The default window is 50 points per 10 seconds with a burst allowance of 20
per 30 seconds: roughly 5 requests per second sustained, per actor per
resource. That is generous enough that legitimate chatty clients (a page load
firing parallel calls, a polling UI) rarely trip it, and tight enough that a
runaway client loop is stopped within seconds. The default only needs to be
safe for the median route. Expensive routes override downward (see below).

### Expressing per-route cost

Two mechanisms carry cost, each with a prescribed role:

- **A route's inherent cost** is expressed as a per-check `options` override
  at the mount site — e.g. a report-generation route passes
  `{ points: 5, duration: 60, burst: null }` instead of riding the default.
  Because each `actor:resource` pair is its own bucket, the override shapes
  that route's window without affecting any other. Note that an override
  inherits the limiter's default burst unless it disables or replaces it — a
  tightened steady window with the default burst left in place is looser than
  it looks. Keeping the override at the mount site keeps limits colocated
  with route definitions, where reviewers see them.
- **Variable cost within one request** is expressed via `points` — e.g. a
  batch endpoint charges one point per item, so a 30-item batch consumes 30
  points of the same allowance a single-item call draws 1 from.

### A steady window composed with a burst allowance

A single fixed window forces a bad trade-off. Sized tight (say 5 points/1 s),
it false-positives on legitimate spikes — a page load firing several parallel
API calls, or many users behind a shared IP or NAT. Sized loose (50 points/1 s),
it tolerates a sustained 50 rps from one client. Composing two windows
resolves the tension: a steady window measured over a longer period keeps the
_average_ rate honest, while a short-lived burst allowance (via
`BurstyRateLimiter`) absorbs the occasional flurry without loosening the
sustained rate.

Burst is configured as a nested `burst` object: omitted, it inherits the
limiter's default. Explicitly `null`, it is disabled and the plain steady
limiter is used (no zero-point burst window standing in as "off").

### Mounting order, including the awkward traffic classes

The baseline order is **global limiter → authentication → local limiter**, and
the package documentation prescribes stances for the traffic classes that
don't fit it:

- **Health and readiness probes** mount _before_ the global limiter. Probes
  arrive at high frequency from infrastructure IPs — often with no extractable
  client IP, so they would otherwise drain the shared `unknown` bucket and
  emit a warning per probe — and a rate limiter that fails a load balancer's
  health check turns itself into the outage.
- **Public but expensive routes** (public search, unauthenticated content
  APIs) have no authenticated actor. They use the local limiter with `actor`
  set to the client IP: still behind the global limiter, but with a
  route-appropriate budget.
- **Webhooks** carry a verifiable machine identity rather than a session.
  After signature verification, `actor` is the verified source's identity.
  Throttling _failed_ signature checks belongs to the deferred
  feature-specific ADR.

### IP extraction is the app's responsibility

The global limiter takes an `ip: string | null` and never reads headers
itself (the anonymous-actor recipe above reuses the same extracted IP),
because the trusted source of a client IP depends on the deployment: how many
proxies sit in front of the app, and which of them the app may believe. A
package default that trusted `X-Forwarded-For` blindly would let any client
mint fresh buckets per request by setting the header — a spoofing hole worse
than shipping no helper. The package documentation instead spells out the
risk and gives per-deployment recipes (e.g. Express `trust proxy` with an
explicit hop count) for producing a trustworthy IP to pass in.

### An in-memory limiter is always present

The in-memory limiter plays two distinct roles, and both are deliberate:

- **Insurance during Redis outages.** Every Redis-backed window is created
  with `rejectIfRedisNotReady` and an `insuranceLimiter` of the same
  dimensions. When Redis is down or failing over, enforcement degrades to
  per-instance counters instead of either failing every request (the rate
  limiter must not become the outage) or waving all traffic through
  (an outage must not disable protection). Degraded limits beat none.
- **Fallback when no client is configured.** With no `client`, the limiter is
  memory-only. This gives tests, local development, and single-instance
  deployments a zero-infrastructure path. The trade-off is surfaced through the
  optional factory `logger` when wired: it fires noting that limits are
  per-instance and not shared across replicas.

Errors that are neither a limit rejection nor absorbed by the insurance
limiter are reported to a `logger` and rethrown as-is. Whether to fail open or
fail closed is a product decision the package must not make: the same app may
reasonably swallow store errors on ordinary routes yet treat them as fatal on
its authentication path, and no factory-level default can express that.

### Warnings are delivered at two scopes

The package emits non-fatal warnings through an injected `logger` (a structural
`{ warn }` interface — any structured logger satisfies it, and the package keeps
no logging dependency, per [ADR-0002](./0002-logging-factory-no-global.md)),
delivered at two scopes because the warnings are of two kinds. **Configuration**
warnings (no client configured) describe the limiter, fire once per
configuration, and go to the factory `logger` — wired to a base/system logger.
Out-of-range values are silently clamped to a safe minimum. **Request**
warnings (an unexpected store error, a `null` client IP) happen on a single
`check` and go to an optional per-`check` `logger`, falling back to the factory
one.
This lets the caller pass a request-scoped logger so those warnings carry
request identity (path, user, client IP) — matching the org's per-request
logger convention — rather than forcing every warning onto a single
factory-time handler. (Trace correlation is preserved regardless via dd-trace
log injection. Only the request-scoped fields depend on the per-`check`
logger.)

### `Retry-After` is the only response header

`constructRateLimitHeaders` derives a `Retry-After` value and nothing else.
It is the one header a well-behaved client actually needs (when to come back),
it is a stable RFC standard, and its meaning stays unambiguous under the
steady-plus-burst composition. The `RateLimit-*` family is deliberately
omitted: those fields are still an IETF draft whose semantics have shifted
between revisions, two composed windows produce two different "remaining"
values (whichever is emitted misleads half the time), and advertising exact
thresholds helps an abusive client pace itself just under the limit.

### Safe adoption is a documentation concern, not an API flag

Existing production apps adopting limits need to know what enforcement would
reject before turning it on. The package ships no dry-run mode. Instead, the
documentation provides a shadow-mode recipe — catch `RateLimitExceededError`,
log it with the request identity, and admit the request — that teams run for a
tuning period before removing the catch. This keeps the enforcement code path
single and makes the temporary nature of shadowing visible in the app's own
code rather than in a flag that can be forgotten.

### Structural decisions, briefly

- **Wrap `rate-limiter-flexible` (v11), don't hand-roll.** Atomic Redis
  counters, insurance failover, and the bursty composition are already solved
  and battle-tested there.
- **A factory, not a static class bound to a module singleton.** Following
  [ADR-0002](./0002-logging-factory-no-global.md), the library owns no global
  state: `createRateLimiter({ client })` closes over an injected client, and
  the app owns the const. Underlying limiter instances are memoized per
  configuration inside each factory.
- **An owned error type, no leaked internals.** Rejections surface as
  `RateLimitExceededError` with a `RateLimitInfo` snapshot. The dependency's
  `RateLimiterRes` never appears in the public API, and is detected internally
  by shape rather than `instanceof` (a dual CJS/ESM package can be loaded
  twice, breaking `instanceof` across copies).
- **No framework or transport adapters.** Express/tRPC middlewares stay in the
  consuming app (documented as examples). The two opinionated limiters own key
  construction, and consumers hash secret-derived actors themselves.
- **Apps sharing one Redis must namespace.** The default `global`/`local`
  prefixes would collide across two services on the same Redis. Such apps set
  a distinct `prefix` (or an `ioredis` client-level `keyPrefix`).

## Consequences

- Apps get shared-by-default, replica-safe rate limiting by passing one
  `ioredis` client, and a documented mounting map: probes → global limiter →
  auth → local limiter, with prescribed stances for anonymous and webhook
  traffic.
- The pre-auth/post-auth split is explicit API, so the "per-user limiter that
  never protected the DB" failure mode is harder to reproduce.
- The package's protection is honest about its limits: distributed floods and
  feature-specific rate limiting (OTP requests, login brute force) are named
  as out of scope, the latter deferred to a future ADR, so teams know what
  they still owe.
- Memory fallback means the package works with zero infrastructure, at the
  cost of per-instance limits — surfaced through the optional factory `logger`
  when one is wired.
- Consumers own 429 response shaping (status, body, headers) using the error's
  fields. The package stays HTTP-framework-neutral.
- Consumers own client-IP extraction. The documentation carries the spoofing
  warning and per-deployment recipes that make that safe.
- `ioredis` is an optional peer dependency. Memory-only consumers install
  nothing extra.
- Existing hand-rolled limiters can migrate incrementally: a static limiter
  service is a thin shim away from `createRateLimiter`, whose
  `check({ key, options, points })` shape matches the call sites such
  services typically expose.
