import { ZodError, ZodSchema, ZodTypeDef } from 'zod'
import { fromError } from 'zod-validation-error'

import { OptionsError } from '@/common/errors'
import { UrlValidationError } from '@/url/errors'
import { defaultOptions, optionsSchema, UrlValidatorOptions } from '@/url/options'
import { toSchema } from '@/url/schema'

/**
 * Parses URLs according to WHATWG standards and validates against a whitelist of allowed protocols and hostnames,
 * preventing open redirects, XSS, SSRF, and other security vulnerabilities.
 *
 * @public
 */
export class UrlValidator {
  private schema

  /**
   * Creates a new UrlValidator instance. If no options are provided, the validator will use the default options:
   *
   * ```ts
   * {
   *    whitelist: {
   *      protocols: ['http', 'https'],
   *    },
   * }
   * ```
   *
   * In most cases, you should provide your own whitelist with a list of allowed hostnames to prevent open redirects.
   *
   * @param options - The options to use for validation
   * @throws {@link OptionsError} If the options are invalid
   *
   * @public
   */
  constructor(options: UrlValidatorOptions = defaultOptions) {
    this.schema = createUrlSchema(options)
  }

  /**
   * Parses a URL string
   *
   * @param url - The URL to validate
   * @throws {@link UrlValidationError} if the URL is invalid.
   * @returns The URL object if the URL is valid
   *
   * @internal
   */
  #parse(url: string): URL {
    const result = this.schema.safeParse(url)
    if (result.success) {
      return result.data
    }
    if (result.error instanceof ZodError) {
      throw new UrlValidationError(fromError(result.error).toString())
    } else {
      // should only be UrlValidationError
      throw result.error
    }
  }

  /**
   * Parses a URL string with a fallback option.
   *
   * @param url - The URL to validate
   * @param fallbackUrl - The fallback URL to return if the URL is invalid.
   * @throws {@link UrlValidationError} if the URL is invalid and fallbackUrl is not provided.
   * @returns The URL object if the URL is valid, else the fallbackUrl (if provided).
   *
   * @public
   */
  parse(url: string, fallbackUrl: string | URL): URL
  parse(url: string): URL
  parse(url: string, fallbackUrl: undefined): URL
  parse(url: string, fallbackUrl?: string | URL): URL {
    try {
      return this.#parse(url)
    } catch (error) {
      if (error instanceof UrlValidationError && fallbackUrl !== undefined) {
        // URL validation failed, return the fallback URL
        return this.#parse(fallbackUrl instanceof URL ? fallbackUrl.href : fallbackUrl)
      }
      // otherwise rethrow
      throw error
    }
  }

  /**
   * Parses a URL string and returns the pathname with a fallback option.
   *
   * @param url - The URL to validate and extract pathname from
   * @param fallbackUrl - The fallback URL to use if the URL is invalid.
   * @throws {@link UrlValidationError} if the URL is invalid and fallbackUrl is not provided.
   * @returns The pathname of the URL or the fallback URL
   *
   * @public
   */
  parsePathname(url: string, fallbackUrl: string | URL): string
  parsePathname(url: string): string
  parsePathname(url: string, fallbackUrl: undefined): string
  parsePathname(url: string, fallbackUrl?: string | URL): string {
    const parsedUrl = fallbackUrl ? this.parse(url, fallbackUrl) : this.parse(url)
    if (parsedUrl instanceof URL) return parsedUrl.pathname
    return parsedUrl
  }
}

/**
 * Parses URLs according to WHATWG standards and validates against a given origin.
 *
 * @public
 */
export class RelUrlValidator extends UrlValidator {
  /**
   * Creates a new RelUrlValidator instance which only allows relative URLs.
   *
   * @param origin - The base origin against which relative URLs will be resolved. Must be a valid absolute URL (e.g., 'https://example.com').
   * @throws TypeError If the provided origin is not a valid URL.
   *
   * @public
   */
  constructor(origin: string | URL) {
    const urlObject = new URL(origin)
    super({
      baseOrigin: urlObject.origin,
      whitelist: {
        protocols: ['http', 'https'],
        hosts: [urlObject.host],
      },
    })
  }
}

/**
 * Create a schema that validates user-supplied URLs. This does the same thing as the `UrlValidator` class,
 * but it returns a Zod schema which can be used as part of a larger schema.
 *
 * @param options - The options to use for validation
 * @throws {@link OptionsError} If the options are invalid
 * @returns A Zod schema that validates paths.
 *
 * @public
 */
export const createUrlSchema = (options: UrlValidatorOptions = defaultOptions): ZodSchema<URL, ZodTypeDef, string> => {
  const result = optionsSchema.safeParse({ ...defaultOptions, ...options })
  if (result.success) {
    return toSchema(result.data)
  }
  throw new OptionsError(fromError(result.error).toString())
}

export type * from '@/url/errors'
export type { UrlValidatorOptions } from '@/url/options'
