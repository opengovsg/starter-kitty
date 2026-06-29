import { describe, expect, it } from 'vitest'

import { getCauseFromUnknown, serializeError } from '../error.js'

const asRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>

describe('getCauseFromUnknown', () => {
  it('returns an Error instance unchanged', () => {
    const err = new Error('boom')
    expect(getCauseFromUnknown(err)).toBe(err)
  })

  it('preserves subclasses of Error', () => {
    const err = new TypeError('nope')
    expect(getCauseFromUnknown(err)).toBe(err)
  })

  it('wraps string primitives in an Error', () => {
    const result = getCauseFromUnknown('something failed')
    expect(result).toBeInstanceOf(Error)
    expect(result?.message).toBe('something failed')
  })

  it('wraps number primitives in an Error', () => {
    const result = getCauseFromUnknown(42)
    expect(result).toBeInstanceOf(Error)
    expect(result?.message).toBe('42')
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a function', () => undefined],
  ])('returns undefined for %s', (_label, value) => {
    expect(getCauseFromUnknown(value)).toBeUndefined()
  })

  it('returns undefined for arrays', () => {
    expect(getCauseFromUnknown([1, 2, 3])).toBeUndefined()
  })

  it('copies own enumerable properties from a plain object onto a synthetic Error', () => {
    const result = getCauseFromUnknown({ code: 'X', detail: 'oops', nested: { a: 1 } })
    expect(result).toBeInstanceOf(Error)
    expect(asRecord(result).code).toBe('X')
    expect(asRecord(result).detail).toBe('oops')
    expect(asRecord(result).nested).toEqual({ a: 1 })
  })

  it('skips prototype-mutating keys to avoid prototype pollution', () => {
    // JSON.parse produces an *own* enumerable `__proto__` key (object literals
    // would set the prototype instead), which is exactly the attack vector.
    const malicious = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"c","prototype":"p","safe":1}',
    ) as unknown

    const result = getCauseFromUnknown(malicious)

    expect(asRecord(result).safe).toBe(1)
    expect(result).not.toHaveProperty('polluted')
    // Object.prototype must remain untouched.
    expect(asRecord({}).polluted).toBeUndefined()
  })
})

describe('serializeError (neutral default)', () => {
  it('sets kind to the class name, never a framework code', () => {
    class ForbiddenError extends Error {
      code = 'FORBIDDEN'
      constructor() {
        super('denied')
        this.name = 'ForbiddenError'
      }
    }
    const shaped = serializeError(new ForbiddenError())
    expect(shaped.kind).toBe('ForbiddenError')
    // The `code` survives as an own property — just not lifted into `kind`.
    expect(shaped.code).toBe('FORBIDDEN')
  })

  it('includes the native message, stack, and cause', () => {
    const cause = new Error('root')
    const shaped = serializeError(new Error('boom', { cause }))
    expect(shaped.message).toBe('boom')
    expect(typeof shaped.stack).toBe('string')
    expect(shaped.cause).toBe(cause)
  })

  it('preserves own enumerable properties', () => {
    const err = Object.assign(new Error('boom'), { detail: 'oops', attempt: 3 })
    const shaped = serializeError(err)
    expect(shaped.detail).toBe('oops')
    expect(shaped.attempt).toBe(3)
  })

  it('does not treat a context property specially (no promotion at this layer)', () => {
    const err = Object.assign(new Error('boom'), { context: { attempt_id: 'x' } })
    expect(serializeError(err).context).toEqual({ attempt_id: 'x' })
  })
})
