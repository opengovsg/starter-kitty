# Logging

The structured-logging core: it standardises the log wire format and the
vocabulary every log line is built from. The glossary below names the parts of a
log line so they can be referred to consistently in code and review.

## Language

**Context**:
The structured key/value metadata bag attached to a single log line (the
`context` field). Distinct from general "request context" or "execution
context" — here it is specifically the queryable payload an engineer reads off a
log line.
_Avoid_: metadata, payload, data, fields

**Action**:
The single operation name a log line is tagged with, emitted as the `action`
field. Scoping sets the most-specific ("leaf") action; a per-call `action` wins
over it. Only that leaf is emitted — there is no ancestry or path.
_Avoid_: scope, trace, breadcrumb, history

**Context guard**:
The safeguard that keeps an oversized or unserialisable **Context** from
producing a malformed log line: it drops the offending **Context**, substitutes
a marker, and emits diagnostic lines describing what was removed. Lives in
`serializeContext` (`src/context.ts`).
_Avoid_: sanitiser, validator, limiter

**Audit event**:
A compliance-auditable business event — "who did what to which critical
resource" — drawn from a **closed, externally-governed taxonomy**
(authentication, permission change, data export, …), not from developer
convenience. Unlike a routine log line, its _required_ **Context** fields are
fixed and enforced at the type level; beyond those, the logger's scoped
**Context** and per-call **Context** merge in (low→high: scoped, event fields,
per-call) and pass the same **Context guard** as any line. "Enforced" means the
required keys are guaranteed, not that the bag is closed. It is the unit that
redaction and audit-retention apply to.
_Avoid_: audit log (ambiguous with the log store), event (too broad)

**Audit helper**:
A fixed-shape helper that records one kind of **Audit event**, enforcing that
event's required fields at the type level. Layers _above_ the base logger (which
never enforces **Context** keys). It does **not** transform values: secrets are
kept out by _shape_ (they are never fields), and PII is left to the sink. The
realisation of the "fixed-shape helper loggers" anticipated in ADR-0003 and
ADR-0005.
_Avoid_: category, structured logger, convenience helper

## Field tiers

Every log line is built from four tiers of fields. The names below are how we
refer to each tier; the wire field names themselves are flat `snake_case`.

**Base fields**:
Fields injected on **every** line that identify the deployment, not the
request — e.g. `env`, `service`, `version`. Fixed for the life of a process.
_Avoid_: global fields, tags, metadata

**Scope fields**:
Per-logger request metadata bound when a logger is created — e.g. `path`,
`user_id`, `trace_id`. Vary per request/unit of work, constant across the lines
a given logger emits.
_Avoid_: request fields, bindings

**Controlled fields**:
Top-level fields the logger owns and reserves — `level`, `message`, `timestamp`,
`action`, `error`, `context`. Callers cannot overwrite them; business
data goes in **Context**, never at the top level. Some are conditional, not on
every line (`error`; and the audit trio below). An **Audit helper** stamps three
further Controlled fields, present only on audit lines: `audit` (the boolean
marker the sink routes on — see WORM/centralised storage), `category` (the
closed-taxonomy group, e.g. `authn`), and `event` (the specific audit event,
e.g. `loginFailed`). These are reserved precisely because the caller cannot set
them, so they never live in **Context**.
_Avoid_: reserved fields, system fields

**Context**: the business-data bag — see above. App-owned and free-form: the
base never enforces its keys. Helper loggers that standardise a specific
**Context** shape layer _above_ the base and are out of scope for it.

## Conventions

**Structured-first**:
The convention that every log call passes a `message` plus structured fields —
never values interpolated into the message string. Queryable data goes in
**Context** (business data) or **Scope fields** (request metadata), so the
`message` stays a stable, low-cardinality string.
_Avoid_: string logging, printf-style, message formatting

## Example dialogue

> **Dev:** The widget line is huge — is that the whole record in there?
>
> **Reviewer:** That's the **Context**. If it gets past 200kB the **Context
> guard** drops it and you'll see a "Removed context" line instead.
>
> **Dev:** And `action: "validateEmail"`?
>
> **Reviewer:** That's the **Action** — the leaf operation. Scoping set it (or a
> more specific per-call `action` won); only that one name is emitted, no path.
