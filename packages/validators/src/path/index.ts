import { ZodSchema } from 'zod'
import { fromError } from 'zod-validation-error'

import { OptionsError } from '@/common/errors'
import { optionsSchema, PathValidatorOptions } from '@/path/options'
import { toSchema } from '@/path/schema'

/**
 * Create a schema that validates user-supplied pathnames for filesystem operations.
 *
 * @param options - The options to use for validation
 * @throws {@link OptionsError} If the options are invalid
 * @returns A Zod schema that validates paths.
 *
 * @public
 */
export const createPathSchema = (options: PathValidatorOptions): ZodSchema<string> => {
  const result = optionsSchema.safeParse(options)
  if (result.success) {
    return toSchema(result.data)
  }
  throw new OptionsError(fromError(result.error).toString())
}

export type { PathValidatorOptions } from '@/path/options'
