import { z } from 'zod'

import { ParsedEmailValidatorOptions } from '@/email/options'
import { isWhitelistedDomain, parseEmail } from '@/email/utils'

export const createEmailSchema = (options: ParsedEmailValidatorOptions) => {
  return z
    .string()
    .trim()
    .email('Invalid email address')
    .transform((email) => parseEmail(email))
    .refine(
      (parsed) => {
        if (!options.domains) {
          return true
        }
        const domain = parsed.domain
        return isWhitelistedDomain(
          domain,
          options.domains,
          options.allowSubdomains,
        )
      },
      {
        message: 'Domain not allowed',
      },
    )
    .transform((parsed) => parsed.address)
}
