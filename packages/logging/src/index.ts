/**
 * A framework-agnostic structured logging core built on
 * {@link https://getpino.io/ | pino}. It standardises a flat, Datadog-aligned
 * newline-delimited JSON wire schema with custom syslog levels, scoped loggers
 * that accumulate an action path, contextual metadata, an oversized-context
 * guard, and pluggable error serialisation (a framework-neutral default,
 * overridable via {@link LoggingConfig.serializeError}).
 *
 * Call {@link createLogging} once at boot with your deployment identity, then
 * create request-scoped loggers from the returned {@link CreateLogger}.
 *
 * @packageDocumentation
 */

export type * from './audit/types.js'
export { serializeError } from './error.js'
export * from './logger.js'
export * from './types.js'
