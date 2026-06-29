# 4. Scoping is `scope`, not `child`

Date: 2026-06-24
Status: Accepted

> **Update (2026-06-25):** `history` was later **removed** — `trace_id` (now a
> required scope key) chains a request's lines, so per-line action _ancestry_ was
> dropped as redundant. `scope` now sets the most-specific leaf `action` (it no
> longer accumulates a path). The name `scope` still holds: it remains distinct
> from `pino.child` because it **merges** `context` where child _replaces_ it —
> which is now the primary basis for this decision.

## Context

The immutable action-scoping method was named `createScopedLogger`. Because the
package is built on pino, and pino's idiom for deriving a sub-logger is
`logger.child(bindings)`, a recurring suggestion is to rename the method to
`child` for familiarity.

That framing assumes the method _is_ a pino child. It is not. Mapping the
package's sub-logger operations onto `pino.child`:

- **`createBaseLogger(options)`** — calls `pino.child(typed scope)` under the
  hood (`bindChild`). This **is** the pino child: it binds a fixed, typed scope
  set (`path`, `trace_id`, `user_id`, …) and creates a real pino child.
- **the scoping method** — reuses the _same_ pino logger and derives at the
  wrapper level. It **accumulates** an action path: the most specific action is
  emitted as `action`, its ancestors as `history`. It also key-merges `context`.

`pino.child` cannot express either behaviour: chaining `child({action:'a'})`
then `child({action:'b'})` **overwrites** to `b` (no path, no history), and
chaining `child({context})` **replaces** the whole `context` object rather than
merging keys. So the scoping method is a deliberate extension over pino, not a
wrapper around `pino.child`.

A separate question — whether `action`/`history` is even worth keeping given
Datadog `trace_id` — was resolved in favour of keeping it: `trace_id` correlates
the _request_ (it is an ID, not an operation name and not a nesting), whereas
`action`/`history` give the logical operation nesting _on each line_. They are
complementary; `history` is the only source of per-line operation nesting unless
APM spans are richly instrumented, and it is low-cardinality (a small set of
code-defined names), so cheap to keep.

## Decision

Rename `createScopedLogger` to **`scope`**.

- `scope` is named for what it does — derive a new, immutable logger that
  extends the action path — without borrowing `child`, which would promise
  pino's last-wins binding-merge semantics the method does not honour.
- The pino-`child` mental model is already correctly served by
  `createBaseLogger` (the real pino child).
- `scope` pairs naturally with the existing `withContext` (both immutable
  derivations). The mutating pair (`setAction` / `setContext`) keep their
  `set*` names, which correctly signal mutation.

`child` was rejected: same word as pino, different semantics (accumulate vs
overwrite), and it would collide with `createBaseLogger` actually being the
child. Keeping `createScopedLogger` was rejected only for terseness.

This supersedes the method _name_ in ADR-0001 (which documented
`createScopedLogger`); the scoping semantics it described are unchanged.

## Consequences

- The public `Logger` interface exposes `scope(options)` instead of
  `createScopedLogger(options)`. The package is unreleased (`0.0.0`), so there is
  no migration cost.
- The JSDoc and README state explicitly that `scope` accumulates an action path
  (unlike `pino.child`) and that `createBaseLogger` is the pino child, heading
  off the "why isn't this `child`?" question.
- `action`/`history` remain part of the wire schema as a low-cost,
  span-independent record of operation nesting.
