import { ParsedMailbox, parseOneAddress } from 'email-addresses'
import { z } from 'zod'

import { ParsedEmailValidatorOptions } from '@/email/options'
import { isWhitelistedDomain } from '@/email/utils'

export const toSchema = (options: ParsedEmailValidatorOptions) => {
  return z
    .string()
    .trim()
    .email({ message: 'Invalid email address' })
    .transform((email, ctx) => {
      const parsed = parseOneAddress(email) as ParsedMailbox
      if (!parsed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid email address',
        })
        return z.NEVER
      }
      return parsed
    })
    .refine(
      (parsed) => {
        if (options.domains.length === 0) {
          return true
        }
        const domain = parsed.domain
        return isWhitelistedDomain(domain, options.domains)
      },
      {
        message: 'Domain not allowed',
      },
    )
    .transform((parsed) => parsed.address)
}
