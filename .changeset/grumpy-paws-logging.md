---
"@opengovsg/starter-kitty-logging": minor
---

Add `@opengovsg/starter-kitty-logging`: a framework-agnostic structured logging
core built on pino. It standardises a flat, Datadog-aligned newline-delimited
JSON wire schema (custom syslog levels, the `env`/`service`/`version` unified-
tagging trio), a scoped logger with a per-line `action` and contextual metadata,
an oversized-context guard, and pluggable error serialisation — a
framework-neutral default (`serializeError`) overridable per factory via
`LoggingConfig.serializeError`.

The package reads zero environment variables. Call `createLogging({ env, service,
version, level?, pretty? })` once at boot — `env`, `service`, and `version` are
required (deployment identity must be explicit) — and re-export the returned
**immutable** factory. Construct request loggers from it (client identity
required) or `factory.system(...)` for request-less contexts (startup, jobs,
cron). The public type is the `Logger` interface; the implementation is internal.
