# 8. Audit lines compose scoped context

Date: 2026-06-30
Status: Accepted
Amends: ADR-0007 (fixed-shape audit helpers)

## Context

ADR-0007 built the audit-helper layer: each event promotes its canonical fields
to their wire position, stamps the `audit`/`category`/`event` Controlled fields,
and lands its event-specific fields plus a free-form per-call `context` in the
`context` bag. It is silent on one thing: what happens to the **Context** a
caller has already bound to the logger via `scope({ context })` / `withContext`
/ `setContext`.

The base (routine) path merges that scoped Context into every line
(`mergeContext(this.context, input.context)`). The audit path did not - the
injected `emit` callback wrote the audit fields straight to the pino child,
bypassing the base's context tail entirely. So
`logger.scope({ action, context: { a } }).audit.x({ context: { b } })` emitted
only `{ b }` (plus event fields); the scoped `{ a }` silently vanished. For a
"who did what to which resource" line, dropping the ambient request facets an
auditor most wants is exactly the wrong default.

## Decision

**An audit line composes the logger's scoped Context, the same way a routine
line does.** The assembled audit Context is, low precedence to high:

1. the logger's scoped **Context** (`scope`/`withContext`/`setContext`),
2. the event's standard `contextFields`,
3. the per-call `context`.

"More specific wins" - a per-call key overrides an event field, which overrides
an ambient scoped key. A real clash between (1) and (2) is near-impossible
(event field names are event-specific; scoped Context is request facets), and
where it ever happens the more-specific value is the right tiebreak.

**The assembled Context passes the same Context guard as any line.** Once
arbitrary scoped Context can ride an audit line, the oversized/unserialisable
risk the guard exists for applies to audit lines too - and they land in
WORM/retention storage, where a malformed line is worse. The guard runs
uniformly; audit lines are not a hole in it.

**`LoggerImpl` owns the merge and the guard; the audit module stays pure
assembly.** Rather than teach the audit module to read scope and call
`serializeContext` (option A), the injected `emit` callback performs the
scoped-Context merge and runs the guard before writing to pino - the same
context tail the routine path uses. The audit module keeps its ADR-0007 charter:
it assembles event fields and hands a Context bag to `emit`, ignorant of scope,
pino, and the guard. One chokepoint for "Context becomes a wire field," shared
by both paths; the diagnostic lines the audit module emits inherit scoped
Context for free.

This refines, and does not reverse, ADR-0007. Promotion of canonical fields,
the Controlled-field stamping, and `contextFields`-then-per-call ordering all
stand; this ADR adds the scoped-Context layer beneath them and the guard above.

## Considered alternatives

- **Audit lines isolated from scoped Context** (rejected) - keep an audit line
  fully self-described, immune to inheriting unvetted ambient keys (a PII-leak
  guard for WORM storage). Rejected: the request facets bound at `scope()` are
  precisely the who/where context a compliance reader needs, and PII scrubbing is
  already a uniform sink concern (ADR-0005, ADR-0007), not a reason to blind the
  audit line. Isolation would also make audit Context behave oppositely to every
  other line for no caller-visible reason.
- **Audit Context left unguarded** (rejected) - "emit the audit event whole or
  fail loudly" rather than let the guard drop/substitute. Rejected: a malformed
  line in WORM storage is the worse outcome, and the guard already diagnoses
  loudly what it drops; uniform behaviour beats a bespoke audit exception.
- **Audit module owns merge + guard (option A)** (rejected) - exposing scope and
  the guard to the audit module duplicates the guard call and breaks the
  "layers above the base, never touches pino" charter from ADR-0007.

## Consequences

- Audit lines now carry the logger's scoped Context, merged beneath event and
  per-call Context, matching routine lines. Existing callers that relied on
  scoped Context being *absent* from audit lines (there should be none - it was a
  silent drop, not a documented contract) would see those keys appear.
- The Context guard applies to audit Context. An oversized/unserialisable audit
  Context is dropped-and-diagnosed like any other, instead of producing a
  malformed line in retention storage.
- The audit module is unchanged in charter: pure event assembly, no pino, no
  guard. The merge + guard live in `LoggerImpl`'s injected `emit`.
- ADR-0007's glossary entry for **Audit event** is sharpened: "fixed and
  enforced" means the *required* fields are guaranteed, not that the Context bag
  is closed.
