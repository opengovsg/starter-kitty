import { ZodError } from 'zod'
import { fromError } from 'zod-validation-error'

import { OptionsError } from '@/common/errors'
import { Options, optionsSchema } from '@/email/options'

import { EmailValidationError } from './errors'
import { createEmailSchema } from './schema'

export class EmailValidator {
  private schema

  constructor(options: Options = {}) {
    const result = optionsSchema.safeParse(options)
    if (result.success) {
      this.schema = createEmailSchema(result.data)
      return
    }
    throw new OptionsError(fromError(result.error).toString())
  }

  /**
   * Parses an email address string.
   *
   * @param email - The email to validate
   * @throws {@link EmailValidationError} If the email is invalid
   * @returns
   *
   * @public
   */
  parse(email: string) {
    const result = this.schema.safeParse(email)
    if (result.success) {
      return result.data
    }
    if (result.error instanceof ZodError) {
      throw new EmailValidationError(fromError(result.error).toString())
    } else {
      throw result.error
    }
  }
}
