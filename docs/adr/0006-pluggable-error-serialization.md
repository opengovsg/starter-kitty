# 6. Pluggable error serialisation; the logger defines no error type

Date: 2026-06-26
Status: Accepted

## Context

The package shipped a `StructuredError` class (a `code`/`context`/`location`/`cause`
error type, with a `CUSTOM_ERROR_CODE` taxonomy mirroring tRPC) and the base
logger shaped errors around it: `formatLogWithErrors` read `err.code` to set
`error.kind` and promoted `err.context` to the top-level `context` field.

Two problems. First, **defining an application error type is overreach for a
logging core** — the error vocabulary belongs to the app, not the logger.
Second, the `code`→`kind` duck-typing and `context`-promotion are not neutral:
they encode _tRPC's_ error model. A NestJS app (whose `HttpException` carries no
`code`) gets nothing from them, and the logger silently privileges one
framework's shape.

## Decision

The base logger **defines no error type** and shapes errors through a
**pluggable seam with a neutral default**:

- `StructuredError`, `CUSTOM_ERROR_CODE`, and `CUSTOM_ERROR_CODE_KEY` are
  **removed** from the public API.
- `LoggingConfig.serializeError?: (err: Error) => Record<string, unknown>` is set
  once at `createLogging` (immutable, like every other config field). The logger
  normalises any thrown value to an `Error` internally (private
  `getCauseFromUnknown`), then calls the serialiser — so a custom serialiser
  always receives a real `Error`, never a raw `unknown`.
- The exported default `serializeError` is framework-neutral:
  `{ ...ownEnumerableProps, kind: err.name, message, stack, cause }`. `kind` is
  the class name (Datadog `error.kind`, per ADR-0003) — **not** `err.code`. An
  error's extra enumerable props (e.g. a tRPC `code`) still survive on the wire
  under `error`, just not lifted into `kind`.
- **`context`-promotion is dropped.** The base no longer reaches into
  `err.context`. An app that wants it writes `logger.error({ error, context })`
  explicitly.

Framework-specific serialisers (tRPC `code`→`kind`, NestJS `HttpException`) are
**deferred**. When they land they ship as subpath exports
(`@opengovsg/starter-kitty-logging/trpc`, `/nestjs`), following the `validators`
package precedent (`exports` + `typesVersions` + `src/<name>/index.ts`).

## Consequences

- The logger is framework-neutral: it shapes _any_ error but couples to none.
  Apps inject their own `serializeError` (or, later, import a framework subpath)
  to recover `code`→`kind`.
- Public surface shrinks: `StructuredError`, `CUSTOM_ERROR_CODE`,
  `CUSTOM_ERROR_CODE_KEY`, and `getCauseFromUnknown` are gone (the last is now a
  private helper). `serializeError` (default) and the `LoggingConfig.serializeError`
  option are added. This supersedes the `StructuredError` reference in
  [ADR-0002](./0002-logging-factory-no-global.md)'s export list.
- `src/error.ts` is repurposed from "the StructuredError definition" into the
  error-serialisation module, mirroring `src/context.ts` → `serializeContext`.
- The package remains dependency-free beyond pino: the neutral default and the
  (future) framework serialisers shape structurally / via type-only imports, so
  no framework becomes a runtime dependency of the core.
