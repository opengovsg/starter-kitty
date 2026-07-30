# 11. Failed-authentication rate limiting

Date: 2026-07-21
Status: Accepted

## Context

Neither limiter in [ADR 0009](./0009-rate-limit-package-design.md) covers
failed authentication. The global rate limiter counts every request regardless
of outcome, and its quota is too generous to throttle brute force. The local
rate limiter is installed after authentication.

Failed authentication generally covers three shapes:

1. Password login
2. OTP verification
3. API credentials (API keys, bearer tokens, webhook signatures)

This ADR ships the failure-counting primitive shared by all three and
prescribes the API-credential path. Password login and OTP verification
policies are out of scope.

## Decision

### Threat model: single-source failed-authentication floods

The limiter defends against one source generating authentication failures in
volume, such as an attacker probing candidate credentials. As in ADR 0009,
distributed attacks are out of scope. Credentials are assumed to be of
sufficient entropy, so the only viable attack is fast enumeration.

### A failure-counting primitive: `createBlockingRateLimiter`

The core primitive takes an arbitrary string key and exposes three methods the
caller places around its own verification logic:

- **`isBlocked(key)`** reads the key's state before verification and throws
  `RateLimitExceededError` when blocked. It never consumes a point.
- **`consume(key)`** records one failed verification as a single atomic
  increment.
- **`reset(key)`** deletes the key's counter and any active block, for
  consumers that limit only consecutive failures.

There is no progressive escalation and no burst composition. Escalation only
earns its complexity in human login flows, and there is no legitimate burst of
authentication failures.

### The `isBlocked`, verify, `consume` sequence is not transactional

Requests already in flight when a block engages still reach verification. The
leak is bounded to one batch of concurrent requests, which the global limiter
already caps. The alternative, reserving a point before verification and
refunding on success, would cost a write on every request.

### Defaults: 100 failures per hour, blocked for one hour

`createAuthnRateLimiter` wraps the primitive with the client IP as the key,
reusing ADR 0009's IP hygiene. It defaults to **an allowance of 100 failures
per hour per IP. The failure that exceeds it engages a one-hour block**:

- **100 per hour** keeps one misconfigured client from blocking a whole IP. A
  block rejects all authentication from the IP, valid credentials included,
  and a deploy blip of a few dozen failures never reaches the threshold.
- **A one-hour block** keeps a false positive short. A client that does trip
  the block locks out its IP for an hour, not a day. A 24-hour block was
  rejected as too risky for shared and rotating egress.

An enumerator is still capped at 101 probes per IP-hour, useless against a
high-entropy keyspace.

### Blocking of valid credentials

If valid credentials kept working during a block, a probe that hit would
reveal itself by succeeding, handing the attacker a validity oracle.

### Definition of failed authentication attempts

Consumers control the definition of a failed authentication attempt, so the
package does not prescribe one. In general, malformed, invalid, and expired
credentials should count. Requests that fail webhook signature checks may also
count.

### No reset on success

The authn limiter never calls `reset`. On an IP-keyed counter,
reset-on-success is a bypass: an attacker with one valid credential can reset
their own counter while probing for other credentials.

A reset flow suits the human-in-the-loop password and OTP flows, which remain
out of scope.

### Logging on block

A warning is logged on the `consume` call that triggers a block rather than
the `isBlocked` call, so that a single log line is emitted per block.

### Inherited machinery

Everything ADR 0009 established, including the insurance limiter and the
memory-only fallback, applies unchanged.

Notably, a block does not survive a Redis outage, since the insurance limiter
never saw the failures Redis recorded.

As in ADR 0010, alerting when the insurance limiter is in use is deferred to a
subsequent ADR.

The mounting order extends ADR 0009's map: global limiter, then authn
`isBlocked`, then credential verification with `consume` on failure, then the
local limiter.

## Consequences

- A tripped block rejects valid credentials from the blocked IP. Deployments
  serving large shared-egress institutions should measure and raise the
  threshold.
- The password and OTP ADR inherits a primitive already shaped for it and owes
  only policy.
- Consumers own the placement of `isBlocked` and `consume` around their
  verification logic.
