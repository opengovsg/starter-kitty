# 11. Failed-authentication rate limiting

Date: 2026-07-21
Status: Accepted

## Context

[ADR-0009](./0009-rate-limit-package-design.md) deliberately deferred
feature-specific rate limiting, and neither of its limiters covers failed
authentication attempts. The global limiter is far too permissive to slow
credential probing: an attacker sweeping scraped or candidate API keys at
50 requests per second stays comfortably under 100/s per IP forever, while
enjoying an unlimited validity oracle and pushing a credential lookup onto the
database for every guess. The local limiter cannot help either, because before
authentication succeeds there is no actor to key on.

The structural gap is that both existing limiters count _requests_. Protecting
an authentication path requires counting _outcomes_: a limiter that charges
only for failed verification, so that legitimate traffic — which fails rarely —
never pays, while a probe or a retry storm accumulates evidence fast.

"Failed authentication" covers three shapes that cluster differently:

- **Password login**: a low-entropy secret guessed against a known account.
  Per-account counting, lockout-as-denial-of-service, and user enumeration
  dominate the design.
- **OTP verification**: the same problem in extreme form (a 10^6 keyspace
  needs single-digit attempt budgets per issued code).
- **API credentials** (API keys, bearer tokens, webhook signatures): a
  high-entropy secret with no stable target identity. Guessing a specific key
  is cryptographically infeasible, so the realistic threats are probing many
  candidate keys, abusing the API as a validity oracle for leaked keys, and
  retry storms of dead credentials.

This ADR introduces the failure-counting primitive shared by all three shapes
and prescribes the API-credential recipe in depth. Password and OTP
verification protection are future consumers of the same primitive. Their
policy questions (lockout denial of service, enumeration-safe responses,
unlock flows) are deferred. Throttling OTP _requests_ (how often a code may be
sent) remains out of scope entirely: it counts requests rather than failures,
and it is a cost-control problem, not a guessing problem.

## Decision

### Threat model: single-source failed-authentication floods

The recipe defends against a single source generating authentication failures
in volume: probing candidate or scraped credentials, using the API as a
validity oracle, or retrying a revoked key in a loop. Consistent with
ADR-0009, distributed attacks are named out of scope rather than half-solved:

- **Distributed probing** (many IPs, each testing different credentials at a
  low rate) trips no per-IP counter and no per-credential counter. That
  protection belongs to the CDN/WAF layer.
- **Distributed retry storms of one dead credential** (a revoked key baked
  into a deployed fleet) are only caught by a counter keyed on a hash of the
  presented credential. The ADR documents that pattern as an optional
  extension for services with expensive verification — it collapses the storm
  into one counter regardless of source, and it cannot be weaponised to lock
  out a valid key, because presenting the victim's real credential succeeds
  and never increments — but it is not prescribed: it costs a second store
  operation per failure, requires the caller to hash the presented credential,
  and does nothing against probing (each candidate is presented once, so no
  hash-key ever accumulates).
- **Brute-forcing the keyspace of a specific credential** is not a threat the
  package defends. It is a precondition the package documents. The per-IP
  recipe below is sufficient _because_ credentials are assumed to be
  high-entropy (at least 128 bits of randomness). An attacker facing such a
  keyspace gets nowhere without enumerating fast, and enumerating fast is
  exactly what a failure counter catches. Services minting low-entropy or
  guessable credentials need the deferred per-account machinery instead.

### A failure-counting primitive: `createBlockingRateLimiter`

The generic core takes an arbitrary string key, like `createRateLimiter`, and
exposes three methods the caller places around its own verification logic:

- **`isBlocked(key)`** — a read-only precheck before verification. It throws
  `RateLimitExceededError` when the key is blocked and otherwise mints no
  keys and consumes nothing. Read-only matters under attack: an
  unauthenticated flood must not turn every probe into a Redis upsert, and
  garbage keys must not be created for traffic that never records a failure.
- **`consume(key)`** — a single atomic increment, called after the
  caller's verification fails. Atomicity is a correctness requirement, not an
  optimisation: express-brute died of a read-modify-write counter race
  (GHSA-984p-xq9m-4rjw) that allowed concurrent requests to slip past the
  limit, and no fix ever shipped.
- **`reset(key)`** — deletes the key's counter. The API-credential
  recipe below deliberately never calls it, but the primitive ships it now
  because the deferred per-account consumers need NIST-style reset-on-success
  (SP 800-63B-4 §3.2.2), and adding it later would make the password ADR a
  surface change rather than a pure recipe.

Verification itself stays in the caller's hands. Only the app knows what a
failure means — a revoked key, a bad signature, a malformed token — and a
callback wrapper that guessed (thrown error? `null` return?) would impose a
contract the package cannot get right for every framework.

The `isBlocked` → verify → `consume` sequence is deliberately not
transactional, and the gap it opens is accepted rather than papered over:
requests already in flight when a block engages have passed the precheck,
still reach verification, and a valid credential among them still succeeds
without consuming anything. The leakage is bounded — one batch of concurrent
requests, whose size the global limiter already caps upstream — and it does
not recur while the block holds. The alternatives cost more than they
recover: reserving a point before verification and refunding on success puts
a write and a minted key on every request including the happy path (exactly
the cost profile the read-only precheck exists to avoid), and serialising
verification per key would make the limiter a lock service. The
`rate-limiter-flexible` login recipe accepts the same window for the same
reasons.

The penalty model is a fixed allowance with a block duration: a key may
accumulate its configured allowance of failures within the window, and the
failure that exceeds the allowance blocks the key for a configurable period,
set independently of the counting window. This maps directly onto
`rate-limiter-flexible`'s native `blockDuration` and needs no extra state.
Progressive escalation (Keycloak's growing waits, fail2ban's exponential
bans) earns its complexity in human login flows, where a fat-fingering user
deserves gentler treatment than a script. Machine credentials have no such
UX, and escalation would require violation-history storage beyond the
dependency's primitives. It can arrive in a later ADR if evidence demands it.

There is no burst composition. ADR-0009's steady-plus-burst design exists to
absorb legitimate spikes, and there is no legitimate burst of authentication
failures worth absorbing.

### The authn limiter: `createAuthnRateLimiter`, keyed by client IP

The opinionated wrapper keys the primitive on the client IP and reuses
ADR-0009's IP hygiene verbatim: `ipaddr.js` parsing and normalisation, IPv6
bucketing by /64 prefix, the shared `unknown` bucket for null or unparseable
IPs, and app-owned IP extraction with the same spoofing warning and
per-deployment recipes. The name says "authn" precisely: authorisation
failures never count (see below).

One inherited rule carries higher stakes here and is accepted with eyes
open: under the global limiter the `unknown` bucket self-heals every second,
but under a one-hour block, an hour's worth of presented-but-invalid
credentials from unidentifiable sources locks every unknown-IP client out of
authentication for an hour. That remains the protective failure mode —
systematically broken IP extraction should surface loudly, and the
request-scoped null-IP warning ADR-0009 prescribes already points at the
cause — but deployments should treat unknown-bucket warnings on the
authentication path as urgent.

The default is **an allowance of 100 failures per hour per IP. The failure
that exceeds it engages a one-hour block** (following the dependency's
semantics, the counter blocks when consumed points _exceed_ the allowance,
so the block engages on the 101st failure within the window):

- **Permissive enough for shared egress.** A tripped block rejects _all_
  authentication attempts from that IP, valid credentials included, so a
  false positive locks an entire office NAT out of the API until the block
  expires. A deploy blip (a few dozen failures from a stale key) never
  reaches 100, and a misconfigured cron retrying a dead key once a minute
  stays under the threshold indefinitely — tolerated as noise rather than
  blocked, which is the intended trade. A client retrying every few seconds
  trips the block within minutes and gets a bounded one-hour timeout rather
  than losing the day. Day-long suspensions (the published Auth0 and
  `rate-limiter-flexible` recipe anchors are 100/day) were rejected: shared
  and rotating NAT egress makes a 24-hour lockout too risky for the
  institutional traffic these services carry.
- **Still fail2ban-shaped against the attacker that matters.** Against
  high-entropy credentials the only viable attack is fast enumeration, and a
  fast enumerator burns its allowance in seconds and spends the rest of
  every hour blocked — capped at 101 probes per IP-hour, which is
  economically dead against a 2^128 keyspace.

Blocking valid credentials along with invalid ones is deliberate, not
collateral. GitHub's API applies the same principle (after repeated bad
credentials it temporarily rejects even valid authentication for the
targeted account — keyed on the account rather than the IP, but accepting
the same trade), because it is what actually denies the attacker a validity
oracle: if valid credentials kept working during a block, a probe that _hit_
would reveal itself by succeeding.

### What counts as a recordable failure

The recipe prescribes: **a credential was presented and failed
verification** — unknown, revoked, malformed, expired, or carrying a bad
signature. That includes failed webhook signature checks, closing the item
ADR-0009 explicitly deferred. Two boundary cases never count:

- **No credential at all.** A missing `Authorization` header carries no
  guessing signal — "you need a credential" is public information, there is
  no oracle to protect — and internet background noise (scanners, misrouted
  health checks, credential-less probes) would otherwise burn a shared NAT's
  failure budget toward a block that also locks out valid keys. The global
  limiter already caps the volume of such traffic.
- **Insufficient permissions.** A well-formed credential that verifies but
  lacks a scope (a 403, not a 401) proves possession of a real credential.
  Counting it punishes legitimate integrators for authorisation mistakes.

### No reset on success in the recipe

The authn limiter never calls `reset`, and the omission is a
decision. Reset-on-success on an IP-keyed counter is a bypass: an attacker
holding any one valid credential — a free-tier signup, their own legitimate
key — could interleave a successful call every 99 probes and reset their own
counter forever. Less adversarially, healthy clients behind a shared NAT
succeed constantly, which would continuously erase the evidence accumulating
against one misbehaving client on the same IP. Failures age out only by
window expiry.

This matches the precedent: NIST's reset-on-success guidance (SP 800-63B-4
§3.2.2) is scoped to the specific authenticators used in the successful
authentication — nothing like a pure IP key, which aggregates failures from
many unrelated credentials and sources that one success says nothing about —
and the `rate-limiter-flexible` login recipe deletes its fine-grained
username+IP key on success while deliberately leaving its coarse per-IP
counter untouched. The deferred per-account consumers will call `reset` on
counters scoped to what actually succeeded. The IP-keyed one must not.

### Rejection, headers, and response shaping

A blocked `isBlocked` throws the existing `RateLimitExceededError`, and
`constructRateLimitHeaders` derives `Retry-After` exactly as for the other
limiters. The app returns 429. No new error type: the caller placed `isBlocked`
itself, so it already knows which limiter rejected, and a distinct class
would add surface without information. An honest 429 is safe here — the
enumeration concerns that push account-keyed lockouts toward
indistinguishable 401 responses do not apply to an IP-keyed block, which
reveals nothing an attacker does not already know about their own request
rate.

The documentation carries the response-shaping guidance the limiter cannot
enforce: failed verification itself should return a uniform 401 that does not
distinguish "credential never existed" from "credential revoked", because the
difference is a validity oracle.

### Observability: one warning when a block engages

The `consume` call that transitions a key from counting to blocked emits one
warning through ADR-0009's logger machinery, carrying the bucket, the
failure count, and the block duration. Because the warning fires inside
`consume`, the request-scoped delivery follows ADR-0009's per-call
convention: `consume` (like `isBlocked`) accepts an optional per-call
logger, falling back to the factory one — the limiter retains no request
state between the two calls, so a caller wanting request identity on the
block warning passes the logger to `consume` itself. One line per incident
is alertable in both directions that matter: as a security signal (someone
behind this IP burned a hundred bad credentials in an hour) and as a
false-positive alarm (the office NAT just locked itself out, and valid
credentials are being rejected). Rejected checks during the block stay
silent — the 429 is the signal, and a retry storm must not turn the logger
into the load.

### Inherited machinery

Everything ADR-0009 established applies unchanged: every Redis-backed window
carries an insurance limiter and degrades to per-instance counters during
Redis outages, a memory-only fallback serves tests and single-instance
deployments, configuration and request warnings follow the two-scope logger
convention, apps sharing one Redis set a distinct `prefix`, and safe adoption
uses the documented shadow-mode recipe (catch, log, admit) rather than a
`dryRun` flag.

One inherited property bites harder for a block than for a request counter,
and is stated here rather than left implicit: an active block does not survive
a Redis outage. The insurance limiter is consulted only while Redis is
unreachable, so it never observes the failures a healthy Redis recorded — a key
Redis had already blocked is invisible to the in-memory limiter during an
outage, and `isBlocked` reads the cold insurance counter, finds nothing, and
admits the request. The blocked source regains a full per-instance allowance
until Redis recovers, at which point the original block resumes only if its TTL
outlived the outage. The leak is bounded — each instance re-accumulates the
allowance before re-blocking, and the global limiter still caps total volume —
but an outage is exactly when probing is cheapest, so a deployment that leans on
the block as a hard security boundary should alert on Redis availability, not
only on the block warning.

The prescribed mounting order extends ADR-0009's map: probes → global
limiter → **authn limiter `isBlocked` → credential verification →
`consume` on failure** → local limiter. The authn limiter reuses the
same extracted client IP the global limiter receives.

## Consequences

- Authentication paths get a failure-selective limiter the global limiter
  cannot substitute for: legitimate traffic pays one cheap read per request,
  while probing and retry storms accumulate toward a real block.
- The package's protection stays honest: distributed probing and distributed
  retry storms are named out of scope, high-entropy credentials are a stated
  precondition, and the per-credential-hash extension is documented rather
  than half-prescribed.
- A tripped block rejects valid credentials from the blocked IP. That is the
  price of denying a validity oracle, and it is why the default threshold is
  permissive and the block bounded at one hour. Deployments serving large
  shared-egress institutions should measure and raise the threshold rather
  than trust it blindly.
- The password and OTP-verification ADR inherits a primitive already shaped
  for it (`reset`, arbitrary keys) and owes only policy: key
  composition (account, account+IP), thresholds, and enumeration-safe
  response semantics.
- Webhook signature-check throttling — deferred by ADR-0009 — is covered by
  the recipe: a failed signature is a presented-but-invalid credential.
- Consumers own the placement of `isBlocked`/`consume` around their
  verification logic and the uniform-401 response shaping. The package
  documentation carries the recipes.
