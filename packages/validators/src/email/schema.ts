import { z } from 'zod'

import { ParsedEmailValidatorOptions } from '@/email/options'
import { isWhitelistedDomain, parseEmail } from '@/email/utils'

export const toSchema = (options: ParsedEmailValidatorOptions) => {
  return z
    .string()
    .trim()
    .email('Invalid email address')
    .transform((email) => parseEmail(email))
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
