import { ZodSchema } from 'zod'
import { fromError } from 'zod-validation-error'

import { OptionsError } from '@/common/errors'
import { EmailValidatorOptions, optionsSchema } from '@/email/options'
import { toSchema } from '@/email/schema'

/**
 * Create a schema that validates emails against RFC 5322 and a whitelist of domains.
 *
 * @param options - The options to use for validation
 * @throws {@link OptionsError} If the options are invalid
 * @returns A Zod schema that validates emails according to the provided options
 *
 * @public
 */
export const createEmailSchema = (options: EmailValidatorOptions = {}): ZodSchema<string> => {
  const result = optionsSchema.safeParse(options)
  if (result.success) {
    return toSchema(result.data)
  }
  throw new OptionsError(fromError(result.error).toString())
}

export type { EmailValidatorOptions } from '@/email/options'
