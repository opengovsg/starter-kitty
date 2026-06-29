/**
 * The shape of a single log call: a `message`, an optional `action` naming the
 * operation, and optional structured `context`, `error`, and `merged` fields.
 *
 * `action` is a single, optional string naming the current operation. Scoping
 * ({@link Logger.scope} / {@link Logger.setAction}) sets the leaf action; the
 * per-call `action` wins over it. Only that most-specific action is emitted.
 *
 * @public
 */
export interface LogInput {
  /** The log message. Keep it a stable, low-cardinality string — put variable
   * data in `context`, never interpolated here (the structured-first convention). */
  message: string
  /** The action for this call. Optional — most specific wins over the scoped path. */
  action?: string
  /** Free-form, app-owned business data, emitted as the `context` field. `action`
   * and `error` are reserved at the top level and forbidden here. */
  context?: {
    // We want action and error to be specified at the top level
    action?: never
    error?: never
    [key: string]: unknown
  }
  /** The error to shape and attach as the `error` field. Any thrown value is
   * accepted and normalised. Only valid on `warn` / `error`. */
  error?: unknown
  /** Escape-hatch bag merged at the top level of the line. Spread first, so it
   * can never clobber controlled fields (`action`, `history`, `context`). */
  merged?: Record<string, unknown>
}

/**
 * Structured logger with action scoping, contextual metadata, and severity
 * levels aligned to RFC 5424 (syslog).
 *
 * ## Choosing a level (the discriminator is *does someone need to act?*)
 *
 * - {@link Logger.debug | debug} — verbose diagnostics, only while actively debugging.
 * - {@link Logger.info | info} — the routine activity trail; no action implied.
 * - {@link Logger.notice | notice} — significant or **auditable** business events.
 * - {@link Logger.warn | warn} — something off but handled; no action needed now.
 * - {@link Logger.error | error} — an operation failed; a human should investigate.
 *
 * @public
 */
export interface Logger {
  /**
   * Return a **new** logger whose action is set to `action` (the most-specific
   * "leaf"; a per-call `action` still wins over it). The new logger inherits
   * this logger's context, **merged** with any additional context provided here.
   * Does not mutate the parent.
   *
   * Unlike `pino.child`, `scope` **merges** context (child *replaces* it), which
   * is why it is `scope`, not `child`. The pino child is `createBaseLogger`.
   *
   * @param options - `action`: the action to set. `context`: additional metadata
   *   merged with the parent context.
   * @returns A new {@link Logger} scoped to the given action.
   */
  scope(options: { action: string; context?: LogInput['context'] }): Logger

  /**
   * Append `action` to this logger's action path **in place** (mutates).
   *
   * ⚠️ Mutation is shared: if this logger is reused across concurrent requests
   * (e.g. a module-level singleton), the scope bleeds between them. Prefer
   * {@link Logger.scope} for request-scoped work.
   *
   * @param options - `action`: action name to append.
   * @returns The same logger instance, for chaining.
   */
  setAction(options: { action: string }): Logger

  /**
   * Merge `context` into this logger **in place** (mutates).
   *
   * ⚠️ Mutation is shared: see the caveat on {@link Logger.setAction}. Prefer
   * {@link Logger.withContext} when you need an isolated logger.
   *
   * @param options - `context`: contextual metadata to merge.
   * @returns The same logger instance, for chaining.
   */
  setContext(options: { context: LogInput['context'] }): Logger

  /**
   * Return a **new** logger with `context` merged into the existing one,
   * leaving the original logger unchanged.
   *
   * @param options - `context`: contextual metadata to merge.
   * @returns A new {@link Logger} with the merged context.
   */
  withContext(options: { context: LogInput['context'] }): Logger

  /**
   * Verbose diagnostic detail useful only while actively debugging (e.g.
   * branch traces, intermediate values). Typically disabled in production.
   * No one is expected to act on it.
   */
  debug(input: Omit<LogInput, 'error'>): void

  /**
   * Routine, expected business events that form the normal activity trail
   * (e.g. a request handled, a record read). Useful for reconstructing what
   * happened; no action implied. This is the default level — reach for
   * `notice` when an event is auditable, or `warn`/`error` when something is off.
   */
  info(input: Omit<LogInput, 'error'>): void

  /**
   * Significant or **auditable** business events that are normal but worth
   * recording for later reconstruction — e.g. ownership transfer, mutating a
   * critical resource, a permission change, an authentication. Not an error:
   * `notice` carries no `error` field.
   */
  notice(input: Omit<LogInput, 'error'>): void

  /**
   * Something is off but was handled or recovered and needs no immediate
   * action (e.g. a retry, a fallback path taken, a deprecated route hit). May
   * carry an `error` for context.
   */
  warn(input: LogInput): void

  /**
   * An operation failed and a human likely needs to investigate (potentially
   * page-worthy). Carries the `error` that caused the failure.
   */
  error(input: LogInput): void
}

/**
 * A simplified logger interface that both console and {@link Logger} can implement, for shared client and server side code.
 *
 * @public
 */
export interface BasicLogger<Input extends Partial<LogInput> = LogInput> {
  /** Verbose diagnostics; carries no error. */
  debug: (_: Omit<Input, 'error'>) => void
  /** Routine activity trail; carries no error. */
  info: (_: Omit<Input, 'error'>) => void
  /** Something off but handled; may carry an error. */
  warn: (_: Input) => void
  /** An operation failed; carries the error. */
  error: (_: Input) => void
}

/**
 * A mixin shape for objects that carry a {@link Logger} on a `logger` field.
 *
 * @public
 */
export interface WithLogger<T extends Logger = Logger> {
  /** The carried logger instance. */
  logger: T
}
