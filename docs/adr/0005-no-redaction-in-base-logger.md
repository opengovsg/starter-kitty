# 5. No redaction in the base logger

Date: 2026-06-24
Status: Accepted

## Context

OGP handles citizen data, so a recurring and reasonable proposal is to bake
redaction into the logging package's default config: censor secret keys
(authorization, cookies, tokens, passwords) and PII (NRIC/FIN, emails, phone
numbers), on by default, opt-out not opt-in. A logger that ships citizen data to
a sink with no redaction looks, at first glance, like a security gap.

Two technical facts make this much harder than it appears in the base logger:

1. **pino `redact` is path/key-based only.** It censors values at enumerated
   object paths (`a.b.c`, `stuff[*].secret`, one wildcard per path) with a
   `censor` replacement. It has **no value/pattern matching** — it cannot find an
   NRIC, email, or phone number by inspecting a *value*. So the PII half of the
   proposal is impossible via `redact` by construction.

2. **The base logger's `context` is arbitrary-shaped.** Business data is an
   open, arbitrarily-nested bag (`LogInput.context`), plus the `merged`
   escape-hatch and the shaped `error` object. Secrets can therefore appear at
   any depth (`context.user.credentials.password`).

Given (2), every in-base redaction strategy is a bad trade:

- **Path-based (pino `redact`)** only catches the paths you enumerate, to one
  wildcard's depth. Deeper secrets slip through — a *false sense of safety*,
  which is worse than none.
- **Any-depth key redaction** needs a custom serializer that walks every log
  object on every line — a per-line CPU cost the package has deliberately
  avoided elsewhere (see the timestamp decision in ADR-0003: no in-process
  formatting on the hot path).
- **In-process PII value-scrubbing** is both expensive (regex on every string
  value, every line) and unreliable (NRIC-shaped identifiers, emails embedded in
  URLs → false positives and negatives).

## Decision

The base logger does **not** redact. No `redact` paths are baked into the
default config, and no value-scrubbing is performed.

Redaction is deferred to the planned **fixed-shape helper loggers** (the future
direction in [ADR-0003](./0003-canonical-log-wire-schema.md)). Once a helper
fixes the shape of its `context`, redaction becomes tractable: a small,
enumerable set of known paths, complete coverage (no arbitrary depth), and
bounded, predictable cost. That is where censoring secret keys belongs.

PII, if and when it must be handled, belongs at the **sink** (e.g. Datadog
Sensitive Data Scanner — centrally-defined pattern rules applied at ingestion,
reviewed org-wide, with no in-process cost) or in the fixed-shape helpers — not
in the base logger.

Across all of these, **"don't log secrets or PII" remains the primary control.**
Redaction is a safety net, not the mechanism that makes logging safe.

## Consequences

- The base logger ships no redaction. A security reviewer should read this ADR
  before treating that as a gap: it is a deliberate decision, not an oversight.
- The cost of safe logging sits with the caller (don't log secrets/PII) and,
  later, with fixed-shape helpers and the sink — not with a per-line scrubber in
  the hot path.
- When the fixed-shape helpers land, they own the curated, reviewed redaction
  list (the "shared asset"), scoped to their known fields. This ADR should be
  revisited then to point at that implementation.
- If a future need forces base-logger redaction despite the above (e.g. a
  compliance mandate), it reopens the performance trade in (2) explicitly,
  rather than being added silently.
