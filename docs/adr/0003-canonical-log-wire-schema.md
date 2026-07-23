# 3. Canonical log wire schema

Date: 2026-06-24
Status: Accepted

## Context

`@opengovsg/logging` emits newline-delimited JSON. The exact field
names and the set of fields present on every line are an interface in their own
right: dashboards, monitors, and incident queries are written against them, so
they are expensive to change once consumers depend on them. Until now the shape
was implied by the implementation rather than stated, and it had two gaps
against its de-facto target.

Signals in the code show the target sink is **Datadog**: `env` and `version` are
Datadog unified-tagging reserved attributes, `trace_id` and `error.kind` follow
Datadog conventions. But `service` — the third leg of unified tagging — was
absent.

A second open question was severity: Datadog's reserved attribute is `status`,
yet we emit `level`. It was unclear whether keeping `level` required consumer
configuration.

Root-level fields become indexed facets in Datadog, so the set of fields present
on every line is also a **cost** decision: an unbounded set of root attributes
drives cardinality and spend.

## Decision

### Anchor: Datadog-aligned, flat `snake_case`

Wire fields are flat (not dot-nested as in ECS) and `snake_case`. Each wire field
has one canonical name — `user_id`, never `uid` / `userId` / `user`. The
TypeScript input that maps to a wire field is idiomatic camelCase (`userId` →
`user_id`); the mapping lives in `bindChild` and the input is discoverable
through `LoggerOptions`.

ECS (dot-namespaced) and a vendor-neutral/OTel shape were rejected: both diverge
from every existing signal and would restructure the flat shape for no current
benefit.

### Four field tiers

Every line is built from four tiers (named in `CONTEXT.md`):

- **Controlled** — `timestamp`, `level`, `message`, `action`, `history`,
  `error`, `context`. Reserved; callers cannot overwrite them.
- **Base** — `env`, `service`, `version`. Identify the deployment; fixed per
  process. A curated set, not an open bag.
- **Scope** — `path`, `user_id`, `trace_id`, `source`, etc. Per request.
- **Context** — the free-form, app-owned business bag.

### `level` stays — Datadog classifies it natively

Datadog's JSON log preprocessing ships with a default status-attribute list of
`status`, `severity`, `level`, `syslog.severity`, read in order. `level` is
therefore mapped to the official log status **out of the box**, with no remapper
or pipeline configuration. We keep `level` (uppercased): no `status` rename, no
duplicate field, no dashboard churn.

- [Pipelines — Preprocessing for JSON logs](https://docs.datadoghq.com/logs/log_configuration/pipelines/)
- [Logs show INFO status for warnings or errors](https://docs.datadoghq.com/logs/guide/logs-show-info-status-for-warnings-or-errors/)

### `timestamp` is epoch millis, formatted out of process

The `timestamp` value is UNIX epoch milliseconds as an unquoted number
(`Date.now()`), not a formatted string. Two reasons:

- **Performance.** Formatting time in-process (`new Date().toISOString()`)
  allocates a `Date` and builds a string on every line. `Date.now()` is a bare
  number read — the cheapest path, matching pino's default `epochTime`.
  Human-readable rendering is the sink's job, not the hot logging path.
- **Datadog validity.** UNIX milliseconds is an accepted date format, and
  `timestamp` is in Datadog's default date-attribute list.

The function is hand-rolled rather than `pino.stdTimeFunctions.*` because pino
bakes the field name into the timestamp function and every std variant emits the
`time` key — which Datadog does **not** recognize by default. Emitting the
`timestamp` key keeps it zero-config. (The previous value was epoch millis as a
quoted string, which Datadog also accepts but reads as a number wrapped in
quotes; dropping the quotes makes it a proper JSON number.)

### Base fields are the curated trio — `env` / `service` / `version`, all required

`service` joins `env` and `version` to complete Datadog unified tagging. Base
fields are exactly these three — there is no open bag for arbitrary deployment
tags. Two reasons:

- **Cost.** Root-level fields are indexed facets in Datadog; an open bag invites
  unbounded root cardinality and spend. Host-level tags such as `region`/`zone`
  come from the Datadog agent's host tags, not from per-line root fields.
- **Discipline.** A curated base keeps every line's envelope predictable.

The trio is **required — no defaults**. This refines ADR-0002's partial-config
model: behavioral config (`level`, default `info`; `pretty`, default `false`)
stays optional and defaulted, but deployment identity must be explicit. A
silently-defaulted `env`, `service`, or `version` is exactly the failure we want
to prevent — a service logging as `development` / `unknown` / `0.0.0` is worse
than a compile error telling the author to supply them.

### `pid` / `hostname` are kept

These are pino defaults. Datadog derives the real `host` from its agent, so
per-line `hostname` is mildly redundant and `pid` is low-value, but removing them
is churn for no gain.

### `context` stays open and app-owned; structured-first is the convention

`context` remains `Record<string, unknown>`; the base never enforces its keys.
Discoverability is delivered by the typed Base and Scope fields, not by typing
`context`. Re-introducing a `Logger` generic to type context per app was
rejected — ADR-0001 deliberately removed it.

**Structured-first** is the documented call convention: every log call passes a
`message` plus structured fields, never values interpolated into the message
string, so `message` stays a stable, low-cardinality string.

## Consequences

- `LoggingConfig` requires `env`, `service`, `version`; `level` and `pretty`
  become optional with defaults. The pino `bindings` formatter emits
  `{ env, service, version, ...scope }`. `createLogging()` with no argument, and
  partial configs missing the trio, are now compile errors.
- `service` appears on every line, completing unified tagging. There is no
  open base-field bag, so root-level cardinality stays bounded.
- The wire schema is now documented (README "Wire schema" section) and its
  vocabulary fixed (`CONTEXT.md` field tiers + structured-first), so future
  changes are visible diffs against a stated interface.
- A future direction — helper loggers that standardise specific `context`
  shapes — layers above the base and is explicitly out of scope for the base
  context.
