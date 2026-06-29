import type { AuditLevel, EventSpec } from './spec.js'

/**
 * The base-logger capabilities the audit layer needs, injected by `LoggerImpl`
 * so this module never touches pino directly (it layers *above* the base).
 *
 * @internal
 */
export interface AuditDeps {
  /** The current scope bindings (snake_case wire keys) for scope-read asserts. */
  bindings: () => Record<string, unknown>
  /** Emit one line at the given audit level, with controlled fields + message. */
  emit: (level: AuditLevel, fields: Record<string, unknown>, message: string) => void
  /** The logger's current leaf action, read at call time. */
  action: () => string | undefined
}

type AuditPayload = Record<string, unknown> & { context?: Record<string, unknown>; messageOverride?: string }

/**
 * Assemble and emit one audit line from an {@link EventSpec} and a call payload:
 * promote canonical fields, read shared identity from scope (asserting required
 * fields are present), and stamp the `audit`/`category`/`event` Controlled
 * fields. Missing required scope, or a payload/scope mismatch on a promoted
 * field, emits a loud diagnostic rather than failing silently (ADR-0007).
 *
 * @internal
 */
export const emitAudit = (deps: AuditDeps, spec: EventSpec, input: object): void => {
  const payload = input as AuditPayload
  const bindings = deps.bindings()

  const action = deps.action()

  const diagnostic = (message: string, context: Record<string, unknown>) =>
    deps.emit('warn', { audit: true, category: spec.category, event: spec.event, action, context }, message)

  // Scope-read assertion: required shared identity must be on the bound scope.
  const missing = spec.requiredScope.filter(key => bindings[key] == null)
  if (missing.length > 0) {
    diagnostic('Audit event missing required scope field', { missing_scope: missing })
  }

  // Promote canonical payload fields to their top-level wire facet. Payload wins
  // over scope; a real disagreement is surfaced rather than silently resolved.
  const promoted: Record<string, unknown> = {}
  for (const [payloadKey, wireKey] of Object.entries(spec.promote)) {
    const value = payload[payloadKey]
    if (value == null) continue
    promoted[wireKey] = value
    const bound = bindings[wireKey]
    if (bound != null && bound !== value) {
      diagnostic('Audit field mismatch: payload overrides scope', {
        field: wireKey,
        scope_value: bound,
        payload_value: value,
      })
    }
  }

  // Event-specific fields land in context; free-form `context` merges on top.
  const context: Record<string, unknown> = {}
  for (const [payloadKey, wireKey] of Object.entries(spec.contextFields)) {
    const value = payload[payloadKey]
    if (value != null) context[wireKey] = value
  }
  if (payload.context) Object.assign(context, payload.context)

  // The event's stable default message, overridable per call.
  const message = payload.messageOverride ?? spec.message

  deps.emit(
    spec.level,
    {
      audit: true,
      category: spec.category,
      event: spec.event,
      action,
      ...promoted,
      context: Object.keys(context).length > 0 ? context : undefined,
    },
    message,
  )
}
