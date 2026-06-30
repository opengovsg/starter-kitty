# @opengovsg/starter-kitty-logging

A framework-agnostic structured logging core built on [pino](https://getpino.io/).
It standardises the log wire format (newline-delimited JSON aligned to Datadog),
provides a scoped logger with actions and contextual metadata, and a closed
taxonomy of audit events. It reads no environment variables of its own.

## Installation

```bash
npm i --save @opengovsg/starter-kitty-logging
```

## Setup

```javascript
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

Call `createLogging` once and re-export the result. `env`, `service`, and
`version` are required; `level` (default `info`) and `pretty` (default `false`)
are optional. The factory is immutable and never throws.

## Logging

```javascript
import { createBaseLogger } from '~/logger'

const logger = createBaseLogger({
  path: '/api/widgets',
  source: req.headers.get('x-source'),
  traceId: req.headers.get('x-trace-id'),
  clientIp: req.headers.get('cf-connecting-ip'),
  userAgent: req.headers.get('user-agent'),
})

logger.info({ message: 'Widget fetched', action: 'getWidget', context: { widget_id: widgetId } })
```

Request-scoped loggers require `traceId`, `clientIp`, and `userAgent` keys (they
accept `string | null | undefined`, so a missing header passes `null`).

```javascript
const startupLogger = createBaseLogger.system({ path: 'redis:startup' })
startupLogger.info({ message: 'Redis connected', action: 'boot' })
```

`.system(...)` is the request-less shape for startup, jobs, cron, and CLI, where
no client identity (`clientIp` / `userAgent`) exists.

Pass a stable `message` plus structured fields; put business data in `context`
(emitted as-is, so prefer `snake_case`). Never interpolate values into the
`message` string - it defeats grouping and search.

## Choosing a level

| Level    | Use when                                                                      | Carries `error`? |
| -------- | ----------------------------------------------------------------------------- | ---------------- |
| `error`  | An operation failed and a human likely needs to investigate.                  | Yes              |
| `warn`   | Something is off but was handled/recovered and needs no immediate action.     | Optional         |
| `notice` | A significant or auditable business event (auth, ownership, permissions).     | No               |
| `info`   | Routine, expected business events forming the normal activity trail.          | No               |
| `debug`  | Verbose diagnostic detail useful only while actively debugging.               | No               |

`notice` is the audit rung. It sits below `warn` in syslog ordering, so keep the
production `level` at `notice` or lower and filter at the sink, or audit lines
are dropped at the source.

## Scoping

```javascript
const scoped = logger.scope({ action: 'createUser' })
scoped.info({ message: 'validating', action: 'validateEmail' })
// => action: "validateEmail"
scoped.info({ message: 'saving' })
// => action: "createUser"
```

`scope({ action, context? })` and `withContext({ context })` return a new logger
with merged context (immutable, safe for request scoping). `setAction` /
`setContext` mutate in place - avoid them on a shared logger, as scope bleeds
between concurrent requests.

## Error serialisation

```javascript
import { createLogging, serializeError } from '@opengovsg/starter-kitty-logging'

export const createBaseLogger = createLogging({
  env,
  service,
  version,
  // Wrap the neutral default to lift a tRPC `code` into `kind`.
  serializeError: err => ({ ...serializeError(err), kind: (err as { code?: string }).code ?? err.name }),
})
```

`error` accepts any thrown value (normalised to an `Error` first). The default
shaping is framework-neutral - override `serializeError` once on the factory to
recover framework-specific shaping such as a tRPC `code` or NestJS status.

## Audit events

```javascript
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

`logger.audit.<category>.<event>(input)` emits a compliance-auditable event from
a closed taxonomy. Each event has a fixed, type-enforced shape: the helper stamps
`audit: true`, `category`, and `event`; promotes canonical facets (`userId` ->
top-level `user_id`); reads shared identity (`user_id`, `client_ip`) from the
bound scope; and fixes the level per event. Secrets are never fields. Audit lives
on the server `Logger` only.

Every event also accepts `context?` (merged extra fields) and `messageOverride?`.
The categories and their events:

| Category         | Purpose                                  | Events                                                                                                                          |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `authn`          | Authentication & session                 | `loginSucceeded`, `loginFailed`, `sessionCreated`, `sessionTerminated`, `sessionTimedOut`, `tokenReused`                       |
| `userManagement` | User & permission management             | `accountCreated`, `accountModified`, `accountDeactivated`, `accountDeleted`, `roleChanged`, `mfaSettingChanged`, `apiKeyChanged`, `passwordReset` |
| `dataAccess`     | Data access, movement & export           | `dataAccessed`, `recordDownloaded`, `bulkExported`                                                                             |
| `configChange`   | App & security-configuration changes     | `securityConfigChanged`, `policyChanged`                                                                                       |
| `apiUsage`       | API token lifecycle & sensitive access   | `tokenIssued`, `tokenRefreshed`, `tokenInvalidated`, `sensitiveEndpointAccessed`                                               |
| `failures`       | Handled security denials (`warn`)        | `accessDenied`, `privilegeEscalationDenied`, `sensitiveActionBlocked`                                                          |
| `resource`       | Entity lifecycle (mutations)             | `created`, `updated`, `deleted`, `ownershipTransferred`                                                                        |

See the [`@opengovsg/starter-kitty-logging` README](https://github.com/opengovsg/starter-kitty/blob/develop/packages/logging/README.md)
for each event's required fields.
