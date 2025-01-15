import { z } from 'zod'

export const defaultValidPathRegex = /^[a-zA-Z0-9._\-/]*$/

export const defaultOptions = {
  whitelist: {
    protocols: ['http', 'https'],
    disallowHostnames: false,
    validPathRegex: defaultValidPathRegex,
  },
}

export const whitelistSchema = z.object({
  /**
   * The list of allowed protocols.
   * Caution: allowing `javascript` or `data` protocols can lead to XSS vulnerabilities.
   *
   * @defaultValue ['http', 'https']
   */
  protocols: z.array(z.string()).default(defaultOptions.whitelist.protocols),
  /**
   * The list of allowed hostnames.
   * It is recommended to provide a list of allowed hostnames to prevent open redirects.
   */
  hosts: z.array(z.string()).optional(),
  /**
   * Whether to disallow hostnames as valid URLs.
   * For example, if disallowHostnames is set to `true`, https://localhost/somepath will be invalid.
   * This option is IGNORED if hosts is provided.
   *
   * @defaultValue false
   */
  disallowHostnames: z.boolean().default(false),
  /**
   * Regex to match against the URL path.
   * Use / .* / to allow all characters
   * If your protocol is mailto, you will need to include "\@" here.
   *
   * @defaultValue defaultValidPathRgex
   */
  validPathRegex: z.instanceof(RegExp).default(defaultValidPathRegex),
})

/**
 * The options to use for URL validation.
 *
 * @public
 */
export interface UrlValidatorOptions {
  /**
   * The base origin to use for relative URLs. If no base origin is provided, relative URLs will be considered invalid.
   * An origin does not include the path or query parameters. For example, a valid base origin is `https://example.com` or `http://localhost:3000`.
   */
  baseOrigin?: string
  /**
   * The list of allowed protocols and hostnames for URL validation.
   * The default whitelist allows only `http` and `https` protocols, and does not restrict hostnames.
   *
   * @example
   * ```
   * {
   *    protocols: ['http', 'https'],
   *    hosts: ['example.com']
   * }
   * ```
   * */
  whitelist?: UrlValidatorWhitelist
}

/**
 * The list of allowed protocols and hostnames for URL validation.
 *
 * @public
 */
export type UrlValidatorWhitelist = z.input<typeof whitelistSchema>

export const optionsSchema = z.object({
  baseOrigin: z
    .string()
    .transform((value, ctx) => {
      try {
        return new URL(value)
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid base URL',
        })
        return z.NEVER
      }
    })
    .refine(url => url.protocol === 'http:' || url.protocol === 'https:', {
      message: 'Base URL must use HTTP or HTTPS',
    })
    .refine(url => url.pathname === '/', {
      message: 'Base URL must not have a path',
    })
    .optional(),
  whitelist: whitelistSchema,
})

export type ParsedUrlValidatorOptions = z.infer<typeof optionsSchema>
