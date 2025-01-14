import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'

import { OptionsError } from '@/common/errors'
import { createUrlSchema, RelUrlValidator, UrlValidator } from '@/index'
import { UrlValidationError } from '@/url/errors'
import { defaultAllowedChars } from '@/url/options'

describe('UrlValidator with default options', () => {
  const validator = new UrlValidator()

  it('should parse a valid URL', () => {
    const url = validator.parse('https://example.com')
    expect(url).toBeInstanceOf(URL)
  })

  it('should parse a valid URL', () => {
    const url = validator.parse('https://example.com/path?query=1#hash')
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
    expect(() => validator.parse('https://example.com/path/(.)part')).toThrow(UrlValidationError)
  })

  it('should prevent XSS attacks', () => {
    expect(() => validator.parse('javascript&colonalert(/xss/)')).toThrow(UrlValidationError)
    expect(() => validator.parse('javascript:alert(/xss/)')).toThrow(UrlValidationError)
  })

  it('should throw an error when given an invalid type', () => {
    expect(() => validator.parse(123)).toThrow(UrlValidationError)
    expect(() => validator.parse(undefined)).toThrow(UrlValidationError)
    expect(() => validator.parse(['1', '2'])).toThrow(UrlValidationError)
  })
})

describe('UrlValidator with custom protocol whitelist', () => {
  const validator = new UrlValidator({
    whitelist: {
      protocols: ['http', 'https'],
      allowedCharactersInPath: '', // blank to allow all characters for tests
    },
  })

  it('should not throw an error when the protocol on the whitelist', () => {
    expect(() => validator.parse('https://example.com')).not.toThrow()
    expect(() => validator.parse('http://example.com')).not.toThrow()
  })

  it('should throw an error when the protocol is not on the whitelist', () => {
    expect(() => validator.parse('ftp://example.com')).toThrow(UrlValidationError)
    expect(() => validator.parse('javascript:alert()')).toThrow(UrlValidationError)
    expect(() => validator.parse('mailto:contact@example.com')).toThrow(UrlValidationError)
  })
})

describe('UrlValidator with custom host whitelist', () => {
  const validator = new UrlValidator({
    whitelist: {
      protocols: ['http', 'https'],
      hosts: ['example.com'],
      allowedCharactersInPath: '', // blank to allow all characters
    },
  })

  it('should not throw an error when the host is on the whitelist', () => {
    expect(() => validator.parse('https://example.com')).not.toThrow()
  })

  it('should throw an error when the host is not on the whitelist', () => {
    expect(() => validator.parse('https://open.gov.sg')).toThrow(UrlValidationError)
  })
})

describe('UrlValidator with disallowHostnames', () => {
  const validator = new UrlValidator({
    whitelist: {
      protocols: ['http', 'https'],
      disallowHostnames: true,
      allowedCharactersInPath: '', // blank to allow all characters for tests
    },
  })

  it('should not throw an error with a proper domain', () => {
    expect(() => validator.parse('https://example.com')).not.toThrow()
  })

  it('should not throw an error with a proper domain', () => {
    const url = validator.parse('https://example.com/path?query=1#hash')
    expect(url).toBeInstanceOf(URL)
  })

  it('should throw an error with a hostname', () => {
    expect(() => validator.parse('https://tld')).toThrow(UrlValidationError)
    expect(() => validator.parse('https://.tld')).toThrow(UrlValidationError)
    expect(() => validator.parse('https://tld.')).toThrow(UrlValidationError)
    expect(() => validator.parse('https://.tld.')).toThrow(UrlValidationError)
    expect(() => validator.parse('https://tld/')).toThrow(UrlValidationError)
    expect(() => validator.parse('https://.tld/')).toThrow(UrlValidationError)
    expect(() => validator.parse('https://tld./')).toThrow(UrlValidationError)
    expect(() => validator.parse('https://.tld./')).toThrow(UrlValidationError)
  })
})

describe('UrlValidator with both hosts and disallowHostnames', () => {
  const validator = new UrlValidator({
    whitelist: {
      protocols: ['http', 'https'],
      hosts: ['example.com', 'localhost'],
      disallowHostnames: true,
      allowedCharactersInPath: '', // blank to allow all characters for tests
    },
  })

  it('should not throw an error when the host is on the whitelist', () => {
    expect(() => validator.parse('https://example.com')).not.toThrow()
  })

  it('should not throw an error when the host is on the whitelist', () => {
    const url = validator.parse('https://example.com/path?query=1#hash')
    expect(url).toBeInstanceOf(URL)
  })

  it('should ignore the disallowHostnames option', () => {
    expect(() => validator.parse('https://localhost')).not.toThrow()
  })
})

describe('UrlValidator with base URL', () => {
  const validator = new UrlValidator({
    baseOrigin: 'https://example.com',
    whitelist: {
      protocols: ['http', 'https'], // default
      allowedCharactersInPath: '', // blank to allow all characters for tests
    },
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

  it('should not allow Next.js dynamic routes', () => {
    expect(() =>
      validator.parse('/[[x]x]]https://[y]y]//example.com/[[/[[x]x]]/y?x=[[x]&x]x&%2F[[x=[[/[[x]&y=[y]&y]y='),
    ).toThrow(UrlValidationError)
  })

  it('should not allow Next.js dynamic routes', () => {
    expect(() => validator.parse('/[[x]x]]javascript:alert(1)%2F%2F/[[/[[x]x]]/y?x=[[x]&x]x&%2F[[x=[[/[[x]')).toThrow(
      UrlValidationError,
    )
  })

  it('should not allow Next.js dynamic routes', () => {
    expect(() => validator.parse('/[[x]]http:example.com/(.)[y]/?x&y')).toThrow(UrlValidationError)
  })
})

describe('UrlValidator with a whitelist of allowed characters in the path', () => {
  const validator = new UrlValidator({
    whitelist: {
      protocols: ['http', 'https'],
      allowedCharactersInPath: 'abc123/',
    },
  })
  it('should parse a valid URL', () => {
    const url = validator.parse('https://example.com/abc123')
    expect(url).toBeInstanceOf(URL)
  })

  it('should parse a valid URL with query string and hash', () => {
    const url = validator.parse('https://example.com/abc123?q=1#hash')
    expect(url).toBeInstanceOf(URL)
  })

  it('should throw an error when the path contains disallowed characters', () => {
    expect(() => validator.parse('https://example.com/abc1234')).toThrow(UrlValidationError)
  })
})

describe('UrlValidator with the default whitelist', () => {
  const validator = new UrlValidator({})

  it('should parse a valid URL', () => {
    const url = validator.parse('https://example.com')
    expect(url).toBeInstanceOf(URL)
  })

  it('should parse a valid URL', () => {
    const url = validator.parse('https://example.com/path?query=1#hash')
    expect(url).toBeInstanceOf(URL)
  })

  it('should throw an error when the path contains disallowed characters', () => {
    expect(() => validator.parse('https://example.com/1@23')).toThrow(UrlValidationError)
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
    expect(() => validator.parse('https://example.com/path/(.)part')).toThrow(UrlValidationError)
  })

  it('should prevent XSS attacks', () => {
    expect(() => validator.parse('javascript&colonalert(/xss/)')).toThrow(UrlValidationError)
    expect(() => validator.parse('javascript:alert(/xss/)')).toThrow(UrlValidationError)
  })

  it('should throw an error when given an invalid type', () => {
    expect(() => validator.parse(123)).toThrow(UrlValidationError)
    expect(() => validator.parse(undefined)).toThrow(UrlValidationError)
    expect(() => validator.parse(['1', '2'])).toThrow(UrlValidationError)
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

describe('RelUrlValidator with string origin', () => {
  const validator = new RelUrlValidator('https://a.com')

  it('should parse a valid absolute URL', () => {
    const url = validator.parse('https://a.com/hello')
    expect(url).toBeInstanceOf(URL)
  })

  it('should parse a valid absolute URL', () => {
    const url = validator.parse('https://a.com/path?query=1#hash')
    expect(url).toBeInstanceOf(URL)
  })

  it('should throw an error on invalid URL', () => {
    expect(() => validator.parse('https://b.com/hello')).toThrow(UrlValidationError)
  })

  it('should parse a valid relative URL', () => {
    const url = validator.parse('hello')
    expect(url).toBeInstanceOf(URL)
    expect(url.href).toStrictEqual('https://a.com/hello')
  })

  it('should parse a valid relative URL', () => {
    const url = validator.parse('/hello')
    expect(url).toBeInstanceOf(URL)
    expect(url.href).toStrictEqual('https://a.com/hello')
  })

  it('should parse a valid relative URL', () => {
    const url = validator.parse('/hello?q=3')
    expect(url).toBeInstanceOf(URL)
    expect(url.href).toStrictEqual('https://a.com/hello?q=3')
  })

  it('should throw an error when the protocol is not http or https', () => {
    expect(() => validator.parse('ftp://a.com')).toThrow(UrlValidationError)
  })
})

describe('UrlValidatorOptions.parsePathname', () => {
  const validator = new RelUrlValidator('https://a.com')

  it('should extract the pathname of a valid URL', () => {
    const pathname = validator.parsePathname('hello')
    expect(pathname).toStrictEqual('/hello')
  })

  it('should extract the pathname of a valid URL', () => {
    const pathname = validator.parsePathname('/hello')
    expect(pathname).toStrictEqual('/hello')
  })

  it('should extract the pathname of a valid URL', () => {
    const pathname = validator.parsePathname('/hello?q=3#123')
    expect(pathname).toStrictEqual('/hello')
  })

  it('should extract the pathname of a valid URL', () => {
    const pathname = validator.parsePathname('/hello?q=3#123/what')
    expect(pathname).toStrictEqual('/hello')
  })

  it('should extract the pathname of a valid URL', () => {
    const pathname = validator.parsePathname('https://a.com/hello?q=3#123/what')
    expect(pathname).toStrictEqual('/hello')
  })

  it('should extract the pathname of a valid URL', () => {
    const pathname = validator.parsePathname('https://a.com/hello/world')
    expect(pathname).toStrictEqual('/hello/world')
  })

  it('should throw an error when the URL is on a different domain', () => {
    expect(() => validator.parsePathname('https://b.com/hello/')).toThrow(UrlValidationError)
  })

  it('should throw an error when the path is a NextJS dynamic path', () => {
    expect(() => validator.parsePathname('https://a.com/hello/[id]?id=3')).toThrow(UrlValidationError)
    expect(() => validator.parsePathname('https://a.com/hello/(.)bye')).toThrow(UrlValidationError)
  })

  it('should fallback to fallbackUrl if it is provided', () => {
    const pathname = validator.parsePathname('https://b.com/hello', 'bye')
    expect(pathname).toStrictEqual('/bye')
  })
})

describe('createUrlSchema', () => {
  it('should create a schema with default options', () => {
    const schema = createUrlSchema()
    expect(() => schema.parse('https://example.com')).not.toThrow()
  })

  it('should create a schema with custom options', () => {
    const schema = createUrlSchema({
      whitelist: {
        protocols: ['http', 'https', 'mailto'],
      },
    })
    expect(() => schema.parse('https://example.com')).not.toThrow()
  })

  it('should create a schema with custom options', () => {
    const schema = createUrlSchema({
      whitelist: {
        protocols: ['http', 'https', 'mailto'],
        allowedCharactersInPath: defaultAllowedChars + '@',
      },
    })
    expect(() => schema.parse('mailto:contact@example.com')).not.toThrow()
  })

  it('should throw an error when the options are invalid', () => {
    expect(() => createUrlSchema({ baseOrigin: 'invalid' })).toThrow(OptionsError)
    expect(() => createUrlSchema({ baseOrigin: 'ftp://example.com' })).toThrow(OptionsError)
    expect(() => createUrlSchema({ baseOrigin: 'https://example.com/path' })).toThrow(OptionsError)
  })

  it('should not throw an error when the options are valid', () => {
    expect(() =>
      createUrlSchema({
        whitelist: {
          protocols: ['http', 'https'],
          hosts: ['example.com'],
          disallowHostnames: true,
          allowedCharactersInPath: defaultAllowedChars,
        },
      }),
    ).not.toThrow()
  })

  it('should reject relative URLs when the base URL is not provided', () => {
    const schema = createUrlSchema()
    expect(() => schema.parse('/path')).toThrow(ZodError)
  })
})
