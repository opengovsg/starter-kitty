import { beforeEach, describe, expect, it, vi } from 'vitest'

// Swap pino's stdout destination for an in-memory capture so we assert on the
// actual wire format (mirrors logger.test.ts).
const h = vi.hoisted(() => ({ lines: [] as string[] }))

vi.mock('pino', async importOriginal => {
  const actual = await importOriginal<typeof import('pino')>()
  const { Writable } = await import('node:stream')
  const capture = new Writable({
    write(chunk: Buffer, _enc, cb) {
      h.lines.push(chunk.toString())
      cb()
    },
  })
  return { ...actual, destination: () => capture }
})

import { createLogging } from '../index.js'

const createBaseLogger = createLogging({ env: 'development', service: 'starter-kitty', version: '0.0.0' })

function entries(): Record<string, unknown>[] {
  return h.lines
    .flatMap(line => line.split('\n'))
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

function at(index: number): Record<string, unknown> {
  const entry = entries()[index]
  if (!entry) throw new Error(`expected a log entry at index ${index}`)
  return entry
}

beforeEach(() => {
  h.lines = []
})

describe('audit.authn', () => {
  it('stamps the Controlled audit fields and promotes userId to the user_id facet', () => {
    createBaseLogger({ traceId: null, path: '/login', clientIp: '1.2.3.4', userAgent: 'jest' })
      .scope({ action: 'verifyOtp' })
      .audit.authn.loginSucceeded({
        userId: 'u_1',
        role: 'admin',
        privileged: true,
        username: 'jane',
        sessionId: 's_1',
      })

    const line = at(0)
    expect(line).toMatchObject({
      level: 'NOTICE',
      message: 'Login succeeded',
      audit: true,
      category: 'authn',
      event: 'loginSucceeded',
      action: 'verifyOtp',
      user_id: 'u_1', // promoted to top level, not buried in context
      client_ip: '1.2.3.4', // scope-read, present on the line
      context: { role: 'admin', privileged: true, username: 'jane', session_id: 's_1' },
    })
    // The event name is distinct from `action` (the calling operation).
    expect(line.event).not.toBe(line.action)
  })

  it('fires tokenReused at warn', () => {
    createBaseLogger({
      traceId: null,
      path: '/api',
      clientIp: '1.2.3.4',
      userAgent: 'jest',
      userId: 'u_1',
    }).audit.authn.tokenReused({
      tokenId: 't_1',
    })

    const line = at(0)
    expect(line).toMatchObject({ level: 'WARN', event: 'tokenReused', audit: true, context: { token_id: 't_1' } })
  })

  it('emits a diagnostic when a required scope field is missing, then the event', () => {
    // System logger has no clientIp / userAgent — both required by loginSucceeded.
    createBaseLogger.system({ traceId: null, path: '/login' }).audit.authn.loginSucceeded({
      userId: 'u_1',
      role: 'admin',
      privileged: false,
    })

    const lines = entries()
    expect(lines).toHaveLength(2)
    const [diagnostic, event] = lines
    expect(diagnostic).toMatchObject({
      level: 'WARN',
      message: 'Audit event missing required scope field',
      audit: true,
      event: 'loginSucceeded',
      context: { missing_scope: ['client_ip', 'user_agent'] },
    })
    expect(event).toMatchObject({ level: 'NOTICE', event: 'loginSucceeded' })
  })

  it('flags a payload/scope mismatch on a promoted field', () => {
    createBaseLogger({
      traceId: null,
      path: '/login',
      clientIp: '1.2.3.4',
      userAgent: 'jest',
      userId: 'u_scope',
    }).audit.authn.loginSucceeded({ userId: 'u_payload', role: 'admin', privileged: false })

    const mismatch = entries().find(l => l.message === 'Audit field mismatch: payload overrides scope')
    expect(mismatch).toMatchObject({
      level: 'WARN',
      context: { field: 'user_id', scope_value: 'u_scope', payload_value: 'u_payload' },
    })
    // Payload wins on the emitted event.
    const event = entries().find(l => l.event === 'loginSucceeded' && l.message === 'Login succeeded')
    expect(event?.user_id).toBe('u_payload')
  })

  it('uses the scoped action and omits absent optional fields', () => {
    createBaseLogger({ traceId: null, path: '/login', clientIp: '1.2.3.4', userAgent: 'jest' })
      .scope({ action: 'authFlow' })
      .audit.authn.loginFailed({ username: 'jane', reason: 'bad_password', attemptCount: 3, privileged: false })

    const line = at(0)
    expect(line).toMatchObject({
      level: 'NOTICE',
      event: 'loginFailed',
      action: 'authFlow',
      context: { username: 'jane', reason: 'bad_password', attempt_count: 3, privileged: false },
    })
    // userId/role were not supplied; they must not appear.
    expect(line).not.toHaveProperty('user_id')
    expect(line.context as Record<string, unknown>).not.toHaveProperty('role')
  })

  it('uses the per-event default message, overridable via messageOverride', () => {
    const log = createBaseLogger({ traceId: null, path: '/login', clientIp: '1.2.3.4', userAgent: 'jest' })
    log.audit.authn.loginFailed({ username: 'a', reason: 'bad_password', attemptCount: 1, privileged: false })
    log.audit.authn.loginFailed({
      username: 'b',
      reason: 'bad_password',
      attemptCount: 1,
      privileged: false,
      messageOverride: 'Repeated failure from same IP',
    })

    const lines = entries()
    expect(lines[0]?.message).toBe('Login failed') // default
    expect(lines[1]?.message).toBe('Repeated failure from same IP') // overridden
  })
})

describe('audit.userManagement', () => {
  it('separates actor (scope user_id) from target (context.target_user_id)', () => {
    createBaseLogger({ traceId: null, path: '/admin/users', clientIp: '1.2.3.4', userAgent: 'jest', userId: 'admin_1' })
      .scope({ action: 'updateRoles' })
      .audit.userManagement.roleChanged({
        targetUserId: 'u_2',
        oldRoles: ['viewer'],
        newRoles: ['editor', 'admin'],
      })

    const line = at(0)
    expect(line).toMatchObject({
      level: 'NOTICE',
      audit: true,
      category: 'userManagement',
      event: 'roleChanged',
      action: 'updateRoles',
      user_id: 'admin_1', // the actor, top-level
      context: {
        target_user_id: 'u_2', // the target, in context — not a root facet
        old_roles: ['viewer'],
        new_roles: ['editor', 'admin'],
      },
    })
    // The target is never promoted to a top-level facet.
    expect(line).not.toHaveProperty('target_user_id')
  })

  it('logs changed field names, not values, on accountModified', () => {
    createBaseLogger({
      traceId: null,
      path: '/admin/users',
      clientIp: '1.2.3.4',
      userAgent: 'jest',
      userId: 'admin_1',
    }).audit.userManagement.accountModified({ targetUserId: 'u_2', changedFields: ['email', 'phone'] })

    const line = at(0)
    expect(line.context).toMatchObject({ target_user_id: 'u_2', changed_fields: ['email', 'phone'] })
  })

  it('does not require an actor for self-service password reset', () => {
    // No userId in scope (self-service) — only client_ip is required.
    createBaseLogger({
      traceId: null,
      path: '/account/password',
      clientIp: '1.2.3.4',
      userAgent: 'jest',
    }).audit.userManagement.passwordReset({ targetUserId: 'u_2', initiatedBy: 'self' })

    const lines = entries()
    // Only the event line — no "missing required scope" diagnostic for user_id.
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      event: 'passwordReset',
      context: { target_user_id: 'u_2', initiated_by: 'self' },
    })
  })

  it('emits a diagnostic when an admin action lacks the actor in scope', () => {
    // accountDeleted requires user_id (the admin actor) — absent here.
    createBaseLogger({
      traceId: null,
      path: '/admin/users',
      clientIp: '1.2.3.4',
      userAgent: 'jest',
    }).audit.userManagement.accountDeleted({
      targetUserId: 'u_2',
    })

    const diagnostic = entries().find(l => l.message === 'Audit event missing required scope field')
    expect(diagnostic).toMatchObject({ event: 'accountDeleted', context: { missing_scope: ['user_id'] } })
  })
})

describe('audit.dataAccess', () => {
  const reqLogger = () =>
    createBaseLogger({ traceId: null, path: '/data', clientIp: '1.2.3.4', userAgent: 'jest', userId: 'u_1' })

  it('records a data access with resource and classification in context', () => {
    reqLogger().audit.dataAccess.dataAccessed({
      resourceType: 'citizen_record',
      resourceId: 'r_1',
      accessType: 'read',
      classification: 'confidential',
    })
    const line = at(0)
    expect(line).toMatchObject({
      audit: true,
      category: 'dataAccess',
      event: 'dataAccessed',
      user_id: 'u_1',
      context: {
        resource_type: 'citizen_record',
        resource_id: 'r_1',
        access_type: 'read',
        classification: 'confidential',
      },
    })
  })

  it('records a bulk export with filters nested in context', () => {
    reqLogger().audit.dataAccess.bulkExported({
      destination: 's3://exports',
      classification: 'restricted',
      recordCount: 1200,
      filters: { status: 'active', region: 'sg' },
    })
    expect(at(0).context).toMatchObject({
      destination: 's3://exports',
      classification: 'restricted',
      record_count: 1200,
      filters: { status: 'active', region: 'sg' },
    })
  })

  it('emits a diagnostic when the actor is missing from scope', () => {
    createBaseLogger
      .system({ traceId: null, path: '/job' })
      .audit.dataAccess.dataAccessed({ resourceType: 't', resourceId: 'r', accessType: 'read', classification: 'pii' })
    const diagnostic = entries().find(l => l.message === 'Audit event missing required scope field')
    expect(diagnostic).toMatchObject({ event: 'dataAccessed', context: { missing_scope: ['user_id', 'client_ip'] } })
  })
})

describe('audit.configChange', () => {
  const reqLogger = () =>
    createBaseLogger({
      traceId: null,
      path: '/admin/settings',
      clientIp: '1.2.3.4',
      userAgent: 'jest',
      userId: 'admin_1',
    })

  it('records a security config change with old/new values in context', () => {
    reqLogger().audit.configChange.securityConfigChanged({
      setting: 'session_timeout',
      oldValue: 30,
      newValue: 15,
    })
    const line = at(0)
    expect(line).toMatchObject({
      audit: true,
      category: 'configChange',
      event: 'securityConfigChanged',
      user_id: 'admin_1',
      context: { setting: 'session_timeout', old_value: 30, new_value: 15 },
    })
  })

  it('records a policy change and omits absent optional values', () => {
    reqLogger().audit.configChange.policyChanged({ policyType: 'retention', summary: '30d -> 90d' })
    const line = at(0)
    expect(line.context).toMatchObject({ policy_type: 'retention', summary: '30d -> 90d' })
    expect(line.context as Record<string, unknown>).not.toHaveProperty('old_value')
  })
})
