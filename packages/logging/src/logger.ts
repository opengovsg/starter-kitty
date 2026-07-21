import type { DestinationStream, Logger as PinoLogger } from 'pino'
import createPino, { destination } from 'pino'
import { PinoPretty } from 'pino-pretty'

import { createAuditLogger } from './audit/index.js'
import type { AuditLogger } from './audit/types.js'
import { serializeContext } from './context.js'
import { getCauseFromUnknown, serializeError } from './error.js'
import type { Logger, LogInput } from './types.js'

/**
 * Severity levels this logger emits, ordered by RFC 5424 (syslog). `silent`
 * disables all output.
 *
 * @public
 */
export type LogLevel = 'silent' | 'debug' | 'info' | 'notice' | 'warn' | 'error'

/**
 * Deployment config passed to {@link createLogging}. The core reads no
 * environment variables of its own — the consuming app injects these.
 *
 * @public
 */
export interface LoggingConfig {
  /** Deployment environment, bound on every line as `env`. Required — no default. */
  env: string
  /**
   * Service name, bound on every line as `service`. Completes Datadog unified
   * tagging (`env` + `service` + `version`). Required — no default.
   */
  service: string
  /** Application version, bound on every line as `version`. Required — no default. */
  version: string
  /** Minimum level to emit. `silent` disables output. Optional; defaults to `info`. */
  level?: LogLevel
  /** Pretty-print to the console (dev) instead of NDJSON to stdout. Optional; defaults to `false`. */
  pretty?: boolean
  /**
   * Shape a thrown error into the `error` wire field. Receives an
   * already-normalised `Error` (any non-`Error` thrown value is normalised
   * first), set once here for the whole factory. Optional; defaults to the
   * framework-neutral {@link serializeError}. Override to add framework-specific
   * shaping — e.g. mapping a tRPC `code` to `error.kind`, or a NestJS
   * `HttpException` status.
   */
  serializeError?: (err: Error) => Record<string, unknown>
}

/** Config with behavioral defaults resolved — what {@link buildPino} consumes. */
type ResolvedConfig = Omit<LoggingConfig, 'level' | 'pretty'> & { level: LogLevel; pretty: boolean }

/**
 * Metadata for a **request-less** ("system") {@link Logger} — process startup,
 * background jobs, cron, queue consumers, CLI. These contexts have no client
 * identity, so `clientIp` / `userAgent` are absent here; bind a request logger
 * with {@link LoggerOptions} instead when handling an HTTP request.
 *
 * @public
 */
export interface SystemLoggerOptions {
  /** The request path or operation entry point. Bound as the `path` Scope field. Required. */
  path: string
  /** Where the log originated, e.g. `trpc` / `rest`. Bound as `source`. Accepts `null` (e.g. from `headers.get`). */
  source?: string | null
  /**
   * Distributed-trace correlation ID, bound as `trace_id`. **Usually leave this
   * unset**: with dd-trace running, log injection (`DD_LOGS_INJECTION`, on by
   * default) already stamps `dd.trace_id` on every line from the active span -
   * per line, so it also works in jobs, queues, and cron, and Datadog
   * correlates on it natively. Set this only for a non-APM sink that needs a
   * trace id under this schema's own `trace_id` key; for a gateway-minted ID
   * chained across systems, use {@link SystemLoggerOptions.correlationId}
   * instead. Accepts `null` (e.g. from `headers.get`); a `null` value is
   * omitted from the line.
   */
  traceId?: string | null
  /** The acting user's ID. Bound as `user_id` — the canonical user-correlation facet. */
  userId?: string
  /** The client device identifier. Bound as `device_id`. */
  deviceId?: string
  /** Cross-system request correlation ID. Bound as `correlation_id`. */
  correlationId?: string
  /** The client build version. Bound as `client_version`; drives `is_latest_version`. Accepts `null` (e.g. from `headers.get`). */
  clientVersion?: string | null
  /** The server build version. Bound as `server_version`; drives the computed `is_latest_version`. */
  serverVersion?: string
}

/**
 * Per-request metadata for a request-scoped {@link Logger}. Extends
 * {@link SystemLoggerOptions} with the request identity every request line should
 * carry. `clientIp` and `userAgent` are **required keys** that accept
 * `string | null | undefined`: the caller must *acknowledge* them — forgetting
 * the key is a compile error — and pass `null`/`undefined` explicitly when the
 * value is genuinely absent (e.g. a missing `headers.get(...)`), rather than
 * leaving it off by accident. `traceId` is optional: trace correlation comes
 * from dd-trace log injection (see {@link SystemLoggerOptions.traceId}). For
 * request-less contexts use {@link SystemLoggerOptions} via
 * `createLogging(...).system(...)`, where the client identity does not exist.
 *
 * @public
 */
export interface LoggerOptions extends SystemLoggerOptions {
  /**
   * The originating client IP (vendor-neutral; not edge-specific). Bound as
   * `client_ip`. Required key — pass `null`/`undefined` if the header is absent.
   */
  clientIp: string | null | undefined
  /**
   * The client `User-Agent`. Bound as `user_agent`. Required key — pass
   * `null`/`undefined` if the header is absent.
   */
  userAgent: string | null | undefined
}

/** What {@link bindChild} accepts — either logger shape; client identity optional internally. */
type AnyLoggerOptions = SystemLoggerOptions & { clientIp?: string | null; userAgent?: string | null }

/**
 * The root-level identity {@link Logger.withBindings} can bind on an existing
 * logger. Deliberately narrow: only the acting user, which may be learned
 * *after* creation. Request-fixed facets (`client_ip`, `user_agent`, `path`,
 * versions) are set once at creation and inherited untouched. Module-local: the
 * public {@link Logger.withBindings} inlines this shape to avoid a `types.ts`
 * import of `logger.ts` (a cycle).
 */
type LateBindings = Pick<SystemLoggerOptions, 'userId'>

/**
 * A {@link Logger} factory bound to a fixed {@link LoggingConfig}, returned by
 * {@link createLogging}. Call it directly for a **request** logger (client
 * identity required via {@link LoggerOptions}); call `.system(...)` for a
 * **request-less** logger (startup, jobs, cron — {@link SystemLoggerOptions}).
 *
 * @public
 */
export interface CreateLogger {
  /** Create a request-scoped logger; `clientIp` + `userAgent` are required. */
  (options: LoggerOptions): Logger
  /** Create a request-less ("system") logger — startup, background jobs, cron, CLI. */
  system(options: SystemLoggerOptions): Logger
}

/**
 * Build the pino instance for a given config. Eager: called once per
 * {@link createLogging}, never rebuilt.
 */
const buildPino = (config: ResolvedConfig) => {
  let transport: ReturnType<typeof destination> | DestinationStream
  if (config.pretty) {
    transport = PinoPretty({
      colorize: true,
      hideObject: false,
      messageKey: 'message',
      timestampKey: 'timestamp',
      messageFormat: '[{path}] {message}',
    })
  } else {
    transport = destination(1)
  }
  // dd-trace's ESM instrumentation wraps Pino's default export. Calling the
  // `pino` named export here would bypass that wrapper and disable log
  // injection for ESM applications.
  return createPino(
    {
      level: config.level,
      useOnlyCustomLevels: true,
      customLevels: {
        error: 50,
        warn: 40,
        notice: 30,
        info: 20,
        debug: 10,
      },
      // Key is `timestamp` (in Datadog's default date-attribute list; `time` is
      // not), so pino.stdTimeFunctions don't fit — they all emit the `time` key.
      // Epoch millis as an unquoted number: no in-process formatting (the cheap
      // path, like pino's epochTime); the sink renders it.
      timestamp: () => `,"timestamp":${Date.now()}`,
      formatters: {
        bindings: bindings => {
          // The unified-tagging trio, then scope bindings (which win on the rare
          // name clash). Base fields are deliberately a curated set — no open bag
          // — to bound root-level cardinality (and Datadog cost).
          return {
            env: config.env,
            service: config.service,
            version: config.version,
            ...bindings,
          }
        },
        level: label => {
          return { level: label.toUpperCase() }
        },
      },
      errorKey: 'error',
      messageKey: 'message',
    },
    transport,
  )
}

/**
 * The root instance or any child of it — what `bindChild` accepts. A child
 * widens `useOnlyCustomLevels` from the root's `true` to `boolean`, so this
 * (`boolean`) covers both: the root binds at creation, `withBindings` re-binds
 * onto an existing child.
 */
type PinoChild = PinoLogger<'error' | 'warn' | 'notice' | 'info' | 'debug', boolean>

/*
  The child loggers we hand out inherit the bindings and transport from the
  parent instance. Use child loggers to avoid creating a new pino instance for
  every request / unit of work.
*/
const bindChild = (instance: PinoChild, options: Partial<AnyLoggerOptions>) => {
  const { source, path, traceId, userId, deviceId, userAgent, correlationId, clientIp, clientVersion, serverVersion } =
    options
  // Coalesce `null` -> `undefined` on the header-sourced fields (`headers.get`
  // returns `string | null`): pino omits `undefined` but would emit a literal
  // `null`, which we never want on the wire.
  return instance.child({
    path,
    trace_id: traceId ?? undefined,
    user_id: userId,
    device_id: deviceId,
    correlation_id: correlationId,
    client_ip: clientIp ?? undefined,
    user_agent: userAgent ?? undefined,
    client_version: clientVersion ?? undefined,
    server_version: serverVersion,
    source: source ?? undefined,
    // Only meaningful when both versions are known. Omit it otherwise rather
    // than report a misleading `true` from `undefined === undefined`.
    is_latest_version: clientVersion && serverVersion ? clientVersion === serverVersion : undefined,
  })
}

/**
 * Merge two context bags, returning `null` when the result has no keys — so an
 * empty context is never *stored* as `{}` (which is truthy and would force a
 * useless per-call merge on every log line).
 */
const mergeContext = (
  base: NonNullable<LogInput['context']> | null,
  extra: LogInput['context'],
): NonNullable<LogInput['context']> | null => {
  if (!base && !extra) return null
  const merged = { ...base, ...extra }
  return Object.keys(merged).length > 0 ? merged : null
}

/**
 * The default {@link Logger} implementation: wraps a pino child logger and adds
 * action scoping, context merging, the oversized-context guard, and error
 * shaping via the factory's `serializeError`.
 *
 * Not part of the public API — construct loggers via the {@link CreateLogger}
 * returned by {@link createLogging} and depend on the {@link Logger} interface instead.
 *
 * @internal
 */
class LoggerImpl implements Logger {
  private logger: ReturnType<typeof bindChild>
  /** The error serialiser fixed by the factory config; propagated to scoped children. */
  private serializeError: (err: Error) => Record<string, unknown>
  private context: NonNullable<LogInput['context']> | null
  /** The most-specific action in scope (the leaf). Per-call `action` still wins. */
  private action: string | null
  /** Lazily-built, memoised `audit` namespace; see the `audit` getter. */
  private _audit?: AuditLogger

  constructor(
    logger: ReturnType<typeof bindChild>,
    serialize: (err: Error) => Record<string, unknown>,
    options?: {
      action?: string | null
      context?: NonNullable<LogInput['context']> | null
    },
  ) {
    this.logger = logger
    this.serializeError = serialize
    this.action = options?.action ?? null
    this.context = options?.context ?? null
  }

  scope(options: { action: string; context?: LogInput['context'] }): Logger {
    return new LoggerImpl(this.logger, this.serializeError, {
      action: options.action,
      context: mergeContext(this.context, options.context),
    })
  }

  setAction(options: { action: string }) {
    this.action = options.action
    return this
  }

  withContext(options: { context: LogInput['context'] }) {
    return new LoggerImpl(this.logger, this.serializeError, {
      action: this.action,
      context: mergeContext(this.context, options.context),
    })
  }

  withBindings(bindings: LateBindings) {
    // Root-level facet, not context: a fresh pino child inherits the parent's
    // bindings and merges these on top, so audit scope-read asserts (e.g.
    // `user_id`) see it. `bindChild` maps only the fields present, so
    // `client_ip`/`user_agent`/`path` are inherited untouched. For identity
    // learned mid-request (the acting user is known only after login), unlike
    // `withContext` which lands in `context`. Action and context carry over
    // unchanged, matching `scope`/`withContext` immutability.
    return new LoggerImpl(bindChild(this.logger, bindings), this.serializeError, {
      action: this.action,
      context: this.context,
    })
  }

  setBindings(bindings: LateBindings) {
    // The mutating twin of `withBindings`: swap in a child that merges the new
    // root facets, so it persists for the rest of this logger's lifecycle. The
    // audit closure and routine path both read `this.logger` at call time, so
    // every subsequent line picks the rebinding up.
    this.logger = bindChild(this.logger, bindings)
    return this
  }

  setContext(options: { context: LogInput['context'] }) {
    this.context = mergeContext(this.context, options.context)
    return this
  }

  /**
   * The audit helper namespace. Built on first access and memoised, so a logger
   * that emits no audit event pays nothing (ADR-0007). The injected callbacks
   * read scope and action *at call time*, so they track `setAction` mutations.
   */
  get audit(): AuditLogger {
    return (this._audit ??= createAuditLogger({
      bindings: () => this.logger.bindings(),
      emit: (level, fields, message) => {
        // Pull the audit-assembled context out, merge the logger's scoped
        // context beneath it, and run the same guard the routine path uses
        // (ADR-0008). `emitAudit` stays ignorant of scope, pino, and the guard;
        // controlled fields + promoted facets in `rest` pass straight through.
        const { context: ownContext, ...rest } = fields
        const context = this.guardContext(rest.action as string | undefined, ownContext as LogInput['context'])
        this.logger[level]({ ...rest, context }, message)
      },
      action: () => this.action ?? undefined,
    }))
  }

  debug(input: Omit<LogInput, 'error'>) {
    return this.formatLog('debug', input)
  }
  info(input: Omit<LogInput, 'error'>) {
    return this.formatLog('info', input)
  }
  notice(input: Omit<LogInput, 'error'>) {
    return this.formatLog('notice', input)
  }
  warn(input: LogInput) {
    return this.formatLogWithErrors('warn', input)
  }
  error(input: LogInput) {
    return this.formatLogWithErrors('error', input)
  }

  private formatLog(level: 'debug' | 'info' | 'notice', input: Omit<LogInput, 'error'>) {
    const { message, context, merged, ...rest } = this.formatInput(input)
    // `merged` is an arbitrary escape-hatch bag, spread first so it can never
    // clobber the logger-controlled fields (`action`, `context`).
    return this.logger[level]({ ...merged, ...rest, context }, message)
  }

  private formatLogWithErrors(level: 'warn' | 'error', input: LogInput) {
    const { message, context, error, merged, ...rest } = this.formatInput(input)

    // Accept any thrown value: non-Error values are normalised to an `Error`, so
    // a thrown string/object still produces a shaped `error` field. The shaping
    // itself is the factory's `serializeError` (a framework-neutral default,
    // overridable per deployment) — the base logger no longer reads any
    // framework-specific field off the error.
    const err = getCauseFromUnknown(error)

    if (err) {
      // `merged` first so it can't clobber the controlled fields below.
      return this.logger[level]({ ...merged, ...rest, context, error: this.serializeError(err) }, message)
    }

    return this.logger[level]({ ...merged, ...rest, context }, message)
  }

  private formatInput(input: Omit<LogInput, 'error'>): Omit<LogInput, 'action'> & { action?: string } {
    // Per-call action wins over the scoped leaf; omitted entirely when neither is
    // set (the `action` key is then absent from the line, not `''`).
    const action = input.action ?? this.action ?? undefined
    const context = this.guardContext(action, input.context)
    return { ...input, action, context }
  }

  /**
   * Merge the logger's scoped context beneath the line's own context, run it
   * through the Context guard, and emit the guard's diagnostic lines (attaching
   * `action`). Returns the safe context to attach. Shared by the routine path
   * ({@link formatInput}) and the audit `emit` closure (ADR-0008), so scoped
   * context and the guard apply identically to both. The diagnostic lines bypass
   * this method (they go straight to the transport), so the guard never recurses.
   */
  private guardContext(action: string | undefined, ownContext: LogInput['context']): LogInput['context'] {
    const merged = mergeContext(this.context, ownContext) ?? undefined
    const { context, emissions } = serializeContext(merged)
    for (const emission of emissions) {
      this.logger[emission.level]({ action, context: emission.context }, emission.message)
    }
    return context
  }
}

/**
 * Build a {@link CreateLogger} bound to a fixed deployment config. Call once at
 * process boot with values mapped from your app's own environment, and
 * re-export the result so call sites can create request-scoped loggers:
 *
 * ```ts
 * // src/logger.ts — owned by the app
 * export const createBaseLogger = createLogging({ env, service, version })
 * ```
 *
 * The returned factory is immutable: config is fixed at creation and the pino
 * instance is built once. To run with different config, create another factory.
 *
 * `env`, `service`, and `version` are required — deployment identity must be
 * explicit. `level` (default `info`) and `pretty` (default `false`) are
 * optional. Never throws.
 *
 * @public
 */
export const createLogging = (config: LoggingConfig): CreateLogger => {
  const instance = buildPino({
    env: config.env,
    service: config.service,
    version: config.version,
    level: config.level ?? 'info',
    pretty: config.pretty ?? false,
  })
  // Error-shaping policy is fixed for the life of the factory, like `level`.
  const serialize = config.serializeError ?? serializeError
  const make = (options: AnyLoggerOptions): Logger => new LoggerImpl(bindChild(instance, options), serialize)
  const create = ((options: LoggerOptions): Logger => make(options)) as CreateLogger
  create.system = (options: SystemLoggerOptions): Logger => make(options)
  return create
}
