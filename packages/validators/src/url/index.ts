import { ZodError } from 'zod'
import { fromError } from 'zod-validation-error'

import { OptionsError, UrlValidationError } from '@/url/errors'
import {
  defaultOptions,
  optionsSchema,
  Whitelist,
  Options,
} from '@/url/options'
import { createUrlSchema } from '@/url/schema'

/**
 * Validates URLs against a whitelist of allowed protocols and hostnames, preventing open redirects, XSS, SSRF, and other security vulnerabilities.
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
   * @param options - The options to use for validation
   * @throws {@link OptionsError} If the options are invalid
   *
   * @public
   */
  constructor(options: Options = defaultOptions) {
    const result = optionsSchema.safeParse({ ...defaultOptions, ...options })
    if (result.success) {
      this.schema = createUrlSchema(result.data)
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
