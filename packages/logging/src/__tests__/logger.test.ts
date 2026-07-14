import { beforeEach, describe, expect, it, vi } from 'vitest'

// Shared across the mocked transports below. `vi.hoisted` runs before the
// `vi.mock` factories, which are themselves hoisted above the imports.
const h = vi.hoisted(() => ({
  lines: [] as string[],
  pretty: vi.fn(),
}))

// Keep real pino, but swap its stdout destination for an in-memory capture so
// we can assert on the actual wire format pino produces.
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

vi.mock('pino-pretty', async importOriginal => {
  const actual = await importOriginal<typeof import('pino-pretty')>()
  const { Writable } = await import('node:stream')
  const capture = new Writable({
    write(chunk: Buffer, _enc, cb) {
      h.lines.push(chunk.toString())
      cb()
    },
  })
  return { ...actual, PinoPretty: h.pretty.mockImplementation(() => capture) }
})

import type { LoggingConfig } from '../index.js'
import { createLogging, serializeError } from '../index.js'

// Factory over a known baseline; pass overrides to vary config per test. env,
// service, and version are required, so the baseline always supplies them.
const make = (overrides?: Partial<LoggingConfig>) =>
  createLogging({ env: 'development', service: 'starter-kitty', version: '0.0.0', ...overrides })

// Each test gets a fresh factory in beforeEach; this initial value satisfies the type.
let createBaseLogger = make()

const asRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>

function entries(): Record<string, unknown>[] {
  return h.lines
    .flatMap(line => line.split('\n'))
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

function entryAt(index: number): Record<string, unknown> {
  const entry = entries()[index]
  if (!entry) throw new Error(`expected a log entry at index ${index}`)
  return entry
}

/** Replace the non-deterministic fields so an entry can be snapshotted. */
function normalise(entry: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...entry }
  if ('timestamp' in clone) clone.timestamp = '<timestamp>'
  if ('pid' in clone) clone.pid = '<pid>'
  if ('hostname' in clone) clone.hostname = '<hostname>'
  if (clone.error && typeof clone.error === 'object') {
    const error = { ...asRecord(clone.error) }
    if ('stack' in error) error.stack = '<stack>'
    clone.error = error
  }
  return clone
}

beforeEach(() => {
  h.lines.length = 0
  h.pretty.mockClear()
  // Fresh factory on known defaults; tests needing other config reassign it.
  createBaseLogger = make({ level: 'info', pretty: false })
})

describe('wire format', () => {
  it('emits the fixed structured shape on the default config', () => {
    createBaseLogger.system({ traceId: null, path: '/route' }).info({ message: 'hello', action: 'doThing' })

    expect(entries()).toHaveLength(1)
    const entry = entryAt(0)
    expect(entry.level).toBe('INFO')
    expect(entry.env).toBe('development')
    expect(entry.service).toBe('starter-kitty')
    expect(entry.version).toBe('0.0.0')
    expect(entry.message).toBe('hello')
    expect(entry.path).toBe('/route')
    expect(entry.action).toBe('doThing')
    expect(typeof entry.timestamp).toBe('number')
  })

  it('uppercases the level label for every custom level', () => {
    const log = createBaseLogger.system({ traceId: null, path: '/p' })
    log.notice({ message: 'n', action: 'a' })
    log.warn({ message: 'w', action: 'a' })
    log.error({ message: 'e', action: 'a' })

    expect(entries().map(e => e.level)).toEqual(['NOTICE', 'WARN', 'ERROR'])
  })

  it('binds child metadata, including is_latest_version', () => {
    createBaseLogger
      .system({
        path: '/p',
        userId: 'u1',
        traceId: 't1',
        clientVersion: '1.0.0',
        serverVersion: '1.0.0',
      })
      .info({ message: 'm', action: 'a' })

    const entry = entryAt(0)
    expect(entry.user_id).toBe('u1')
    expect(entry.trace_id).toBe('t1')
    expect(entry.is_latest_version).toBe(true)
  })

  it('omits is_latest_version when either version is absent', () => {
    createBaseLogger.system({ traceId: null, path: '/p', clientVersion: '1.0.0' }).info({ message: 'm', action: 'a' })
    expect('is_latest_version' in entryAt(0)).toBe(false)
  })

  it('binds client identity on a request logger', () => {
    createBaseLogger({ traceId: null, path: '/api', clientIp: '1.2.3.4', userAgent: 'Mozilla/5.0' }).info({
      message: 'm',
      action: 'a',
    })
    const entry = entryAt(0)
    expect(entry.client_ip).toBe('1.2.3.4')
    expect(entry.user_agent).toBe('Mozilla/5.0')
  })

  it('omits client identity on a system logger', () => {
    createBaseLogger.system({ traceId: null, path: 'redis:startup' }).info({ message: 'up', action: 'boot' })
    const entry = entryAt(0)
    expect(entry).not.toHaveProperty('client_ip')
    expect(entry).not.toHaveProperty('user_agent')
  })

  it('does not require traceId on a system logger (omitted when absent)', () => {
    // Trace correlation comes from dd-trace log injection, so `traceId` is
    // optional everywhere; the key is absent from the line when not supplied.
    createBaseLogger.system({ path: 'redis:startup' }).info({ message: 'up', action: 'boot' })
    expect(entryAt(0)).not.toHaveProperty('trace_id')
  })

  it('does not require traceId on a request logger (omitted when absent)', () => {
    createBaseLogger({ path: '/api', clientIp: '1.2.3.4', userAgent: 'jest' }).info({ message: 'm', action: 'a' })
    expect(entryAt(0)).not.toHaveProperty('trace_id')
  })

  it('coalesces null/undefined header fields to omitted (never a literal null)', () => {
    // `clientIp`/`userAgent` are required keys but accept null/undefined; the
    // header-sourced fields may be null (from `headers.get`). None should appear
    // on the wire — and never as `null`.
    createBaseLogger({
      path: '/api',
      clientIp: null,
      userAgent: undefined,
      source: null,
      traceId: null,
      clientVersion: null,
    }).info({ message: 'm', action: 'a' })

    const entry = entryAt(0)
    for (const key of ['client_ip', 'user_agent', 'source', 'trace_id', 'client_version']) {
      expect(entry).not.toHaveProperty(key)
    }
  })

  it('does not let `merged` clobber the logger-computed context', () => {
    createBaseLogger.system({ traceId: null, path: '/p' }).info({
      message: 'm',
      action: 'a',
      context: { real: true },
      merged: { context: { spoofed: true } },
    })
    expect(entryAt(0).context).toEqual({ real: true })
  })

  it('shapes an error into the error field, with kind = class name (no code coupling)', () => {
    class ForbiddenError extends Error {
      code = 'FORBIDDEN'
      constructor(message: string) {
        super(message)
        this.name = 'ForbiddenError'
      }
    }
    createBaseLogger.system({ traceId: null, path: '/p' }).error({
      message: 'boom',
      action: 'a',
      error: new ForbiddenError('denied'),
    })

    const error = asRecord(entryAt(0).error)
    // `kind` is the class name, NOT the framework `code` — the base logger is
    // framework-neutral. The `code` still survives as an own property.
    expect(error.kind).toBe('ForbiddenError')
    expect(error.code).toBe('FORBIDDEN')
    expect(error.message).toBe('denied')
    expect(typeof error.stack).toBe('string')
  })

  it('uses a custom serializeError when provided on the factory config', () => {
    const create = make({
      // Recover the tRPC-style `code` → `kind` mapping at the consumer's choice.
      serializeError: err => ({ ...serializeError(err), kind: (err as { code?: string }).code ?? err.name }),
    })
    class ForbiddenError extends Error {
      code = 'FORBIDDEN'
    }
    create.system({ traceId: null, path: '/p' }).error({ message: 'boom', error: new ForbiddenError('denied') })

    expect(asRecord(entryAt(0).error).kind).toBe('FORBIDDEN')
  })
})

// These snapshots double as a committed fixture of the exact output shape.
// Run `vitest -u` to regenerate after an intentional format change.
describe('output fixtures (snapshots)', () => {
  it('info line', () => {
    createBaseLogger.system({ traceId: null, path: '/api/widgets', source: 'trpc' }).info({
      message: 'Widget fetched',
      action: 'getWidget',
      context: { widgetId: 'w_123' },
    })
    expect(normalise(entryAt(0))).toMatchSnapshot()
  })

  it('notice (audit) line', () => {
    createBaseLogger.system({ traceId: null, path: '/api/login', userId: 'u_1' }).scope({ action: 'auth' }).notice({
      message: 'User logged in',
      action: 'login',
    })
    expect(normalise(entryAt(0))).toMatchSnapshot()
  })

  it('error line with an error', () => {
    createBaseLogger.system({ traceId: null, path: '/api/pay' }).error({
      message: 'Payment failed',
      action: 'charge',
      error: new Error('upstream down'),
    })
    expect(normalise(entryAt(0))).toMatchSnapshot()
  })
})

describe('createLogging', () => {
  it('binds the required identity trio on every line', () => {
    const create = createLogging({ env: 'production', service: 'payments', version: '1.2.3' })
    create.system({ traceId: null, path: '/p' }).info({ message: 'm', action: 'a' })

    const entry = entryAt(0)
    expect(entry.env).toBe('production')
    expect(entry.service).toBe('payments')
    expect(entry.version).toBe('1.2.3')
  })

  it('defaults level to info and pretty to false when omitted', () => {
    const create = createLogging({ env: 'production', service: 'payments', version: '1.2.3' })
    const log = create.system({ traceId: null, path: '/p' })
    log.debug({ message: 'd', action: 'a' }) // below info => suppressed
    log.info({ message: 'i', action: 'a' })

    expect(entries()).toHaveLength(1)
    expect(entryAt(0).level).toBe('INFO')
    expect(h.pretty).not.toHaveBeenCalled() // pretty: false => JSON transport
  })

  it('suppresses lines below the configured level', () => {
    const create = make({ level: 'warn' })
    const log = create.system({ traceId: null, path: '/p' })
    log.info({ message: 'i', action: 'a' })
    log.notice({ message: 'n', action: 'a' })
    log.warn({ message: 'w', action: 'a' })

    expect(entries()).toHaveLength(1)
    expect(entryAt(0).level).toBe('WARN')
  })

  it('emits nothing when silent', () => {
    const create = make({ level: 'silent' })
    create.system({ traceId: null, path: '/p' }).error({ message: 'e', action: 'a' })

    expect(entries()).toHaveLength(0)
  })

  it('selects the pretty transport with the expected options', () => {
    const create = make({ pretty: true })
    create.system({ traceId: null, path: '/p' }).info({ message: 'm', action: 'a' })

    expect(h.pretty).toHaveBeenCalledWith(
      expect.objectContaining({
        colorize: true,
        messageKey: 'message',
        timestampKey: 'timestamp',
      }),
    )
  })

  it('builds independent factories (no shared mutable config)', () => {
    const prod = make({ env: 'production' })
    const dev = make({ env: 'development' })

    prod.system({ traceId: null, path: '/p' }).info({ message: 'm', action: 'a' })
    dev.system({ traceId: null, path: '/p' }).info({ message: 'm', action: 'a' })

    expect(entryAt(0).env).toBe('production')
    expect(entryAt(1).env).toBe('development')
  })
})

describe('action scoping', () => {
  it('emits the action and never a history field', () => {
    createBaseLogger.system({ traceId: null, path: '/p' }).info({ message: 'm', action: 'only' })
    const entry = entryAt(0)
    expect(entry.action).toBe('only')
    expect(entry).not.toHaveProperty('history')
  })

  it('omits the action key entirely when no action is in scope', () => {
    createBaseLogger.system({ traceId: null, path: '/p' }).info({ message: 'm' })
    expect('action' in entryAt(0)).toBe(false)
  })

  it('keeps the most-specific action as the leaf and accumulates no history', () => {
    createBaseLogger
      .system({ traceId: null, path: '/p' })
      .scope({ action: 'first' })
      .scope({ action: 'second' })
      .info({ message: 'm', action: 'third' })
    const entry = entryAt(0)
    expect(entry.action).toBe('third')
    expect(entry).not.toHaveProperty('history')
  })

  it('emits the scoped leaf when no per-call action is given', () => {
    createBaseLogger
      .system({ traceId: null, path: '/p' })
      .scope({ action: 'first' })
      .scope({ action: 'second' })
      .info({ message: 'm' })
    expect(entryAt(0).action).toBe('second')
  })

  it('setAction mutates in place and sets the leaf', () => {
    const log = createBaseLogger.system({ traceId: null, path: '/p' })
    expect(log.setAction({ action: 'scoped' })).toBe(log)

    log.info({ message: 'm', action: 'leaf' })
    expect(entryAt(0).action).toBe('leaf')
  })

  it('scope sets the action without mutating the parent', () => {
    const parent = createBaseLogger.system({ traceId: null, path: '/p' }).scope({ action: 'parent' })
    const child = parent.scope({ action: 'child' })

    child.info({ message: 'm' })
    expect(entryAt(0).action).toBe('child')

    parent.info({ message: 'm' })
    expect(entryAt(1).action).toBe('parent')
  })
})

describe('context handling', () => {
  it('merges context into the payload', () => {
    createBaseLogger.system({ traceId: null, path: '/p' }).info({ message: 'm', action: 'a', context: { foo: 'bar' } })
    expect(entryAt(0).context).toEqual({ foo: 'bar' })
  })

  it('withContext returns a new logger and leaves the original untouched', () => {
    const base = createBaseLogger.system({ traceId: null, path: '/p' }).setContext({ context: { a: 1 } })
    const derived = base.withContext({ context: { b: 2 } })
    expect(derived).not.toBe(base)

    derived.info({ message: 'm', action: 'a' })
    expect(entryAt(0).context).toEqual({ a: 1, b: 2 })

    base.info({ message: 'm', action: 'a' })
    expect(entryAt(1).context).toEqual({ a: 1 })
  })

  it('setContext mutates in place', () => {
    const log = createBaseLogger.system({ traceId: null, path: '/p' }).setContext({ context: { a: 1 } })
    log.setContext({ context: { b: 2 } })
    log.info({ message: 'm', action: 'a' })
    expect(entryAt(0).context).toEqual({ a: 1, b: 2 })
  })
})

describe('context guard wiring', () => {
  // Unit behaviour of the guard lives in context.test.ts. This proves only the
  // wiring LoggerImpl owns: guard emissions are written through the transport
  // and carry the logger's scope (`action`). A circular context trips the guard
  // cheaply — no 280kB string needed.
  it('writes guard emissions with the logger scope attached', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    createBaseLogger
      .system({ traceId: null, path: '/p' })
      .scope({ action: 'outer' })
      .info({ message: 'm', action: 'inner', context: circular })

    const all = entries()
    // The info line is still written, with the context stripped.
    expect(asRecord(all.find(e => e.level === 'INFO')).context).toEqual({ logger: '[Context removed]' })

    const failure = all.find(e => e.message === 'Failed to serialise log context')
    expect(failure).toBeDefined()
    expect(asRecord(failure).action).toBe('inner')
    expect(asRecord(failure)).not.toHaveProperty('history')
  })
})

describe('error routing', () => {
  it("falls back to the error's name as kind when there is no code", () => {
    createBaseLogger
      .system({ traceId: null, path: '/p' })
      .error({ message: 'failed', action: 'a', error: new TypeError('bad') })
    expect(asRecord(entryAt(0).error).kind).toBe('TypeError')
  })

  it('normalises a non-Error value into the error field', () => {
    createBaseLogger
      .system({ traceId: null, path: '/p' })
      .error({ message: 'failed', action: 'a', error: 'just a string' })
    const error = asRecord(entryAt(0).error)
    expect(error.message).toBe('just a string')
  })

  it('does NOT promote an error context to the top level (left under error)', () => {
    // The base logger no longer reaches into `err.context` — that was the
    // StructuredError convention, removed in ADR-0006. An error carrying a
    // `context` own-property keeps it nested under `error`; only an explicit
    // call-level `context` populates the top-level field.
    const err = Object.assign(new Error('bad'), { context: { attempt_id: 'x' } })
    createBaseLogger.system({ traceId: null, path: '/p' }).error({ message: 'boom', action: 'a', error: err })

    const entry = entryAt(0)
    expect(entry.context).toBeUndefined()
    expect(asRecord(entry.error).context).toEqual({ attempt_id: 'x' })
  })

  it('emits only the explicit call-level context, untouched by the error', () => {
    const err = Object.assign(new Error('bad'), { context: { a: 'from_error', b: 2 } })
    createBaseLogger
      .system({ traceId: null, path: '/p' })
      .error({ message: 'boom', error: err, context: { a: 'from_call' } })

    expect(entryAt(0).context).toEqual({ a: 'from_call' })
  })
})
