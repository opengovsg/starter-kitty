import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'

import { OptionsError } from '@/common/errors'
import { createEmailSchema } from '@/index'

describe('EmailValidator with default options', () => {
  const schema = createEmailSchema()

  it('should parse a valid email', () => {
    const email = schema.parse('zeyu@open.gov.sg')
    expect(email).toBe('zeyu@open.gov.sg')
  })

  it('should throw an error for an invalid email', () => {
    expect(() => schema.parse('zeyu@open')).toThrowError(ZodError)
  })

  it('should clean up unnecessary whitespace', () => {
    const email = schema.parse(' zeyu@open.gov.sg ')
    expect(email).toBe('zeyu@open.gov.sg')
  })
})

describe('EmailValidator that allows subdomains', () => {
  const schema = createEmailSchema({
    domains: [{ domain: 'gov.sg', includeSubdomains: true }],
  })

  it('should allow a valid subdomain', () => {
    expect(() => schema.parse('zeyu@open.gov.sg')).not.toThrow()
  })

  it('should allow a valid subdomain with multiple levels', () => {
    expect(() => schema.parse('zeyu@a.b.c.d.gov.sg')).not.toThrow()
  })

  it('should throw an error for an invalid subdomain', () => {
    expect(() => schema.parse('zeyu@edu.sg')).toThrowError(ZodError)
  })
})

describe('EmailValidator that disallows subdomains', () => {
  const schema = createEmailSchema({
    domains: [{ domain: 'gov.sg', includeSubdomains: false }],
  })

  it('should allow a valid domain', () => {
    expect(() => schema.parse('zeyu@gov.sg')).not.toThrow()
  })

  it('should throw an error for a subdomain', () => {
    expect(() => schema.parse('zeyu@open.gov.sg')).toThrowError(ZodError)
  })
})

describe('EmailValidator that disallows subdomains (by default)', () => {
  const schema = createEmailSchema({
    domains: [{ domain: 'gov.sg' }],
  })

  it('should allow a valid domain', () => {
    expect(() => schema.parse('zeyu@gov.sg')).not.toThrow()
  })

  it('should throw an error for a subdomain', () => {
    expect(() => schema.parse('zeyu@open.gov.sg')).toThrowError(ZodError)
  })
})

describe('EmailValidator with invalid options', () => {
  it('should throw an error for invalid options', () => {
    // @ts-expect-error Testing invalid options
    expect(() => createEmailSchema({ domains: ['gov.sg'] })).toThrowError(
      OptionsError,
    )
  })

  it('should not throw an error when missing options', () => {
    expect(() => createEmailSchema()).not.toThrow()
  })
})
