/**
 * The runtime spec table that drives audit emission. Each {@link EventSpec} is
 * the single source of truth for one event's category, level, which payload
 * fields are promoted to a canonical wire facet, which scope fields must be
 * present (runtime-asserted), and which payload fields land in `context`.
 *
 * The typed input interfaces in `./types.ts` are the compile-time mirror of
 * these specs; keep the two in sync. There is no "sensitive fields" entry — the
 * helper does not transform values (ADR-0007).
 *
 * @internal
 */

/** Severity an audit event may fire at. Bounded to `{ notice, warn }` (ADR-0007). */
export type AuditLevel = 'notice' | 'warn'

export interface EventSpec {
  /** Closed-taxonomy group, stamped as the `category` wire field. */
  category: string
  /** The specific event, stamped as the `event` wire field. */
  event: string
  /** Fixed severity for this event. */
  level: AuditLevel
  /** Stable, low-cardinality human message. */
  message: string
  /** payload key to its canonical wire field (promoted to top level; payload wins). */
  promote: Record<string, string>
  /** Scope (child-binding) keys that must be present; missing ones emit a diagnostic. */
  requiredScope: string[]
  /** payload key to its `context` wire key (snake_case). */
  contextFields: Record<string, string>
}

const authn = (event: string, spec: Omit<EventSpec, 'category' | 'event'>): EventSpec => ({
  category: 'authn',
  event,
  ...spec,
})

/** Authentication & session event specs. */
export const AUTHN_SPECS = {
  loginSucceeded: authn('loginSucceeded', {
    level: 'notice',
    message: 'Login succeeded',
    promote: { userId: 'user_id' },
    // user_agent is the device/browser signal (ADR-0007); client_ip the source.
    requiredScope: ['client_ip', 'user_agent'],
    contextFields: { role: 'role', privileged: 'privileged', username: 'username', sessionId: 'session_id' },
  }),
  loginFailed: authn('loginFailed', {
    level: 'notice',
    message: 'Login failed',
    promote: { userId: 'user_id' },
    requiredScope: ['client_ip'],
    contextFields: {
      username: 'username',
      reason: 'reason',
      attemptCount: 'attempt_count',
      privileged: 'privileged',
      role: 'role',
    },
  }),
  sessionCreated: authn('sessionCreated', {
    level: 'notice',
    message: 'Session created',
    promote: {},
    requiredScope: ['user_id', 'client_ip'],
    contextFields: { sessionId: 'session_id' },
  }),
  sessionTerminated: authn('sessionTerminated', {
    level: 'notice',
    message: 'Session terminated',
    promote: {},
    requiredScope: ['user_id', 'client_ip'],
    contextFields: { sessionId: 'session_id', reason: 'reason' },
  }),
  sessionTimedOut: authn('sessionTimedOut', {
    level: 'notice',
    message: 'Session timed out',
    promote: { userId: 'user_id' },
    // A timeout sweep may run with no request scope, so identity is payload-borne.
    requiredScope: ['client_ip'],
    contextFields: { sessionId: 'session_id' },
  }),
  tokenReused: authn('tokenReused', {
    level: 'warn',
    message: 'Session token reused',
    promote: {},
    requiredScope: ['user_id', 'client_ip'],
    contextFields: { tokenId: 'token_id', sessionId: 'session_id' },
  }),
} satisfies Record<string, EventSpec>

const userMgmt = (event: string, spec: Omit<EventSpec, 'category' | 'event'>): EventSpec => ({
  category: 'userManagement',
  event,
  ...spec,
})

// The actor is the request's bound `user_id` (scope-read); the target account is
// `targetUserId` in the payload, emitted as `context.target_user_id` — event
// data, never promoted to a root facet. `accountCreated` / `passwordReset` do not
// require `user_id` in scope: they may be self-service (self-signup, self reset),
// which has no admin actor.
/** User & permission management event specs. */
export const USER_MANAGEMENT_SPECS = {
  accountCreated: userMgmt('accountCreated', {
    level: 'notice',
    message: 'Account created',
    promote: {},
    requiredScope: ['client_ip'],
    contextFields: { targetUserId: 'target_user_id' },
  }),
  accountModified: userMgmt('accountModified', {
    level: 'notice',
    message: 'Account modified',
    promote: {},
    requiredScope: ['user_id', 'client_ip'],
    contextFields: { targetUserId: 'target_user_id', changedFields: 'changed_fields' },
  }),
  accountDeactivated: userMgmt('accountDeactivated', {
    level: 'notice',
    message: 'Account deactivated',
    promote: {},
    requiredScope: ['user_id', 'client_ip'],
    contextFields: { targetUserId: 'target_user_id', reason: 'reason' },
  }),
  accountDeleted: userMgmt('accountDeleted', {
    level: 'notice',
    message: 'Account deleted',
    promote: {},
    requiredScope: ['user_id', 'client_ip'],
    contextFields: { targetUserId: 'target_user_id' },
  }),
  roleChanged: userMgmt('roleChanged', {
    level: 'notice',
    message: 'Role changed',
    promote: {},
    requiredScope: ['user_id', 'client_ip'],
    contextFields: { targetUserId: 'target_user_id', oldRoles: 'old_roles', newRoles: 'new_roles' },
  }),
  mfaSettingChanged: userMgmt('mfaSettingChanged', {
    level: 'notice',
    message: 'MFA setting changed',
    promote: {},
    requiredScope: ['user_id', 'client_ip'],
    contextFields: { targetUserId: 'target_user_id', change: 'change' },
  }),
  apiKeyChanged: userMgmt('apiKeyChanged', {
    level: 'notice',
    message: 'API key changed',
    promote: {},
    requiredScope: ['user_id', 'client_ip'],
    contextFields: { targetUserId: 'target_user_id', keyId: 'key_id', action: 'action' },
  }),
  passwordReset: userMgmt('passwordReset', {
    level: 'notice',
    message: 'Password reset',
    promote: {},
    requiredScope: ['client_ip'],
    contextFields: { targetUserId: 'target_user_id', initiatedBy: 'initiated_by' },
  }),
} satisfies Record<string, EventSpec>

const dataAccess = (event: string, spec: Omit<EventSpec, 'category' | 'event'>): EventSpec => ({
  category: 'dataAccess',
  event,
  ...spec,
})

// Downstream of auth: actor (`user_id`) and `client_ip` are scope-read. Events
// log what was accessed (resource type/id, classification), never the data.
/** Data access, movement & export event specs. */
export const DATA_ACCESS_SPECS = {
  dataAccessed: dataAccess('dataAccessed', {
    level: 'notice',
    message: 'Data accessed',
    promote: {},
    requiredScope: ['user_id', 'client_ip'],
    contextFields: {
      resourceType: 'resource_type',
      resourceId: 'resource_id',
      accessType: 'access_type',
      classification: 'classification',
    },
  }),
  recordDownloaded: dataAccess('recordDownloaded', {
    level: 'notice',
    message: 'Record downloaded',
    promote: {},
    requiredScope: ['user_id', 'client_ip'],
    contextFields: {
      resourceId: 'resource_id',
      classification: 'classification',
      sizeBytes: 'size_bytes',
      method: 'method',
      resourceType: 'resource_type',
      role: 'role',
    },
  }),
  bulkExported: dataAccess('bulkExported', {
    level: 'notice',
    message: 'Bulk data exported',
    promote: {},
    requiredScope: ['user_id', 'client_ip'],
    contextFields: {
      destination: 'destination',
      classification: 'classification',
      recordCount: 'record_count',
      filters: 'filters',
    },
  }),
} satisfies Record<string, EventSpec>

const configChange = (event: string, spec: Omit<EventSpec, 'category' | 'event'>): EventSpec => ({
  category: 'configChange',
  event,
  ...spec,
})

// Admin actions: actor (`user_id`) and `client_ip` are scope-read. Log the
// setting/policy and old/new values (callers keep secrets out — values are config).
/** Application function & security-configuration change event specs. */
export const CONFIG_CHANGE_SPECS = {
  securityConfigChanged: configChange('securityConfigChanged', {
    level: 'notice',
    message: 'Security configuration changed',
    promote: {},
    requiredScope: ['user_id', 'client_ip'],
    contextFields: { setting: 'setting', oldValue: 'old_value', newValue: 'new_value' },
  }),
  policyChanged: configChange('policyChanged', {
    level: 'notice',
    message: 'Policy changed',
    promote: {},
    requiredScope: ['user_id', 'client_ip'],
    contextFields: { policyType: 'policy_type', summary: 'summary', oldValue: 'old_value', newValue: 'new_value' },
  }),
} satisfies Record<string, EventSpec>
