import { describe, expect, it } from 'vitest'

import { OptionsError } from '@/common/errors'
import { EmailValidator } from '@/email'
import { EmailValidationError } from '@/email/errors'

describe('EmailValidator with default options', () => {
  const validator = new EmailValidator()

  it('should parse a valid email', () => {
    const email = validator.parse('zeyu@open.gov.sg')
    expect(email).toBe('zeyu@open.gov.sg')
  })

  it('should throw an error for an invalid email', () => {
    expect(() => validator.parse('zeyu@open')).toThrowError(
      EmailValidationError,
    )
  })

  it('should clean up unnecessary whitespace', () => {
    const email = validator.parse(' zeyu@open.gov.sg ')
    expect(email).toBe('zeyu@open.gov.sg')
  })
})

describe('EmailValidator that allows subdomains', () => {
  const validator = new EmailValidator({
    domains: ['gov.sg'],
    allowSubdomains: true,
  })

  it('should allow a valid subdomain', () => {
    expect(() => validator.parse('zeyu@open.gov.sg')).not.toThrow()
  })

  it('should allow a valid subdomain with multiple levels', () => {
    expect(() => validator.parse('zeyu@a.b.c.d.gov.sg')).not.toThrow()
  })

  it('should throw an error for an invalid subdomain', () => {
    expect(() => validator.parse('zeyu@edu.sg')).toThrowError(
      EmailValidationError,
    )
  })
})

describe('EmailValidator that disallows subdomains', () => {
  const validator = new EmailValidator({
    domains: ['gov.sg'],
    allowSubdomains: false,
  })

  it('should allow a valid domain', () => {
    expect(() => validator.parse('zeyu@gov.sg')).not.toThrow()
  })

  it('should throw an error for a subdomain', () => {
    expect(() => validator.parse('zeyu@open.gov.sg')).toThrowError(
      EmailValidationError,
    )
  })
})

describe('EmailValidator with invalid options', () => {
  it('should throw an error for invalid options', () => {
    expect(() => new EmailValidator({ domains: 'gov.sg' })).toThrowError(
      OptionsError,
    )
  })

  it('should not throw an error when missing domains', () => {
    expect(
      () =>
        new EmailValidator({
          allowSubdomains: true,
        }),
    ).not.toThrow()
  })

  it('should not throw an error when missing allowSubdomains', () => {
    expect(
      () =>
        new EmailValidator({
          domains: ['gov.sg'],
        }),
    ).not.toThrow()
  })
})
