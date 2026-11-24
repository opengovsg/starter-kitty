# 11. System loggers audit without a client

Date: 2026-11-24
Status: Accepted
Amends: ADR-0007 (fixed-shape audit helpers)

## Context

ADR-0007's audit events read shared identity from the logger's scope and emit a
loud diagnostic when a required field is missing. Every mutation-side event
(`resource.*`, `userManagement.*`, `configChange.*`, `dataAccess.*`) requires
both the actor (`user_id`) and the client (`client_ip`).

That fits a person acting through a request. It does not fit a background job
that writes application data as a **system actor**, for example a scheduled
feed that records metric values. Such a job runs on a `.system(...)` logger,
which by design has no client identity (ADR-0001: request-less loggers have no
`clientIp`/`userAgent`). Its mutations are still auditable — who (the system
actor), what, and which resource — but every such audit line arrived with a
`missing_scope: [user_id, client_ip]` diagnostic. The diagnostic fired on every
run, so it stopped meaning anything.

## Decision

A logger built with `.system(...)` is marked as a system logger, and the mark is
carried to every logger derived from it (`scope`, `withContext`,
`withBindings`).

When a system logger emits an audit event, the scope-read assertion skips the
**request identity** fields, `client_ip` and `user_agent`: a request-less
context cannot have them, so their absence is not a defect.

The actor stays required. A system writer binds its system actor's name as
`user_id`, for example `.withBindings({ userId: 'metrics-feed' })`, and a system
audit line without one still emits the diagnostic.

Request loggers are unchanged.

## Alternatives

- **A placeholder client on system loggers** (rejected) - bind
  `clientIp: 'system'` so the assertion passes. It puts a value that is not an
  IP in `client_ip`, which audit queries and IP-based tooling would misread.
- **No audit events on system loggers** (rejected) - system writes would vanish
  from the audit trail, though they change the same critical resources.
- **A separate system-actor audit category** (rejected) - duplicates every
  mutation event's shape for one difference in required scope.

## Consequences

- System-actor mutations produce clean audit lines that name the actor.
- A system logger that emits authentication or session events still needs no
  client, which is correct: those events belong on request loggers anyway.
- Callers that used `.system(...)` in tests to simulate a missing client must
  use a request logger with `clientIp: null` instead.
