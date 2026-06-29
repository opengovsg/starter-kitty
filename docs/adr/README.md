# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs): short documents that
capture a significant decision, the context that forced it, and its consequences.

Each ADR is immutable once accepted — to revisit a decision, add a new ADR that
supersedes the old one (and note it in the old one's status).

Files are numbered sequentially: `NNNN-kebab-case-title.md`.

| ADR                                             | Title                                        | Status   |
| ----------------------------------------------- | -------------------------------------------- | -------- |
| [0001](./0001-logging-package-public-api.md)    | Logging package public API                   | Accepted |
| [0002](./0002-logging-factory-no-global.md)     | Logging factory, no library-owned global     | Accepted |
| [0003](./0003-canonical-log-wire-schema.md)     | Canonical log wire schema                    | Accepted |
| [0004](./0004-scope-not-pino-child.md)          | Scoping is `scope`, not `child`              | Accepted |
| [0005](./0005-no-redaction-in-base-logger.md)   | No redaction in the base logger              | Accepted |
| [0006](./0006-pluggable-error-serialization.md) | Pluggable error serialisation; no error type | Accepted |
| [0007](./0007-fixed-shape-audit-helpers.md)     | Fixed-shape audit helpers                    | Accepted |
