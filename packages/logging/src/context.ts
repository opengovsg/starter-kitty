import type { LogInput } from './types.js'

type Context = LogInput['context']

/**
 * Max serialised context length, in characters, before the context guard drops
 * it.
 *
 * Based on empirical testing, a log line exceeding 262118 characters is broken
 * into multiple lines, producing malformed JSON. We cap the context at 200,000
 * characters to leave room for the message, action, and other line fields.
 *
 * @internal
 */
export const MAX_CONTEXT_CHARS = 2e5

/**
 * A diagnostic line the guard wants emitted in place of the dropped context.
 * `context` is the patch to write under the line's `context` field; omitted when
 * the line carries no context of its own. The caller attaches scope
 * (`action`) and writes it.
 *
 * @internal
 */
export interface ContextEmission {
  level: 'warn' | 'error'
  message: string
  context?: Record<string, unknown>
}

/**
 * The safe context plus any diagnostic lines to emit alongside it.
 *
 * @internal
 */
export interface SerializedContext {
  context: Context | undefined
  emissions: ContextEmission[]
}

/**
 * The context guard: turn a merged context into something safe to emit.
 *
 * - `undefined` or an empty object → `undefined` (the line omits `context`).
 * - Serialises to more than `maxChars` chars → dropped and replaced with a
 *   marker, plus a size warning and the original serialised in `maxChars` chunks
 *   (so an operator can still recover it from the diagnostic lines).
 * - Unserialisable (e.g. circular) → dropped and replaced with a marker, plus a
 *   single error line.
 *
 * Pure: it never writes anything itself. The caller emits the returned
 * {@link ContextEmission}s, attaching scope.
 *
 * @internal
 */
export const serializeContext = (
  context: Context | undefined,
  maxChars: number = MAX_CONTEXT_CHARS,
): SerializedContext => {
  // Scoping always carries a context object (possibly empty); drop it when empty
  // so scoped lines don't emit a noisy `"context": {}`.
  const ctx = context && Object.keys(context).length > 0 ? context : undefined
  if (!ctx) return { context: undefined, emissions: [] }

  try {
    const stringified = JSON.stringify(ctx)

    if (stringified.length > maxChars) {
      const emissions: ContextEmission[] = [
        { level: 'warn', message: 'Log context is too large', context: { size: stringified.length } },
      ]
      const chunks = Math.floor(stringified.length / maxChars) + 1
      for (let i = 0; i < stringified.length; i += maxChars) {
        emissions.push({
          level: 'warn',
          message: 'Removed context',
          context: {
            chunk: Math.floor(i / maxChars) + 1,
            chunks,
            data: stringified.slice(i, Math.min(stringified.length, i + maxChars)),
          },
        })
      }
      return { context: { logger: '[Context removed]' }, emissions }
    }
  } catch {
    return {
      context: { logger: '[Context removed]' },
      emissions: [{ level: 'error', message: 'Failed to serialise log context' }],
    }
  }

  return { context: ctx, emissions: [] }
}
