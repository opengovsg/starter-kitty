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

describe('audit.apiUsage', () => {
  it('promotes the issued-for subject to user_id on tokenIssued', () => {
    createBaseLogger({
      traceId: null,
      path: '/oauth/token',
      clientIp: '1.2.3.4',
      userAgent: 'jest',
    }).audit.apiUsage.tokenIssued({ userId: 'svc_1', tokenId: 'tok_1', scopes: ['read', 'write'] })
    const line = at(0)
    expect(line).toMatchObject({
      audit: true,
      category: 'apiUsage',
      event: 'tokenIssued',
      user_id: 'svc_1',
      context: { token_id: 'tok_1', scopes: ['read', 'write'] },
    })
  })

  it('records sensitive-endpoint access with sanitised params in context', () => {
    createBaseLogger({
      traceId: null,
      path: '/api',
      clientIp: '1.2.3.4',
      userAgent: 'jest',
      userId: 'u_1',
    }).audit.apiUsage.sensitiveEndpointAccessed({
      endpoint: '/api/admin/export',
      method: 'POST',
      params: { scope: 'all' },
    })
    expect(at(0).context).toMatchObject({ endpoint: '/api/admin/export', method: 'POST', params: { scope: 'all' } })
  })
})

describe('audit.failures', () => {
  it('fires denials at warn', () => {
    createBaseLogger({
      traceId: null,
      path: '/admin',
      clientIp: '1.2.3.4',
      userAgent: 'jest',
      userId: 'u_1',
    }).audit.failures.privilegeEscalationDenied({
      attemptedRole: 'admin',
      reason: 'not_permitted',
      targetUserId: 'u_2',
    })
    const line = at(0)
    expect(line).toMatchObject({
      level: 'WARN',
      audit: true,
      category: 'failures',
      event: 'privilegeEscalationDenied',
      user_id: 'u_1',
      context: { attempted_role: 'admin', reason: 'not_permitted', target_user_id: 'u_2' },
    })
  })

  it('allows accessDenied without an authenticated actor (only client_ip required)', () => {
    createBaseLogger({
      traceId: null,
      path: '/admin',
      clientIp: '1.2.3.4',
      userAgent: 'jest',
    }).audit.failures.accessDenied({
      resource: '/admin',
      reason: 'unauthenticated',
    })
    const lines = entries()
    expect(lines).toHaveLength(1) // no missing-scope diagnostic (user_id not required)
    expect(lines[0]).toMatchObject({
      level: 'WARN',
      event: 'accessDenied',
      context: { resource: '/admin', reason: 'unauthenticated' },
    })
    expect(lines[0]).not.toHaveProperty('user_id')
  })
})

describe('audit context composition (ADR-0008)', () => {
  const reqLogger = () =>
    createBaseLogger({ traceId: null, path: '/data', clientIp: '1.2.3.4', userAgent: 'jest', userId: 'u_1' })

  it('merges the logger scoped context into the audit line', () => {
    reqLogger()
      .scope({ action: 'readRecord', context: { tenant_id: 't_1' } })
      .audit.dataAccess.dataAccessed({
        resourceType: 'citizen_record',
        resourceId: 'r_1',
        accessType: 'read',
        classification: 'confidential',
      })
    // tenant_id came from scope; event fields ride alongside it.
    expect(at(0).context).toMatchObject({
      tenant_id: 't_1',
      resource_type: 'citizen_record',
      resource_id: 'r_1',
    })
  })

  it('merges context set after the audit namespace is accessed (call-time read)', () => {
    const log = reqLogger().scope({ action: 'readRecord', context: { a: 1 } })
    void log.audit // memoise the namespace first
    log.setContext({ context: { b: 2 } })
    log.audit.dataAccess.dataAccessed({ resourceType: 't', resourceId: 'r', accessType: 'read', classification: 'pii' })
    expect(at(0).context).toMatchObject({ a: 1, b: 2 })
  })

  it('lets a per-call context key override a scoped one (more specific wins)', () => {
    reqLogger()
      .scope({ action: 'readRecord', context: { classification: 'public' } })
      .audit.dataAccess.dataAccessed({
        resourceType: 't',
        resourceId: 'r',
        accessType: 'read',
        classification: 'restricted',
      })
    // event/per-call field wins over the ambient scoped key of the same name.
    expect((at(0).context as Record<string, unknown>).classification).toBe('restricted')
  })

  it('runs the Context guard over the merged audit context', () => {
    reqLogger()
      .scope({ action: 'readRecord', context: { huge: 'x'.repeat(200_001) } })
      .audit.dataAccess.dataAccessed({ resourceType: 't', resourceId: 'r', accessType: 'read', classification: 'pii' })

    const lines = entries()
    // The guard drops the oversized bag and diagnoses it, then the event line
    // carries the marker instead of a malformed context.
    expect(lines.some(l => l.message === 'Log context is too large')).toBe(true)
    const event = lines.find(l => l.event === 'dataAccessed')
    expect(event?.context).toEqual({ logger: '[Context removed]' })
  })
})

describe('audit.resource', () => {
  const reqLogger = () =>
    createBaseLogger({ traceId: null, path: '/forms', clientIp: '1.2.3.4', userAgent: 'jest', userId: 'u_1' })

  it('records a resource update with changed field names in context', () => {
    reqLogger().audit.resource.updated({ resourceType: 'form', resourceId: 'f_1', changedFields: ['title', 'status'] })
    const line = at(0)
    expect(line).toMatchObject({
      level: 'NOTICE',
      audit: true,
      category: 'resource',
      event: 'updated',
      user_id: 'u_1',
      context: { resource_type: 'form', resource_id: 'f_1', changed_fields: ['title', 'status'] },
    })
  })

  it('records an ownership transfer with from/to in context (actor stays the doer)', () => {
    reqLogger().audit.resource.ownershipTransferred({
      resourceType: 'form',
      resourceId: 'f_1',
      fromOwnerId: 'team_a',
      toOwnerId: 'team_b',
      ownerType: 'team',
    })
    const line = at(0)
    expect(line).toMatchObject({
      event: 'ownershipTransferred',
      user_id: 'u_1', // the actor who performed the transfer
      context: {
        resource_type: 'form',
        resource_id: 'f_1',
        from_owner_id: 'team_a',
        to_owner_id: 'team_b',
        owner_type: 'team',
      },
    })
    expect(line).not.toHaveProperty('from_owner_id') // from/to live in context, not root
  })
})

describe('withBindings', () => {
  it('binds a late-known actor so actor-scoped events do not warn', () => {
    createBaseLogger({ traceId: null, path: '/signup', clientIp: '1.2.3.4', userAgent: 'jest' })
      .withBindings({ userId: 'u_new' })
      .scope({ action: 'team:create' })
      .audit.resource.created({ resourceType: 'team', resourceId: 't_1' })

    // No "missing required scope" diagnostic ...
    expect(entries().find(l => l.message === 'Audit event missing required scope field')).toBeUndefined()
    // ... the actor is on the event line at the root, and the request-fixed
    // facet (client_ip) is inherited untouched by the rebind.
    expect(entries().find(l => l.event === 'created')).toMatchObject({
      user_id: 'u_new',
      client_ip: '1.2.3.4',
      context: { resource_type: 'team', resource_id: 't_1' },
    })
  })

  it('returns a new logger and leaves the original unbound', () => {
    const base = createBaseLogger({ traceId: null, path: '/signup', clientIp: '1.2.3.4', userAgent: 'jest' })
    base.withBindings({ userId: 'u_new' }) // discarded
    base.scope({ action: 'team:create' }).audit.resource.created({ resourceType: 'team', resourceId: 't_2' })

    expect(entries().find(l => l.message === 'Audit event missing required scope field')).toMatchObject({
      context: { missing_scope: ['user_id'] },
    })
  })
})
