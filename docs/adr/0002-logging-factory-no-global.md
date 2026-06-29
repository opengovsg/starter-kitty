# 2. Logging factory, no library-owned global

Date: 2026-06-24
Status: Accepted

## Context

`@opengovsg/starter-kitty-logging` originally exposed two entry points:

- `configureLogging(partial)` — mutated a **module-level** `config` and reset a
  lazily-built pino singleton. Process-global, meant to be called once at boot,
  optional (safe defaults until it ran), and re-callable ("late config wins").
- `createBaseLogger(options)` — produced a request-scoped child logger off that
  singleton.

The README presented them as a sequence (a "Configuration" section followed by a
"Usage" section), which read like a required two-step handshake even though
`configureLogging` was optional and operated on a different lifecycle
(once-per-process) than `createBaseLogger` (once-per-request).

The deeper issue was the **library-owned mutable global**. It carried the usual
costs: action-at-a-distance, an implicit boot-ordering dependency (a logger
created before `configureLogging` ran this far silently used defaults — which is
the whole reason "late config wins" existed, to rebuild the singleton after the
fact), and a test burden (every test had to reset the singleton via
`configureLogging` in `beforeEach`).

A global existed for one good reason: a logger is called from **everywhere** —
deep utils, tRPC procedures, services — and a module-global lets any of them
`import { createBaseLogger }` directly without threading anything through.

The package is unreleased (`0.0.0`) with no consumers, so the surface can change
without migration cost.

## Decision

### `createLogging(config)` returns a callable; no library global

The library exposes a single entry point:

```ts
export function createLogging(config?: Partial<LoggingConfig>): CreateLogger;
export type CreateLogger = (opts: LoggerOptions) => Logger;
```

`createLogging` builds the pino instance **eagerly, once**, and closes over it.
The returned callable has the **same signature as the old `createBaseLogger`**,
so every call site stays byte-identical. `configureLogging`, the module-level
`config`, and the `PinoLogger` class (its static singleton, `getInstance`,
`reset`) are removed.

### The global moves out of the library and into the app

The library no longer owns process-global state. The consuming app owns one
explicit, immutable const and re-exports it:

```ts
// app: src/logger.ts, once
export const createBaseLogger = createLogging({ env, version, level, pretty });
```

Distributed call sites import `createBaseLogger` from that app module instead of
from the package. The global still exists — but as the app's explicit const,
where deployment config rightfully lives, not as hidden library state.

### The factory is immutable

Config is fixed at creation. There is no reconfigure/reset. To run with
different config, create another factory. "Late config wins" is dropped: the
boot-ordering hazard it guarded against cannot occur, because a logger can no
longer be created before its factory exists.

### Partial config, merged over internal defaults

`createLogging` accepts `Partial<LoggingConfig>` and fills omitted fields from an
internal `DEFAULT_CONFIG` (production-shaped: structured JSON at `info`). This
preserves zero-config convenience for tests and quick starts; `createLogging()`
with no argument is valid.

> **Refined by [ADR-0003](./0003-canonical-log-wire-schema.md).** Deployment
> identity (`env`, `service`, `version`) is now **required** — only `level` and
> `pretty` remain optional/defaulted. `createLogging()` with no argument is no
> longer valid.

## Consequences

- The public surface shrinks: `configureLogging` and `PinoLogger` are gone;
  `createLogging` is the only entry point. `Logger`, `LogInput`,
  `LoggingConfig`, `LogLevel`, `BasicLogger`, and `WithLogger` are unchanged.
  `CreateLogger` and `LoggerOptions` are newly exported so apps can annotate
  their re-export. **Update
  ([ADR-0006](./0006-pluggable-error-serialization.md)):** `StructuredError` and
  the `CUSTOM_ERROR_CODE` constants were later **removed** — the logger defines
  no error type; error shaping is now the exported `serializeError` default plus
  a `LoggingConfig.serializeError` override seam.

- **Call sites do not change.** Only the boot wiring changes: a one-line
  `configureLogging({...})` becomes
  `export const createBaseLogger = createLogging({...})`.
- You can no longer `import { createBaseLogger }` directly from the package. Each
  app must create and re-export its own. This is the accepted cost of removing
  the library global, and the correct one — the library should not own
  process-global config.
- The app's `logger.ts` reads its environment at **import time**, so
  env/`dotenv` must be loaded before that module is first imported. This is an
  explicit, debuggable `import`-order concern, unlike the old hidden global.
- Tests construct a factory instead of resetting a singleton; the former
  `configureLogging` reconfigure cases become "two factories are independent".

This complements ADR-0001 (which shaped `action`, levels, and scoping); it does
not change any of those decisions.
