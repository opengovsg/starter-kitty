/**
 * The default error serialiser: shapes an already-normalised `Error` into the
 * flat object emitted as the `error` wire field. Framework-neutral — it reads no
 * framework-specific fields (e.g. it does **not** map a tRPC `code` to `kind`).
 *
 * Produces `{ ...ownEnumerableProps, kind, message, stack, cause }`:
 * - `kind`    – the error's class name (`err.name`), Datadog's `error.kind` facet.
 * - `message` / `stack` / `cause` – the native fields (non-enumerable, so added
 *   explicitly rather than via the spread).
 * - any own enumerable properties the error carries (e.g. a tRPC `code`) survive
 *   on the wire under `error`, just not lifted into `kind`.
 *
 * Override via {@link LoggingConfig.serializeError} to add framework-specific
 * shaping (e.g. tRPC `code` → `kind`, NestJS `HttpException`).
 *
 * @public
 */
export function serializeError(err: Error): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const key of Object.keys(err)) {
    fields[key] = (err as unknown as Record<string, unknown>)[key]
  }
  return {
    ...fields,
    // `error.kind` is Datadog's standard error-type attribute. The class name is
    // the neutral discriminator; framework codes (tRPC, etc.) are a consumer
    // override, not the base default.
    kind: err.name,
    // `message` / `stack` / `cause` are non-enumerable on Error, so the spread
    // above drops them — add them explicitly.
    message: err.message,
    stack: err.stack,
    cause: err.cause,
  }
}

/**
 * A synthetic error class used to wrap non-Error objects while preserving their properties.
 */
class SyntheticError extends Error {
  [key: string]: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  // check that value is object
  return !!value && !Array.isArray(value) && typeof value === 'object'
}

/**
 * Normalises an unknown thrown value into an `Error` (or `undefined`).
 *
 * - `Error` instances are returned as-is.
 * - Primitives (string, number, etc.) are wrapped with `new Error(String(value))`.
 * - Plain objects are copied onto a synthetic `Error` so their properties are preserved.
 * - `null`, `undefined`, and functions return `undefined`.
 *
 * @internal
 */
export function getCauseFromUnknown(cause: unknown): Error | undefined {
  if (cause instanceof Error) {
    return cause
  }

  const type = typeof cause
  if (type === 'undefined' || type === 'function' || cause === null) {
    return undefined
  }

  // Primitive types just get wrapped in an error
  if (type !== 'object') {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return new Error(String(cause))
  }

  // If it's an object, we'll create a synthetic error.
  // Iterate only own enumerable keys and explicitly skip prototype-mutating
  // keys to avoid prototype pollution when copying attacker-controlled data.
  if (isObject(cause)) {
    const err = new SyntheticError()
    for (const key of Object.keys(cause)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue
      }
      err[key] = cause[key]
    }
    return err
  }

  return undefined
}
