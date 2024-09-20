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
    const result = optionsSchema.safeParse({ ...defaultOptions, ...options })
    if (result.success) {
      this.schema = toSchema(result.data)
      return
    }
    throw new OptionsError(fromError(result.error).toString())
  }

  /**
   * Parses a URL string.
   *
   * @param url - The URL to validate
   * @throws {@link UrlValidationError} If the URL is invalid
   * @returns The URL object if the URL is valid
   *
   * @public
   */
  parse(url: string): URL {
    const result = this.schema.safeParse(url)
    if (result.success) {
      return result.data
    }
    if (result.error instanceof ZodError) {
      throw new UrlValidationError(fromError(result.error).toString())
    } else {
      throw result.error
    }
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
