import type { AuditDeps } from './emit.js'
import { emitAudit } from './emit.js'
import { AUTHN_SPECS, CONFIG_CHANGE_SPECS, DATA_ACCESS_SPECS, USER_MANAGEMENT_SPECS } from './spec.js'
import type { AuditLogger } from './types.js'

export type { AuditDeps } from './emit.js'

/**
 * Build the `logger.audit` namespace over the injected base capabilities. Called
 * lazily by `LoggerImpl`'s memoised `audit` getter — a request that emits no
 * audit event never constructs it (ADR-0007).
 *
 * @internal
 */
export const createAuditLogger = (deps: AuditDeps): AuditLogger => ({
  authn: {
    loginSucceeded: input => emitAudit(deps, AUTHN_SPECS.loginSucceeded, input),
    loginFailed: input => emitAudit(deps, AUTHN_SPECS.loginFailed, input),
    sessionCreated: input => emitAudit(deps, AUTHN_SPECS.sessionCreated, input),
    sessionTerminated: input => emitAudit(deps, AUTHN_SPECS.sessionTerminated, input),
    sessionTimedOut: input => emitAudit(deps, AUTHN_SPECS.sessionTimedOut, input),
    tokenReused: input => emitAudit(deps, AUTHN_SPECS.tokenReused, input),
  },
  userManagement: {
    accountCreated: input => emitAudit(deps, USER_MANAGEMENT_SPECS.accountCreated, input),
    accountModified: input => emitAudit(deps, USER_MANAGEMENT_SPECS.accountModified, input),
    accountDeactivated: input => emitAudit(deps, USER_MANAGEMENT_SPECS.accountDeactivated, input),
    accountDeleted: input => emitAudit(deps, USER_MANAGEMENT_SPECS.accountDeleted, input),
    roleChanged: input => emitAudit(deps, USER_MANAGEMENT_SPECS.roleChanged, input),
    mfaSettingChanged: input => emitAudit(deps, USER_MANAGEMENT_SPECS.mfaSettingChanged, input),
    apiKeyChanged: input => emitAudit(deps, USER_MANAGEMENT_SPECS.apiKeyChanged, input),
    passwordReset: input => emitAudit(deps, USER_MANAGEMENT_SPECS.passwordReset, input),
  },
  dataAccess: {
    dataAccessed: input => emitAudit(deps, DATA_ACCESS_SPECS.dataAccessed, input),
    recordDownloaded: input => emitAudit(deps, DATA_ACCESS_SPECS.recordDownloaded, input),
    bulkExported: input => emitAudit(deps, DATA_ACCESS_SPECS.bulkExported, input),
  },
  configChange: {
    securityConfigChanged: input => emitAudit(deps, CONFIG_CHANGE_SPECS.securityConfigChanged, input),
    policyChanged: input => emitAudit(deps, CONFIG_CHANGE_SPECS.policyChanged, input),
  },
})
