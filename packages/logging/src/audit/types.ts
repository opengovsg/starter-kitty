/**
 * The fixed-shape **audit** helper layer — `logger.audit.<category>.<event>(…)`.
 *
 * Each method records one auditable business event from a closed, governed
 * taxonomy (ADR-0007). Unlike the free-form base logger, every event has a
 * *fixed, type-enforced shape*: required fields are mandatory at compile time,
 * shared identity is read from the bound scope, and the helper stamps the
 * Controlled wire fields `audit`, `category`, and `event`.
 *
 * The helper performs **no value transformation**: secrets are kept out *by
 * shape* (they are never fields) and PII is left to the sink. See ADR-0007.
 *
 * @public
 */
export interface AuditLogger {
  /** Authentication & session events. */
  authn: AuthnAudit
  /** User & permission management events. */
  userManagement: UserManagementAudit
  /** Data access, movement & export events. */
  dataAccess: DataAccessAudit
  /** Application function & security-configuration change events. */
  configChange: ConfigChangeAudit
  /** API usage events — token lifecycle and sensitive-endpoint access. */
  apiUsage: ApiUsageAudit
}

/**
 * Authentication & session audit events (category `authn`).
 *
 * @public
 */
export interface AuthnAudit {
  /** A successful interactive login. Fires at `notice`. */
  loginSucceeded(input: LoginSucceededInput): void
  /** A failed login attempt. Fires at `notice`. */
  loginFailed(input: LoginFailedInput): void
  /** A session was created (e.g. cookie sealed at login). Fires at `notice`. */
  sessionCreated(input: SessionCreatedInput): void
  /** A session was explicitly ended (logout / destroy). Fires at `notice`. */
  sessionTerminated(input: SessionTerminatedInput): void
  /** A session expired by inactivity/TTL. Fires at `notice`. */
  sessionTimedOut(input: SessionTimedOutInput): void
  /** A session/auth token was replayed — a theft signal. Fires at `warn`. */
  tokenReused(input: TokenReusedInput): void
}

/**
 * Free-form business fields an audit call may carry in addition to its fixed
 * shape. Merged into the line's `context`. App-owned; keep keys `snake_case`.
 *
 * @public
 */
export type AuditContext = Record<string, unknown>

/**
 * Fields every audit input accepts in addition to its event-specific shape.
 *
 * @public
 */
export interface AuditInputBase {
  /**
   * Override the event's **stable default** message (e.g. `loginSucceeded`
   * defaults to `"Login succeeded"`). Omit to use that default — the key is named
   * `messageOverride` precisely to signal a default already exists. Prefer the
   * default unless a call site genuinely needs a more specific human message;
   * grouping/filtering keys off `event`/`category`, not the message.
   */
  messageOverride?: string
  /** Optional free-form business fields, merged into the `context` field. */
  context?: AuditContext
}

/** Input for {@link AuthnAudit.loginSucceeded}. @public */
export interface LoginSucceededInput extends AuditInputBase {
  /** The authenticated user. Promoted to the canonical `user_id` facet. */
  userId: string
  /** The user's role at login. */
  role: string
  /** Whether this is a privileged account login (flagged in the matrix). */
  privileged: boolean
  /** The login handle (may differ from `userId`). Optional. */
  username?: string
  /** Session identifier, if a session was created. Absent for stateless auth. */
  sessionId?: string
}

/** Input for {@link AuthnAudit.loginFailed}. @public */
export interface LoginFailedInput extends AuditInputBase {
  /** The attempted login handle — the only identity known on a failed attempt. */
  username: string
  /** Low-cardinality failure reason, e.g. `bad_password`, `unknown_user`. */
  reason: string
  /** Number of attempts in the current window. */
  attemptCount: number
  /** Whether a privileged account was targeted. */
  privileged: boolean
  /** The resolved user, if the account was known. Promoted to `user_id`. */
  userId?: string
  /** The user's role, if known. */
  role?: string
}

/** Input for {@link AuthnAudit.sessionCreated}. @public */
export interface SessionCreatedInput extends AuditInputBase {
  /** Session identifier (a non-impersonatable reference, not the bearer token). */
  sessionId: string
}

/** Input for {@link AuthnAudit.sessionTerminated}. @public */
export interface SessionTerminatedInput extends AuditInputBase {
  /** The session being ended (a reference, not the bearer token). */
  sessionId: string
  /** Why the session ended, e.g. `logout`, `revoked`. */
  reason: string
}

/** Input for {@link AuthnAudit.sessionTimedOut}. @public */
export interface SessionTimedOutInput extends AuditInputBase {
  /** The session owner. Promoted to `user_id` (a timeout sweep has no scope). */
  userId: string
  /** The timed-out session (a reference, not the bearer token). */
  sessionId: string
}

/** Input for {@link AuthnAudit.tokenReused}. @public */
export interface TokenReusedInput extends AuditInputBase {
  /** The reused token's identifier (a reference, not the token value). */
  tokenId: string
  /** The session the token belonged to, if any. */
  sessionId?: string
}

/**
 * User & permission management audit events (category `userManagement`).
 *
 * These act on a *target* account that is usually distinct from the *actor*: the
 * actor is the authenticated request's `user_id` (read from scope), the target
 * is `targetUserId` in the payload (emitted as `context.target_user_id`). They
 * coincide only for self-service actions (self-signup, self password reset).
 *
 * Events log *what changed*, never the changed values — field/role names and
 * id references only — so secrets and PII stay unrepresentable.
 *
 * @public
 */
export interface UserManagementAudit {
  /** An account was created (admin-created or self-signup). Fires at `notice`. */
  accountCreated(input: AccountCreatedInput): void
  /** An account's attributes were changed. Fires at `notice`. */
  accountModified(input: AccountModifiedInput): void
  /** An account was deactivated/suspended. Fires at `notice`. */
  accountDeactivated(input: AccountDeactivatedInput): void
  /** An account was deleted. Fires at `notice`. */
  accountDeleted(input: AccountDeletedInput): void
  /** An account's roles/permissions changed. Fires at `notice`. */
  roleChanged(input: RoleChangedInput): void
  /** An account's MFA settings changed. Fires at `notice`. */
  mfaSettingChanged(input: MfaSettingChangedInput): void
  /** An account's API key was created, rotated, or revoked. Fires at `notice`. */
  apiKeyChanged(input: ApiKeyChangedInput): void
  /** An account's password was reset (self-service or admin). Fires at `notice`. */
  passwordReset(input: PasswordResetInput): void
}

/** Input for {@link UserManagementAudit.accountCreated}. @public */
export interface AccountCreatedInput extends AuditInputBase {
  /** The account created. Emitted as `context.target_user_id`. */
  targetUserId: string
}

/** Input for {@link UserManagementAudit.accountModified}. @public */
export interface AccountModifiedInput extends AuditInputBase {
  /** The account modified. Emitted as `context.target_user_id`. */
  targetUserId: string
  /** The names of the fields that changed — never their values. */
  changedFields: string[]
}

/** Input for {@link UserManagementAudit.accountDeactivated}. @public */
export interface AccountDeactivatedInput extends AuditInputBase {
  /** The account deactivated. Emitted as `context.target_user_id`. */
  targetUserId: string
  /** Why the account was deactivated, e.g. `admin_action`, `inactivity`. */
  reason?: string
}

/** Input for {@link UserManagementAudit.accountDeleted}. @public */
export interface AccountDeletedInput extends AuditInputBase {
  /** The account deleted. Emitted as `context.target_user_id`. */
  targetUserId: string
}

/** Input for {@link UserManagementAudit.roleChanged}. @public */
export interface RoleChangedInput extends AuditInputBase {
  /** The account whose roles changed. Emitted as `context.target_user_id`. */
  targetUserId: string
  /** The role/permission names before the change. */
  oldRoles: string[]
  /** The role/permission names after the change. */
  newRoles: string[]
}

/** Input for {@link UserManagementAudit.mfaSettingChanged}. @public */
export interface MfaSettingChangedInput extends AuditInputBase {
  /** The account whose MFA settings changed. Emitted as `context.target_user_id`. */
  targetUserId: string
  /** What changed, e.g. `enabled`, `disabled`, `reset`, `method_added`. */
  change: string
}

/** Input for {@link UserManagementAudit.apiKeyChanged}. @public */
export interface ApiKeyChangedInput extends AuditInputBase {
  /** The account that owns the key. Emitted as `context.target_user_id`. */
  targetUserId: string
  /** The key's identifier — a reference, never the key value. */
  keyId: string
  /** The lifecycle action performed on the key. */
  action: 'created' | 'rotated' | 'revoked'
}

/** Input for {@link UserManagementAudit.passwordReset}. @public */
export interface PasswordResetInput extends AuditInputBase {
  /** The account whose password was reset. Emitted as `context.target_user_id`. */
  targetUserId: string
  /** Who initiated the reset — the account holder, or an administrator. */
  initiatedBy: 'self' | 'admin'
}

/**
 * Data access, movement & export audit events (category `dataAccess`).
 *
 * Downstream of authentication: the acting `user_id` and `client_ip` are
 * scope-read. Log *what* was accessed — resource type/id, classification — never
 * the data itself.
 *
 * @public
 */
export interface DataAccessAudit {
  /** PII/confidential data was accessed. Fires at `notice`. */
  dataAccessed(input: DataAccessedInput): void
  /** A file/record was downloaded. Fires at `notice`. */
  recordDownloaded(input: RecordDownloadedInput): void
  /** A bulk data export was performed. Fires at `notice`. */
  bulkExported(input: BulkExportedInput): void
}

/** Input for {@link DataAccessAudit.dataAccessed}. @public */
export interface DataAccessedInput extends AuditInputBase {
  /** The kind of resource accessed, e.g. `citizen_record`. */
  resourceType: string
  /** The accessed resource's identifier. */
  resourceId: string
  /** What was done with the data, e.g. `read`, `view`, `query` — distinct from the top-level `action`. */
  accessType: string
  /** The data's classification, e.g. `confidential`, `restricted`, `pii`. */
  classification: string
}

/** Input for {@link DataAccessAudit.recordDownloaded}. @public */
export interface RecordDownloadedInput extends AuditInputBase {
  /** The downloaded resource's identifier. */
  resourceId: string
  /** The data's classification. */
  classification: string
  /** Size of the download in bytes. */
  sizeBytes: number
  /** How it was downloaded, e.g. `csv`, `pdf`, `api`. */
  method: string
  /** The kind of resource, if useful. */
  resourceType?: string
  /** The acting user's role, if known. */
  role?: string
}

/** Input for {@link DataAccessAudit.bulkExported}. @public */
export interface BulkExportedInput extends AuditInputBase {
  /** Where the export was sent, e.g. an email, bucket, or download channel. */
  destination: string
  /** The data's classification. */
  classification: string
  /** How many records were exported. */
  recordCount: number
  /** The filters/parameters that scoped the export. */
  filters?: AuditContext
}

/**
 * Application function & security-configuration change audit events
 * (category `configChange`). Includes the org-level policy changes deferred
 * from `userManagement` (password/access policy, ACLs, retention, logging).
 *
 * Admin actions, downstream of auth: actor `user_id` and `client_ip` are
 * scope-read. Log *what* changed (and old/new values when non-sensitive),
 * never secrets.
 *
 * @public
 */
export interface ConfigChangeAudit {
  /** A security/compliance-affecting configuration setting changed. Fires at `notice`. */
  securityConfigChanged(input: SecurityConfigChangedInput): void
  /** An application policy changed (ACL, retention, logging, password, access). Fires at `notice`. */
  policyChanged(input: PolicyChangedInput): void
}

/** Input for {@link ConfigChangeAudit.securityConfigChanged}. @public */
export interface SecurityConfigChangedInput extends AuditInputBase {
  /** The setting that changed, e.g. `session_timeout`, `mfa_required`. */
  setting: string
  /** The previous value, if non-sensitive and useful. */
  oldValue?: unknown
  /** The new value, if non-sensitive and useful. */
  newValue?: unknown
}

/** Input for {@link ConfigChangeAudit.policyChanged}. @public */
export interface PolicyChangedInput extends AuditInputBase {
  /** The kind of policy, e.g. `acl`, `retention`, `logging`, `password`, `access`. */
  policyType: string
  /** A short human summary of the change, if useful. */
  summary?: string
  /** The previous value, if non-sensitive and useful. */
  oldValue?: unknown
  /** The new value, if non-sensitive and useful. */
  newValue?: unknown
}

/**
 * API usage audit events (category `apiUsage`).
 *
 * Covers API token lifecycle and access to sensitive endpoints. Anomaly/abuse
 * detection is intentionally absent — the app does not know a call is anomalous
 * at log time; that is a sink/SIEM concern *over* these lines (ADR-0007).
 *
 * @public
 */
export interface ApiUsageAudit {
  /** An API token was issued. Fires at `notice`. */
  tokenIssued(input: TokenIssuedInput): void
  /** An API token was refreshed. Fires at `notice`. */
  tokenRefreshed(input: TokenRefreshedInput): void
  /** An API token was invalidated/revoked. Fires at `notice`. */
  tokenInvalidated(input: TokenInvalidatedInput): void
  /** A sensitive endpoint was accessed. Fires at `notice`. */
  sensitiveEndpointAccessed(input: SensitiveEndpointAccessedInput): void
}

/** Input for {@link ApiUsageAudit.tokenIssued}. @public */
export interface TokenIssuedInput extends AuditInputBase {
  /** The subject the token was issued for. Promoted to `user_id`. */
  userId: string
  /** The token's identifier — a reference, never the token value. */
  tokenId: string
  /** The scopes/permissions granted, if any. */
  scopes?: string[]
}

/** Input for {@link ApiUsageAudit.tokenRefreshed}. @public */
export interface TokenRefreshedInput extends AuditInputBase {
  /** The refreshed token's identifier (a reference, not the token value). */
  tokenId: string
}

/** Input for {@link ApiUsageAudit.tokenInvalidated}. @public */
export interface TokenInvalidatedInput extends AuditInputBase {
  /** The invalidated token's identifier (a reference, not the token value). */
  tokenId: string
  /** Why it was invalidated, e.g. `revoked`, `expired`, `rotated`. */
  reason: string
}

/** Input for {@link ApiUsageAudit.sensitiveEndpointAccessed}. @public */
export interface SensitiveEndpointAccessedInput extends AuditInputBase {
  /** The endpoint accessed, e.g. `/api/admin/export`. */
  endpoint: string
  /** The HTTP method. */
  method: string
  /** Request parameters — caller-sanitised; keep secrets/PII out. */
  params?: AuditContext
}
