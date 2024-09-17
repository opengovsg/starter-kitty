import { describe, expect, it } from 'vitest'

import { OptionsError } from '@/common/errors'
import { UrlValidator } from '@/index'
import { UrlValidationError } from '@/url/errors'

describe('UrlValidator with default options', () => {
  const validator = new UrlValidator()

  it('should parse a valid URL', () => {
    const url = validator.parse('https://example.com')
    expect(url).toBeInstanceOf(URL)
  })

  it('should throw an error when the protocol is not http or https', () => {
    expect(() => validator.parse('ftp://example.com')).toThrow(UrlValidationError)
  })

  it('should allow any host when no host whitelist is provided', () => {
    expect(() => validator.parse('https://open.gov.sg')).not.toThrow()
  })

  // https://url.spec.whatwg.org/#missing-scheme-non-relative-url
  it('should throw an error when missing a scheme and no base URL or base URL', () => {
    expect(() => validator.parse('example.com')).toThrow(UrlValidationError)
    expect(() => validator.parse('/path')).toThrow(UrlValidationError)
  })

  it('should not allow Next.js dynamic routes', () => {
    expect(() => validator.parse('https://example.com/[[...slug]]')).toThrow(UrlValidationError)
    expect(() => validator.parse('https://example.com/[[slug]]')).toThrow(UrlValidationError)
    expect(() => validator.parse('https://example.com/[x]?x=1')).toThrow(UrlValidationError)
  })

  it('should prevent XSS attacks', () => {
    expect(() => validator.parse('javascript&colonalert(/xss/)').protocol).toThrow(UrlValidationError)
    expect(() => validator.parse('javascript:alert(/xss/)')).toThrow(UrlValidationError)
  })
})

describe('UrlValidator with custom protocol whitelist', () => {
  const validator = new UrlValidator({
    whitelist: {
      protocols: ['http', 'https', 'mailto'],
    },
  })

  it('should not throw an error when the protocol on the whitelist', () => {
    expect(() => validator.parse('https://example.com')).not.toThrow()
    expect(() => validator.parse('http://example.com')).not.toThrow()
    expect(() => validator.parse('mailto:contact@example.com')).not.toThrow()
  })

  it('should throw an error when the protocol is not on the whitelist', () => {
    expect(() => validator.parse('ftp://example.com')).toThrow(UrlValidationError)
    expect(() => validator.parse('javascript:alert()')).toThrow(UrlValidationError)
  })
})

describe('UrlValidator with custom host whitelist', () => {
  const validator = new UrlValidator({
    whitelist: {
      protocols: ['http', 'https'],
      hosts: ['example.com'],
    },
  })

  it('should not throw an error when the host is on the whitelist', () => {
    expect(() => validator.parse('https://example.com')).not.toThrow()
  })

  it('should throw an error when the host is not on the whitelist', () => {
    expect(() => validator.parse('https://open.gov.sg')).toThrow(UrlValidationError)
  })
})

describe('UrlValidator with base URL', () => {
  const validator = new UrlValidator({
    baseOrigin: 'https://example.com',
  })

  it('should parse a valid relative URL', () => {
    const url = validator.parse('/path')
    expect(url).toBeInstanceOf(URL)
    expect(url.href).toBe('https://example.com/path')
  })

  it('should throw an error when the URL is not on the same origin as the base URL', () => {
    expect(() => validator.parse('https://open.gov.sg')).toThrow(UrlValidationError)
  })

  it('should prevent XSS attacks', () => {
    expect(validator.parse('javascript&colonalert(/xss/)').protocol).toBe('https:')
    expect(() => validator.parse('javascript:alert(/xss/)')).toThrow(UrlValidationError)
  })

  it('should not allow Next.js dynamic routes', () => {
    expect(() => validator.parse('/[[x]]https:/[y]/example.com/[[x]]/?x&y')).toThrow(UrlValidationError)
  })

  it('should not allow Next.js dynamic routes', () => {
    expect(() => validator.parse('/[[x]]javascript:alert(1337)/[y]/[z]?x&y&z')).toThrow(UrlValidationError)
  })
})

describe('UrlValidator with invalid options', () => {
  it('should throw an error when the base URL is not a valid URL', () => {
    expect(() => new UrlValidator({ baseOrigin: 'invalid' })).toThrow(OptionsError)
  })

  it('should throw an error when the base URL protocol is not http or https', () => {
    expect(() => new UrlValidator({ baseOrigin: 'ftp://example.com' })).toThrow(OptionsError)
  })

  it('should throw an error when the base URL has a path', () => {
    expect(() => new UrlValidator({ baseOrigin: 'https://example.com/path' })).toThrow(OptionsError)
  })
})
