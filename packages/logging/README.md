# `@opengovsg/starter-kitty-logging`

A framework-agnostic structured logging core built on [pino](https://getpino.io/).
It standardises the log wire format (newline-delimited JSON with custom syslog
levels), provides a scoped logger with actions and contextual metadata, an
oversized-context guard, and pluggable error shaping.

The package reads **no environment variables** of its own — all deployment
config is injected by the consuming app.

## Setup

The package exposes a single entry point, `createLogging`. Call it **once** in
your app, mapping values from your own environment, and re-export the result.
The factory is immutable — config is fixed at creation and the pino instance is
built once. `env`, `service`, and `version` are **required** (deployment identity
must be explicit); `level` (default `info`) and `pretty` (default `false`) are
optional. It never throws.

```ts
// src/logger.ts — owned by your app
import { createLogging } from '@opengovsg/starter-kitty-logging'

export const createBaseLogger = createLogging({
  // Required — deployment identity, no library defaults:
  env: process.env.ENVIRONMENT ?? 'development',
  service: 'widgets-api',
  version: process.env.APP_VERSION ?? '0.0.0',
  // Optional:
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  pretty: process.env.NODE_ENV !== 'production',
})
```

## Usage

Import your app's re-exported factory anywhere and create a logger. There are
two shapes, by context:

```ts
import { createBaseLogger } from '~/logger'

// Request-scoped — inside an HTTP handler. `traceId`, `clientIp`, and
// `userAgent` are REQUIRED KEYS (a compile error if omitted) but accept
// `string | null | undefined`: you must acknowledge them, and pass
// `null`/`undefined` when the header is genuinely missing. `headers.get(...)`
// returns `string | null`, which is accepted directly — a `null` value is
// simply omitted from the line.
const logger = createBaseLogger({
  path: '/api/widgets',
  source: req.headers.get('x-source'),
  traceId: req.headers.get('x-trace-id'),
  clientIp: req.headers.get('cf-connecting-ip'),
  userAgent: req.headers.get('user-agent'),
})

// `context` keys are emitted as-is (no transform) — prefer snake_case.
logger.info({ message: 'Widget fetched', action: 'getWidget', context: { widget_id: widgetId } })

// Request-less ("system") — startup, background jobs, cron, CLI. No client
// identity exists in these contexts, so use `.system(...)`, which has no
// `clientIp` / `userAgent`.
const startupLogger = createBaseLogger.system({ path: 'redis:startup' })
startupLogger.info({ message: 'Redis connected', action: 'boot' })
```

> **Why two shapes?** Client identity (`client_ip`, `user_agent`) belongs on
> request lines but doesn't exist outside a request. Making the keys required on
> the default call — with an explicit `.system()` escape — forces the caller to
> acknowledge them where they apply (passing `null`/`undefined` for a missing
> header) without forcing fake values where they don't. Header-sourced fields
> (`source`, `traceId`, `clientIp`, `userAgent`, `clientVersion`) accept `null`
> and are omitted from the line rather than emitted as `null`.

## Wire schema

Every line is newline-delimited JSON, **flat** and **`snake_case`**, aligned to
[Datadog](https://docs.datadoghq.com/logs/log_configuration/pipelines/). Each
wire field has one canonical name (`user_id`, never `uid`/`userId`/`user`); the
TypeScript input is camelCase (`userId`) and maps to it. Fields fall into four
tiers:

| Tier           | Fields                                                                    | Owned by              |
| -------------- | ------------------------------------------------------------------------- | --------------------- |
| **Controlled** | `timestamp`, `level`, `message`, `action`, `error`, `context`             | the logger (reserved) |
| **Base**       | `env`, `service`, `version`                                               | deployment config     |
| **Scope**      | `path`, `source`, `user_id`, `trace_id`, `correlation_id`, `device_id`, … | per request           |
| **Context**    | free-form business data                                                   | the app               |

```json
{
  "timestamp": 1782639721123,
  "level": "INFO",
  "message": "Widget fetched",
  "env": "production",
  "service": "widgets-api",
  "version": "1.4.2",
  "path": "/api/widgets",
  "source": "trpc",
  "user_id": "u_1",
  "action": "getWidget",
  "context": { "widget_id": "w_123" }
}
```

- **`env` + `service` + `version`** are Datadog unified tagging — all three are
  required, no defaults, so deployment identity is never silently wrong.
- **`level`** is classified as the log status by Datadog out of the box (it is in
  Datadog's default status-attribute list) — no remapper needed.
- **`timestamp`** is UNIX epoch milliseconds (a number). It is not formatted
  in-process; the sink renders it.
- **Base fields are a curated set** — there is no open bag. Host-level tags like
  `region`/`zone` come from the Datadog agent, not per-line root fields, keeping
  root-level cardinality (and cost) bounded.

### Structured-first

Pass a `message` plus **structured fields** — never values interpolated into the
message string. Business data goes in `context`; the `message` stays a stable,
low-cardinality string you can group by.

```ts
// ✅ structured
logger.info({ message: 'order created', context: { order_id: orderId } })

// ❌ interpolated — defeats grouping and search
logger.info({ message: `order ${orderId} created` })
```

`context` is app-owned and free-form; the base does not enforce its keys (prefer
`snake_case` for wire consistency and Datadog facets).

### Scoping

`action` is optional and names the current operation. Scoping sets the **leaf**
action; a per-call `action` wins over it. Only that most-specific action is
emitted (there is no `history` of ancestors).

```ts
const scoped = logger.scope({ action: 'createUser' })
scoped.info({ message: 'validating', action: 'validateEmail' })
// => action: "validateEmail"
scoped.info({ message: 'saving' })
// => action: "createUser"
```

- `scope({ action, context? })` — returns a **new** logger (immutable; safe for
  request scoping). Unlike `pino.child`, it **merges** context rather than
  replacing it — the real pino child is `createBaseLogger`.
- `withContext({ context })` — returns a **new** logger with merged context.
- `setAction({ action })` / `setContext({ context })` — mutate **in place** and
  return the same instance for chaining.

**⚠️ Caveat:** `setAction` / `setContext` mutate the logger in place. If you
share a logger across concurrent requests (e.g. a module-level singleton), the
scope/context bleeds between them. Prefer `scope` / `withContext` for
request-scoped work.

## Choosing a level

Without guidance, everything defaults to `info` and `error`. The discriminator
is **"does someone need to act?"** Levels follow RFC 5424 (syslog) ordering.

| Level    | Use when                                                                                                                                                   | Carries `error`? |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `error`  | An operation failed and a human likely needs to investigate (potentially page-worthy).                                                                     | Yes              |
| `warn`   | Something is off but was handled/recovered and needs no immediate action (retry, fallback).                                                                | Optional         |
| `notice` | A significant or **auditable** business event — ownership transfer, mutating a critical resource, permission change, authentication. Normal, not an error. | No               |
| `info`   | Routine, expected business events forming the normal activity trail (request handled, record read).                                                        | No               |
| `debug`  | Verbose diagnostic detail useful only while actively debugging. Usually off in production.                                                                 | No               |

`notice` is the audit rung: reach for it whenever you'd want to reconstruct
**who did what** to a critical resource later.

**📋 Retention:** `notice` (severity 30) sits **below** `warn` (40) in syslog
ordering, so it is dropped if the configured `level` is set above it.
Audit/notice events are retained by shipping all levels to your log sink (e.g.
Datadog) and filtering there — keep the production `level` at `notice` or lower
so audit lines are never discarded at the source.

## Error serialisation

The `error` passed to `warn` / `error` accepts **any thrown value** — a thrown
string or plain object is normalised to an `Error` first. The normalised error
is then shaped into the `error` wire field by a `serializeError` function fixed
at the factory.

The package **defines no error type** and the default shaping is
**framework-neutral**: it emits `{ ...ownEnumerableProps, kind, message, stack,
cause }`, where `kind` (Datadog's `error.kind`) is the error's **class name** —
not a framework code. An error's extra own properties (e.g. a tRPC `code`)
survive under `error`, just not lifted into `kind`.

To recover framework-specific shaping (e.g. map a tRPC `code` or a NestJS
`HttpException` status to `kind`), override `serializeError` once on the factory:

```ts
import { createLogging, serializeError } from '@opengovsg/starter-kitty-logging'

export const createBaseLogger = createLogging({
  env,
  service,
  version,
  // Wrap the neutral default to lift a tRPC `code` into `kind`.
  serializeError: err => ({ ...serializeError(err), kind: (err as { code?: string }).code ?? err.name }),
})
```

The base logger does **not** reach into an error's `context` property. If you
want an error's metadata in the queryable top-level `context`, pass it
explicitly: `logger.error({ error, context: { ...} })`.

## Audit events

The server `Logger` carries an **`audit`** namespace for compliance-auditable
business events — "who did what to which critical resource" — drawn from a
**closed, governed taxonomy** (authentication, user management, data access, …).
Unlike a routine log line, each audit event has a **fixed, type-enforced shape**:
required fields are mandatory at compile time, shared identity (`user_id`,
`client_ip`) is read from the bound scope, and the helper stamps three Controlled
wire fields — `audit: true` (the marker your sink routes to WORM/immutable
storage), `category`, and `event`.

```ts
const logger = createBaseLogger({
  path: '/login',
  traceId: req.headers.get('x-trace-id'),
  clientIp: req.headers.get('cf-connecting-ip'),
  userAgent: req.headers.get('user-agent'),
})

logger.scope({ action: 'verifyOtp' }).audit.authn.loginSucceeded({
  userId: 'u_1',
  role: 'admin',
  privileged: true,
  username: 'jane',
  sessionId: 's_1',
})
```

```json
{
  "level": "NOTICE",
  "message": "Login succeeded",
  "audit": true,
  "category": "authn",
  "event": "loginSucceeded",
  "action": "verifyOtp",
  "user_id": "u_1",
  "client_ip": "1.2.3.4",
  "context": { "role": "admin", "privileged": true, "username": "jane", "session_id": "s_1" }
}
```

- **Call shape:** `logger.audit.<category>.<event>(input)`. `category` and `event`
  are real path segments (autocomplete-grouped) **and** the wire facet values —
  there is no abbreviation layer.
- **Canonical facets are promoted**, not buried: `userId` becomes the top-level
  `user_id`, not `context.user_id`. Event-specific fields land in `context`
  (emitted `snake_case`).
- **Level is fixed per event**, drawn from `{ notice, warn }` — most events are
  `notice` (the audit rung), security-relevant denials are `warn`; never `error`
  (an audit event is not an operation failure). Keep the production `level` at
  `notice` or lower so audit lines survive (see **Retention** above).
- **Server-only.** `audit` lives on the full `Logger`, not on `BasicLogger`, so
  shared/client code cannot emit audit events. It is built lazily — a request
  that emits none pays nothing.
- **Secrets are unrepresentable by shape** — passwords, raw tokens, and raw API
  keys are simply never fields. Identifiers that may be PII (`user_id`,
  `username`, …) stay raw and are scrubbed at the **sink**, not in-process.
- **Scope-read fields are asserted at emit:** when an event reads `user_id` /
  `client_ip` from the scope and it is missing, the helper emits a loud
  diagnostic line rather than a silently-incomplete audit record.

See [ADR-0007](../../docs/adr/0007-fixed-shape-audit-helpers.md) for the design.
Every input additionally accepts `context?` (extra business fields, merged into
`context`) and `messageOverride?` (each event has a stable default message —
override only when a call site needs a more specific one); both are omitted from
the per-event tables below.

### Categories

#### `authn` — authentication & session

| Event               | Level    | Required fields                                                              |
| ------------------- | -------- | ---------------------------------------------------------------------------- |
| `loginSucceeded`    | `notice` | `userId`, `role`, `privileged` _(opt: `username`, `sessionId`)_              |
| `loginFailed`       | `notice` | `username`, `reason`, `attemptCount`, `privileged` _(opt: `userId`, `role`)_ |
| `sessionCreated`    | `notice` | `sessionId`                                                                  |
| `sessionTerminated` | `notice` | `sessionId`, `reason`                                                        |
| `sessionTimedOut`   | `notice` | `userId`, `sessionId`                                                        |
| `tokenReused`       | `warn`   | `tokenId` _(opt: `sessionId`)_                                               |

#### `userManagement` — user & permission management

Acts on a **target** account (`targetUserId`, emitted as `context.target_user_id`)
that is usually distinct from the **actor** (the request's scope `user_id`).
Events log _what_ changed — field/role names and id references — never the values.

| Event                | Level    | Required fields                        |
| -------------------- | -------- | -------------------------------------- |
| `accountCreated`     | `notice` | `targetUserId`                         |
| `accountModified`    | `notice` | `targetUserId`, `changedFields`        |
| `accountDeactivated` | `notice` | `targetUserId` _(opt: `reason`)_       |
| `accountDeleted`     | `notice` | `targetUserId`                         |
| `roleChanged`        | `notice` | `targetUserId`, `oldRoles`, `newRoles` |
| `mfaSettingChanged`  | `notice` | `targetUserId`, `change`               |
| `apiKeyChanged`      | `notice` | `targetUserId`, `keyId`, `action`      |
| `passwordReset`      | `notice` | `targetUserId`, `initiatedBy`          |

#### `dataAccess` — data access, movement & export

Downstream of authentication: the acting `user_id` and `client_ip` are
scope-read. Log _what_ was accessed — resource type/id, classification — never
the data itself.

| Event              | Level    | Required fields                                                                       |
| ------------------ | -------- | ------------------------------------------------------------------------------------- |
| `dataAccessed`     | `notice` | `resourceType`, `resourceId`, `accessType`, `classification`                          |
| `recordDownloaded` | `notice` | `resourceId`, `classification`, `sizeBytes`, `method` _(opt: `resourceType`, `role`)_ |
| `bulkExported`     | `notice` | `destination`, `classification`, `recordCount` _(opt: `filters`)_                     |

#### `configChange` — application & security-configuration changes

Admin actions, downstream of auth: actor `user_id` and `client_ip` are
scope-read. Log _what_ changed (and old/new values when non-sensitive), never
secrets.

| Event                   | Level    | Required fields                                         |
| ----------------------- | -------- | ------------------------------------------------------- |
| `securityConfigChanged` | `notice` | `setting` _(opt: `oldValue`, `newValue`)_               |
| `policyChanged`         | `notice` | `policyType` _(opt: `summary`, `oldValue`, `newValue`)_ |

#### `apiUsage` — API token lifecycle & sensitive-endpoint access

Anomaly/abuse detection is intentionally absent — the app does not know a call is
anomalous at log time; that is a sink/SIEM concern _over_ these lines.

| Event                       | Level    | Required fields                        |
| --------------------------- | -------- | -------------------------------------- |
| `tokenIssued`               | `notice` | `userId`, `tokenId` _(opt: `scopes`)_  |
| `tokenRefreshed`            | `notice` | `tokenId`                              |
| `tokenInvalidated`          | `notice` | `tokenId`, `reason`                    |
| `sensitiveEndpointAccessed` | `notice` | `endpoint`, `method` _(opt: `params`)_ |

#### `failures` — handled security denials

_Handled_, security-relevant denials, so they fire at `warn` (the control
worked). Application _errors_ go through the base `error()`, not here.

| Event                       | Level  | Required fields                                           |
| --------------------------- | ------ | --------------------------------------------------------- |
| `accessDenied`              | `warn` | `resource`, `reason` _(opt: `userId`, `attemptedAction`)_ |
| `privilegeEscalationDenied` | `warn` | `attemptedRole`, `reason` _(opt: `targetUserId`)_         |
| `sensitiveActionBlocked`    | `warn` | `blockedAction`, `reason`                                 |

#### `resource` — entity lifecycle

The **mutation** side of generic business entities (forms, projects, documents,
…) — complements `dataAccess` (read/export) and `userManagement` (accounts).
Downstream of auth: the actor `user_id` and `client_ip` are scope-read. Log the
resource type/id and _what_ changed (field names), never the contents.

| Event                  | Level    | Required fields                                                               |
| ---------------------- | -------- | ----------------------------------------------------------------------------- |
| `created`              | `notice` | `resourceType`, `resourceId`                                                  |
| `updated`              | `notice` | `resourceType`, `resourceId`, `changedFields`                                 |
| `deleted`              | `notice` | `resourceType`, `resourceId` _(opt: `reason`)_                                |
| `ownershipTransferred` | `notice` | `resourceType`, `resourceId`, `fromOwnerId`, `toOwnerId` _(opt: `ownerType`)_ |
