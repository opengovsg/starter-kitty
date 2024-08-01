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
   * @example
   * `[ 'gov.sg', 'example.com' ]`
   */
  domains?: string[]
  /**
   * Whether subdomains are allowed. Defaults to `true`.
   *
   * @example
   * If `false`, `open.gov.sg` is not allowed, even if `gov.sg` is in the whitelist.
   */
  allowSubdomains?: boolean
}

export const optionsSchema = z.object({
  domains: z.array(z.string()).optional(),
  allowSubdomains: z.boolean().default(true),
})

export type ParsedEmailValidatorOptions = z.infer<typeof optionsSchema>
