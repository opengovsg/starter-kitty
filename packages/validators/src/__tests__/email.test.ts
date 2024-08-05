import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'

import { OptionsError } from '@/common/errors'
import { createEmailSchema } from '@/index'

describe('EmailValidator with default options', () => {
  const schema = createEmailSchema()

  it('should parse a valid email', () => {
    expect(schema.parse('zeyu@open.gov.sg')).toBe('zeyu@open.gov.sg')

    // https://en.wikipedia.org/wiki/Email_address
    expect(schema.parse('simple@example.com')).toBe('simple@example.com')
    expect(schema.parse('FirstName.LastName@EasierReading.org')).toBe(
      'FirstName.LastName@EasierReading.org',
    )
    expect(schema.parse('x@example.com')).toBe('x@example.com')
    expect(
      schema.parse(
        'long.email-address-with-hyphens@and.subdomains.example.com',
      ),
    ).toBe('long.email-address-with-hyphens@and.subdomains.example.com')
    expect(schema.parse('user.name+tag+sorting@example.com')).toBe(
      'user.name+tag+sorting@example.com',
    )
    expect(schema.parse('user-@example.org')).toBe('user-@example.org')
  })

  it('should throw an error for an invalid email', () => {
    expect(() => schema.parse('zeyu@open')).toThrowError(ZodError)

    // https://en.wikipedia.org/wiki/Email_address
    expect(() => schema.parse('a@b@c@example.com')).toThrowError(ZodError)
    expect(() =>
      schema.parse('a"b(c)d,e:f;g<h>i[jk]l@example.com'),
    ).toThrowError(ZodError)
    expect(() => schema.parse('just"not"right@example.com')).toThrowError(
      ZodError,
    )
    expect(() => schema.parse('this is"notallowed@example.com')).toThrowError(
      ZodError,
    )
    expect(() =>
      schema.parse('this\\ still\\"not\\\\allowed@example.com'),
    ).toThrowError(ZodError)
    expect(() =>
      schema.parse(
        '1234567890123456789012345678901234567890123456789012345678901234+x@example.com',
      ),
    ).toThrowError(ZodError)
    expect(() =>
      schema.parse(
        'i.like.underscores@but_they_are_not_allowed_in_this_part.example.com',
      ),
    ).toThrowError(ZodError)

    // We are stricter than RFC 5322, and disallow some edge cases:
    // Quoted strings
    expect(() => schema.parse('" "@example.org')).toThrowError(ZodError)
    expect(() => schema.parse('"john..doe"@example.org')).toThrowError(ZodError)
    // Bangified host route
    expect(() => schema.parse('mailhost!username@example.org')).toThrowError(
      ZodError,
    )
    expect(() =>
      schema.parse(
        '"very.(),:;<>[]\\".VERY.\\"very@\\\\ \\"very\\".unusual"@strange.example.com',
      ),
    ).toThrowError(ZodError)
    // %-escaped mail route
    expect(() => schema.parse('user%example.com@example.org')).toThrowError(
      ZodError,
    )
    // IP address instead of domain
    expect(() => schema.parse('postmaster@[123.123.123.123]')).toThrowError(
      ZodError,
    )
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
