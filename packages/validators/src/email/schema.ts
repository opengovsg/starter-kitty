import { ParsedMailbox, parseOneAddress } from 'email-addresses'
import { z } from 'zod'

import { ParsedEmailValidatorOptions } from '@/email/options'
import { isValidEmail } from '@/email/utils'

const createValidationSchema = (options: ParsedEmailValidatorOptions) =>
  z
    .string()
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
    .refine((parsed) => isValidEmail(parsed, options.domains), {
      message: 'Domain not allowed',
    })
    .transform((parsed) => parsed.address)

export const toSchema = (options: ParsedEmailValidatorOptions) => {
  return z
    .string()
    .trim()
    .email({ message: 'Invalid email address' })
    .pipe(createValidationSchema(options))
}
