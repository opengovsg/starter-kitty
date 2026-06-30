# @opengovsg/starter-kitty-logging

## 0.1.1

### Patch Changes

- [#71](https://github.com/opengovsg/starter-kitty/pull/71) [`b7891dd`](https://github.com/opengovsg/starter-kitty/commit/b7891dd490a1120fa0cd93bd8bccfaadadcd9594) Thanks [@karrui](https://github.com/karrui)! - Merge the logger's scoped context into audit lines

  `logger.scope({ context }).audit.*({ context })` now merges the scoped context
  into the emitted audit line (low to high: scoped, event fields, per-call),
  instead of dropping it. The merged context passes the same Context guard as a
  routine line. See ADR-0008.

## 0.1.0

### Minor Changes

- [#64](https://github.com/opengovsg/starter-kitty/pull/64) [`b347b81`](https://github.com/opengovsg/starter-kitty/commit/b347b814bc2108f8c6b68337c5f377a5530e94e6) Thanks [@karrui](https://github.com/karrui)! - Add the `apiUsage` audit category — `logger.audit.apiUsage.*`: `tokenIssued`,
  `tokenRefreshed`, `tokenInvalidated`, and `sensitiveEndpointAccessed`. Token
  identifiers are references, never the token value. Anomaly/abuse detection is
  deliberately excluded — that is a sink/SIEM concern over these lines, not
  something the app knows at log time.

- [#63](https://github.com/opengovsg/starter-kitty/pull/63) [`c8cd4a6`](https://github.com/opengovsg/starter-kitty/commit/c8cd4a6c2c520ecb81721dd8298120b52fd2ec9b) Thanks [@karrui](https://github.com/karrui)! - Add the `configChange` audit category — `logger.audit.configChange.*`:
  `securityConfigChanged` and `policyChanged` (the org-level policy changes —
  ACLs, retention, logging, password/access policy — deferred from
  `userManagement`). Admin actions: the actor (`user_id`) and `client_ip` are
  read from scope; events log the setting/policy and non-sensitive old/new values.

- [#62](https://github.com/opengovsg/starter-kitty/pull/62) [`c9f8cdb`](https://github.com/opengovsg/starter-kitty/commit/c9f8cdb623fee421ac7de03e918b5bce7a5f58dd) Thanks [@karrui](https://github.com/karrui)! - Add the `dataAccess` audit category — `logger.audit.dataAccess.*`:
  `dataAccessed`, `recordDownloaded`, and `bulkExported`. Downstream events — the
  actor (`user_id`) and `client_ip` are read from scope. They log _what_ was
  accessed (resource type/id, classification, size, export destination/filters),
  never the data itself; the data "action taken" is named `accessType` to avoid
  clashing with the Controlled `action` field.

- [#65](https://github.com/opengovsg/starter-kitty/pull/65) [`11d7e20`](https://github.com/opengovsg/starter-kitty/commit/11d7e20addedb38deab861c992694b3aca3682b6) Thanks [@karrui](https://github.com/karrui)! - Add the `failures` audit category — `logger.audit.failures.*`: `accessDenied`,
  `privilegeEscalationDenied`, and `sensitiveActionBlocked`. These are _handled_,
  security-relevant denials and fire at `warn` (the control worked).
  `accessDenied` may be unauthenticated, so its actor is optional. Application
  _errors_ still go through the base `error()`, and anomaly detection remains a
  sink concern.

- [#61](https://github.com/opengovsg/starter-kitty/pull/61) [`da9e13e`](https://github.com/opengovsg/starter-kitty/commit/da9e13e17fcc7982171aa9c61b0854559bc7b35b) Thanks [@karrui](https://github.com/karrui)! - Add the fixed-shape **audit helper layer** — `logger.audit.<category>.<event>`
  (ADR-0006) — with the first two categories, `authn` and `userManagement`. Each
  event has a type-enforced shape, stamps the Controlled `audit`/`category`/`event`
  wire fields, separates actor (scope `user_id`) from target
  (`context.target_user_id`), fires at a per-event `notice`/`warn`, and performs no
  value transformation (secrets are unrepresentable; PII is a sink concern). Each
  event's default message can be overridden via `messageOverride`. `.audit` is on
  the server `Logger` only (not `BasicLogger`), built lazily.

- [#66](https://github.com/opengovsg/starter-kitty/pull/66) [`4a8bb2b`](https://github.com/opengovsg/starter-kitty/commit/4a8bb2b043c7f3cbd7722c3ee037484d548b4788) Thanks [@karrui](https://github.com/karrui)! - Add the `resource` audit category — `logger.audit.resource.*`: `created`,
  `updated`, `deleted`, and `ownershipTransferred`. This is the **mutation** side
  of generic business entities (forms, projects, documents, …), complementing
  `dataAccess` (read/export) and `userManagement` (accounts). Downstream actions:
  the actor (`user_id`) and `client_ip` are scope-read; `ownershipTransferred`
  records the previous/new owner as `context.from_owner_id`/`to_owner_id` (owners
  are generic — user, team, org — not necessarily users) while the top-level
  `user_id` stays the actor who performed it. Logs field names on update, never
  values.

- [#58](https://github.com/opengovsg/starter-kitty/pull/58) [`439883a`](https://github.com/opengovsg/starter-kitty/commit/439883abc2b19254c77f171583157fef5d93b699) Thanks [@karrui](https://github.com/karrui)! - Add `@opengovsg/starter-kitty-logging`: a framework-agnostic structured logging
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
