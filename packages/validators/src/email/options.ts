import { z } from 'zod'

/**
 * The options to use for email validation.
 *
 * @public
 */
export interface Options {
  /**
   * The list of allowed domains for the domain part of the email address.
   * If not provided, all domains are allowed.
   *
   * @example `[ 'gov.sg', 'example.com' ]`
   */
  domains?: string[]
  /**
   * Whether subdomains are allowed. Defaults to `true`.
   *
   * @example If true, this will allow `open.gov.sg` if `gov.sg` is allowed.
   */
  allowSubdomains?: boolean
}

export const optionsSchema = z.object({
  domains: z.array(z.string()).optional(),
  allowSubdomains: z.boolean().default(true),
})

export type ParsedOptions = z.infer<typeof optionsSchema>
