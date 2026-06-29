# 1. Logging package public API

Date: 2026-06-10
Status: Accepted

> **Update (2026-06-25):** `history` was later **removed**. The action model is
> now a single leaf `action` (no ancestry emitted), and `trace_id` — a required
> key on **request** loggers (optional on request-less `.system()` loggers,
> which have no distributed trace) — is what chains a request's lines together.
> The `action`-is-optional and level-guidance decisions below stand; only the
> `history` retention is superseded.

## Context

`@opengovsg/starter-kitty-logging` provides a framework-agnostic structured
logging core. Its public API has to balance two competing pressures:

- **Ergonomics.** Every log call should be cheap to write, or engineers route
  around the abstraction and the structure we want is lost.
- **Queryability.** Log lines feed dashboards and incident review, so they need
  consistent, searchable fields (`action`, `history`, severity, context).

Two design questions dominate the surface:

1. **How is the operation named?** An `action` field tags "what was happening".
   Forcing it on every call guarantees the field exists, but a requirement that
   is awkward to satisfy gets defeated rather than followed.
2. **How do engineers pick a severity level?** Without a clear discriminator,
   usage collapses to `info` and `error`, and the intermediate levels carry no
   signal.

The package is unreleased and has no consumers, so the API can be shaped freely
without migration cost.

## Decision

### `action` is optional and a single string

- `LogInput.action` is `action?: string` — optional everywhere, with no
  `string | [string, ...]` union.
- A logger accumulates an **action path** by chaining `createScopedLogger` /
  `setAction`. On each line the **most specific** action wins (the per-call
  string, else the deepest scope) and is emitted as `action`; its ancestors are
  emitted as `history`.
- `history` is retained: it is cheap, and grouping by the leaf `action` while
  keeping ancestry is useful in dashboards.

A mandatory `action` was rejected. A required field that is awkward to supply is
evaded (e.g. via in-place setters) rather than honoured, so it fails to deliver
the queryability guarantee it promises while adding friction.

### A single, non-generic `Logger` type

With `action` uniformly optional there is no required→optional transition to
model, so the type machinery that existed only to express it is removed:
`Logger` is non-generic, there is one `LogInput`, and `createScopedLogger`
returns a plain `Logger` (no `ScopedLogInput` / `ScopedLogger`).

### `notice` carries no error

`notice(input: Omit<LogInput, 'error'>)` — passing an error is a compile error.
`notice` routes through the same path as `info` / `debug`, not the
error-shaping path used by `warn` / `error`. `notice` denotes a normal but
significant condition, which by definition is not an error.

### Level guidance lives at the point of use

The discriminator for choosing a level is **"does someone need to act?"**
(actionability). It is documented as per-method JSDoc — so it surfaces in editor
autocomplete at the call site, where the level is actually chosen — and as a
table in the package README:

| Level    | Use when                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `error`  | An operation failed; a human likely needs to investigate.                                                                          |
| `warn`   | Something off but handled/recovered; no immediate action needed.                                                                   |
| `notice` | A significant or **auditable** business event (ownership transfer, mutating a critical resource, permission change). Not an error. |
| `info`   | Routine business events forming the normal activity trail.                                                                         |
| `debug`  | Verbose diagnostics, only while actively debugging.                                                                                |

`notice` is explicitly the **audit** rung.

### Four scoping methods, two immutable and two mutating

`createScopedLogger` and `withContext` return new loggers (immutable; safe for
request scoping). `setAction` and `setContext` mutate in place and return the
same instance for chaining. The mutating pair are a concurrency footgun if a
logger is shared across requests, but are pragmatic for accumulating
scope/context through a single handler; the risk is documented on their JSDoc
and in the README rather than removing them.

### Audit retention is an operational concern

`notice` (severity 30) sits below `warn` (40), so it is dropped if the
configured `level` is raised above it. No separate always-emit audit channel is
added. Retention is guaranteed operationally: all levels are shipped to the log
sink (e.g. Datadog) and filtered there, so the production `level` must stay at
`notice` or lower. This invariant is documented in the README.

## Consequences

- The public API is smaller: `ScopedLogInput`, `ScopedLogger`, and the
  `Logger<T>` generic no longer exist.
- Logging at any level no longer requires naming an action; scoping is the
  encouraged way to attach one.
- An empty merged context is no longer emitted, so scoped lines do not carry a
  noisy `"context": {}`.
- Level choice is guided at the call site, reducing the `info`/`error` default.
- Audit retention depends on a documented operational invariant (production
  `level` ≤ `notice`); raising the level loses audit lines at the source. A
  dedicated audit channel can be revisited if that proves fragile.
