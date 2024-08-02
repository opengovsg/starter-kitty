import { z } from 'zod'

/**
 * The options to use for email validation.
 *
 * @public
 */
export interface EmailValidatorOptions {
  /**
   * The list of allowed domains for the domain part of the email address.
   * If not provided, all domains are allowed.
   *
   * Each whitelisted domain must be specified as an object with the `domain`
   * and `includeSubdomains` properties. If `includeSubdomains` is `true`, all
   * subdomains of the domain are also allowed.
   *
   * @example
   * ```javascript
   * [ { domain: 'gov.sg', includeSubdomains: true } ]
   * ```
   *
   * This will allow `gov.sg` and all subdomains of `gov.sg`, such as `open.gov.sg`.
   */
  domains?: { domain: string; includeSubdomains?: boolean }[]
}

export const optionsSchema = z.object({
  domains: z
    .array(
      z.object({
        domain: z.string(),
        includeSubdomains: z.boolean().optional(),
      }),
    )
    .default([]),
})

export type ParsedEmailValidatorOptions = z.infer<typeof optionsSchema>
