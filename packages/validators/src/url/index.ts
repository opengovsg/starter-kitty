import { ZodError } from 'zod'

import { OptionsError, UrlValidationError } from '@/url/errors'
import { defaultOptions, Options, optionsSchema } from '@/url/options'
import { createUrlSchema } from '@/url/schema'

export class UrlValidator {
  private schema

  constructor(options: Options = defaultOptions) {
    let validatedOptions: Options
    try {
      validatedOptions = optionsSchema.parse({ ...defaultOptions, ...options })
    } catch (error) {
      throw new OptionsError(`Invalid options: ${(error as Error).message}`)
    }
    this.schema = createUrlSchema(validatedOptions)
  }

  parse(url: string): URL {
    const result = this.schema.safeParse(url)
    if (result.success) {
      return result.data
    }
    if (result.error instanceof ZodError) {
      throw new UrlValidationError(JSON.stringify(result.error.format()))
    } else {
      throw result.error
    }
  }
}
