# 7. Fixed-shape audit helpers

Date: 2026-06-24
Status: Accepted

## Context

ADR-0003 and ADR-0005 both end by pointing at the same future direction:
"fixed-shape helper loggers that standardise specific `context` shapes," layering
_above_ the base. ADR-0005 in particular defers all redaction to them — once a
helper fixes the shape of its `context`, redaction becomes a small, enumerable,
bounded-cost problem instead of an arbitrary-depth one. This ADR is that layer.

The driver is a compliance/audit standard: a **closed, externally-governed
taxonomy** of auditable events (authentication & session, user & permission
management, data access/movement/export, security-configuration changes, API
usage, security failures), each with a required field set. This is not a grab-bag
of "convenience helpers" — it is a curated set where every addition is a
governance decision, not a developer convenience. The taxonomy itself lives in
code and the README (it churns as the standard evolves); this ADR records the
durable principles only.

Two pressures shape the surface, the same pair ADR-0001 named: the API must be
**ergonomic** (or engineers route around it and the structure is lost) and
**queryable** (the lines feed dashboards, incident review, and a compliance
audit trail). Layered on top is a third: the API should make it **obvious at the
call site** that a call is a structure-enforced, compliance-weighted audit event,
not a routine log line.

## Decision

### The layer owns only app-emitted events; it disclaims the rest

The compliance matrix mixes three kinds of requirement, and only one is a helper:

- **App-emitted fixed-shape events** (the six categories above) — the helper
  layer. These are things the application _does_ and can log at the moment they
  happen.
- **Cross-cutting field requirements already met by the base** — "every line
  carries a correlation/request ID" is already the base Scope fields
  (`correlation_id`, `trace_id`); "source/destination addresses" are payload
  fields on the data-movement events. Nothing to build.
- **Operational / sink concerns the library cannot enforce** — centralised
  storage, WORM/immutable retention, SSO-gated read access, DevOps-only write
  access. A library emitting NDJSON to stdout has no leverage here; these belong
  to the sink (Datadog) and infra/IAM, documented in an ops runbook, not shipped
  as a method. Advertising them in the package surface would falsely imply the
  code controls them.
- **Detection, not emission** — "anomalous/high-volume API calls," "abnormal
  usage patterns." The app does not know a call is anomalous at log time;
  anomaly detection is a sink/SIEM monitor built _on top of_ the clean event
  lines. The package's job is to emit those lines, not to judge them.

Modelling the latter three as helpers would be a category error. The layer ships
the first kind only.

### `logger.audit.<category>.<event>(...)`

A single `audit` namespace at the root of `Logger`, then category, then the
specific event: `logger.audit.authn.loginFailed({ ... })`.

- **`audit` stays as a root namespace** (not dropped, not flattened onto the
  logger). It is the call-site expression of the wire marker the sink routes on
  (see below), it announces the compliance-weighted subsystem at the call site,
  and it is a single stable reservation on the deliberately-small `Logger`
  surface (ADR-0001) rather than splicing six category names directly onto it.
- **The category survives as a real path segment** for autocomplete-grouped
  discovery across a ~6-category / ~20-event taxonomy, and as a wire facet.
- **Naming rule: unambiguous over short.** A segment name _is_ the Datadog facet
  value _and_ the codebase grep term, so there is no abbreviation-to-wire mapping
  layer. Short is fine when unambiguous (`authn`, `mfa`, `pii`); ambiguous is
  not, regardless of length (`auth` conflates authn/authz; `failed` does not say
  what failed). Note `authz` is _not_ a safe mirror of `authn` here — it straddles
  permission administration and access-enforcement decisions, which live in
  different categories.

### The event spec is the unit of the design

Each event is a small spec — `{ category, level, payload-required fields,
scope-read fields }` — and the rest of this ADR is how each column behaves. The
taxonomy is a table of these specs. There is no "sensitive fields" column: the
helper does not transform values (see Redaction below).

### Field sourcing is per-event, split by timing relative to scope binding

A required field is sourced one of two ways, decided per event:

- **Payload-required (compile-enforced)** for events at or _upstream_ of identity
  being established — `loginSucceeded`/`loginFailed` _produce_ `user_id`; they
  cannot read it from a scope that does not have it yet.
- **Scope-read (runtime-asserted)** for events _downstream_ of authentication —
  `dataAccess`, `bulkExport`, `permissionChanged` run inside an already-scoped
  request and read shared identity from the bound scope.

So the same field (`user_id`) is payload-required for authn events and scope-read
for post-auth events. Where a field is scope-read, the helper **asserts at
runtime** that the required scope field is present and emits a diagnostic line
(the Context-guard pattern) when it is not — turning a missing compliance field
into a loud, queryable signal rather than a silent gap. A purely scope-reliant
model (no payload, no assert) was rejected: it degrades "required field present"
from a guarantee to a hope. A fully self-contained model (re-demand every field
in the payload) was rejected too: it duplicates Scope facets and invites
on-the-wire contradiction (`ip` in payload disagreeing with `client_ip`
in scope).

**`client_ip` / `user_agent` are _acknowledged_ at construction, _verified_ at
emit — two complementary layers.** The base logger's request shape
(`LoggerOptions`) makes `clientIp` and `userAgent` **required keys** (a compile
error if omitted), so a request logger can never _silently forget_ client
identity. But the values are `string | null | undefined` — a genuinely-missing
header (`headers.get(...)` returns `null`) is passed explicitly — so the value
may still be absent at emit. The scope-read assertion therefore _still fires_ its
diagnostic when the value is missing, even on a request logger: compile-time
guarantees the field was considered, runtime catches when it is actually absent.
(On the **system** logger path — `createLogging(...).system(...)`, startup/jobs/
cron — the fields don't exist at all, so the diagnostic also flags the mistake of
emitting an interactive-auth audit there.) `user_id` is unaffected — it stays
optional on both shapes, so its scope-read assertion (for admin events that
require an actor) is likewise a genuine runtime check.

**Required vs optional is decided by _architectural_ absence, not "not yet
wired".** A field is optional only when it genuinely cannot exist for a class of
the event — `session_id` is optional because stateless auth (e.g.
`iron-session`) has no session, full stop. A field that merely _might not have
been set up_ (a device fingerprint an app hasn't computed) is **not** made
optional: that would let the compliance signal silently vanish, defeating the
layer. Where a required signal is already carried by the base, the event
**reuses the existing Scope field** rather than adding a payload field — the
"device/browser fingerprint" requirement is satisfied by `user_agent` (always
present for interactive logins) plus `device_id` (where a dedicated fingerprint
is bound), scope-read, not a new `fingerprint` payload field. Truly
fingerprint-less auth (machine-to-machine) is a _different category_ (API auth),
not an optional hole in interactive login.

### Canonical fields land at their canonical position; payload wins, mismatch is flagged

When a payload field corresponds to a canonical wire field (`user_id`,
`client_ip`, `device_id`), the helper **promotes it to that top-level
position**, not into `context`. Burying `user_id` in `context.user_id` would file
the login line under a different facet than every downstream line and break
the very correlation category 7 requires. For authn events the payload is the
authoritative source, so **payload wins** over any (unexpected) scope value of
the same field, and a **mismatch emits a diagnostic** — silent disagreement on a
compliance field is the failure mode to avoid.

### `event` / `category` / `audit` are Controlled root fields, not context

The helper stamps three new **Controlled** fields (logger-owned, caller cannot
set them — the criterion for the tier, per ADR-0003): `event` (the specific
event, e.g. `loginFailed`), `category` (the closed-taxonomy group, e.g. `authn`),
and `audit: true` (the marker the sink routes audit lines to WORM/immutable
storage on). They are conditional — present only on audit lines — which is no
objection: `error` is already a conditional Controlled field.

- `event` is **distinct from `action`**. `action` keeps its meaning — the calling
  operation/function (the scoped leaf) — and `event` is the audited thing. They
  coexist on a line (`action: "verifyOtp"`, `event: "loginFailed"`).
- They are **not** placed in `context`. `context` is the app-owned, free-form bag
  (ADR-0003); injecting reserved keys into it breaks tier integrity and collides
  with app business keys (the reason `LogInput.context` already forbids `action`
  and `error`). The cardinality worry that motivates `context` does not apply:
  `category` and `event` are closed, low-cardinality enums and the marker is a
  boolean — exactly the curated facets root-level indexing is for, not the open
  bag ADR-0003 guards against.

### Level is fixed per event, drawn from `{ notice, warn }`

Severity is part of the event spec, not a call-site choice (which would let two
call sites of the same event disagree). Most events are `notice` — "the audit
rung" (ADR-0001). Security-relevant denials/failures (blocked export, denied
privilege escalation, unauthorised-access attempt) are pinned to `warn`
("something off but handled — the control fired"). The band is bounded on both
sides: never below `notice` (audit lines must survive the retention floor — see
ADR-0001's `level ≤ notice` invariant), and never `error` (an audit event is not
an operation failure; a system error _during_ an audited action is logged
separately via base `error()`).

### Redaction: forbid secrets by shape, defer PII to the sink — the helper does not transform

This is the ADR-0005 payoff, but it lands on **two** controls, not three. The
helper performs **no value transformation** (no hashing, truncation, or
censoring). Instead:

1. **Forbid raw secrets by shape.** Passwords, raw tokens, and raw API keys are
   simply _not fields_ — the type makes it impossible to pass them. This is
   _stronger_ than the "censor secret keys" ADR-0005 anticipated: a field that
   cannot be passed cannot leak, so there is nothing left to censor. "Don't log
   secrets," enforced by the compiler, is the primary control.
2. **Defer PII to the sink.** Identifiers that may be PII (`user_id`,
   `client_ip`, `username`, …) stay raw in code and are scrubbed at the sink
   (Datadog Sensitive Data Scanner) — by pattern, uniformly across base _and_
   audit lines. The sink is the only place value-pattern scanning is affordable
   and reliable (ADR-0005 rejected it on the hot path); doing it centrally also
   covers the base lines a helper could never reach.

An in-helper transform leg (deterministically hashing sensitive identifiers such
as `session_id` or `username`) was designed and **rejected**:

- It would have dragged a managed HMAC **key** (a pepper, plus rotation that
  breaks cross-time correlation) into a package that deliberately reads no
  secrets of its own — disproportionate machinery.
- Hashing a **free-text identity** field like `username` is _self-defeating_: the
  field exists so an investigator can read **who** acted; a hash blinds exactly
  the reader it is logged for.
- The remaining candidates are **not secrets by the layer's contract.**
  `session_id`/`token_id` are defined as non-impersonatable _references_; if an
  app's identifier can actually be replayed, hashing it before logging is the
  app's responsibility (e.g. `iron-session` is stateless — the credential is the
  sealed cookie, which is never a field, and any logged `sid` is app-minted).

No dormant transform hook is shipped. A field-level transform would be added only
as a real, user-invocable capability if a genuine must-log-but-must-mask field
ever appears — not as dead infrastructure (YAGNI).

### `.audit` lives on `Logger` only and is built lazily

`.audit` is exposed on the full server `Logger`, **not** on `BasicLogger`
(the shared client/server shape). Audit events are server-side — a browser
cannot redact, reach the WORM sink, or legitimately assert these events — so the
boundary is type-enforced: shared/client code cannot call audit helpers. The
namespace is attached via a **lazy, memoised getter**: loggers are created
per-request and the namespace is ~20 closures, so the common path (a request that
emits no audit event) pays nothing, and audit requests build it once.

## Consequences

- The base logger is unchanged; the audit layer is strictly additive and lives
  above it. ADR-0005 is updated to reflect that the helpers handle secrets by
  _forbidding them in the shape_ rather than by maintaining a censor list.
- Three new Controlled wire fields (`event`, `category`, `audit`) join the schema
  documented in ADR-0003. They are conditional (audit lines only) and
  low-cardinality, and the sink's WORM-routing / access-control rules (the
  unenforceable category-8 requirements) key off `audit: true`.
- "Required compliance field is present" is a **compile-time** guarantee for
  payload-required fields and a **runtime-asserted, diagnostic-on-miss**
  guarantee for scope-read fields — never silent.
- The helper does no value transformation: secrets are unrepresentable (not
  fields) and PII is a sink concern. This keeps the layer pure structure
  enforcement and adds no key management to the package.
- The taxonomy is a closed, governed set; adding an event is a deliberate change
  to the spec table, not an ad-hoc call. The category list is intentionally kept
  out of this ADR so the standard can evolve without ADR churn.
- `audit` is the first of potentially several **sibling helper namespaces**.
  Future non-audit, "good-to-have-logged" helpers (open taxonomy, low bar, no
  compliance weight) get their _own_ top-level namespace
  (e.g. `logger.track.*`), **not** a home under `audit` — the two families have
  opposite governance (closed/governed/redacted/WORM vs open/convenience), and
  merging them would dilute the audit set and forfeit the call-site and wire
  ("what is an audit line?") clarity that `audit` provides. The sibling is named
  when it first has members, not reserved speculatively.
