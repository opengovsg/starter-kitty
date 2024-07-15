import { ZodError } from 'zod'
import { fromError } from 'zod-validation-error'

import { OptionsError, UrlValidationError } from '@/url/errors'
import { defaultOptions, Options, optionsSchema } from '@/url/options'
import { createUrlSchema } from '@/url/schema'

export class UrlValidator {
  private schema

  constructor(options: Options = defaultOptions) {
    const result = optionsSchema.safeParse({ ...defaultOptions, ...options })
    if (result.success) {
      this.schema = createUrlSchema(result.data)
      return
    }
    throw new OptionsError(fromError(result.error).toString())
  }

  parse(url: string): URL {
    const result = this.schema.safeParse(url)
    if (result.success) {
      return result.data
    }
    if (result.error instanceof ZodError) {
      throw new UrlValidationError(fromError(result.error).toString())
    } else {
      throw result.error
    }
  }
}
