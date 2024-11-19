import path from 'path'

import { z } from 'zod'

import { ParsedPathValidatorOptions } from '@/path/options'
import { isSafePath } from '@/path/utils'

const createValidationSchema = (options: ParsedPathValidatorOptions) =>
  z
    .string()
    // resolve the path relative to the Node process's current working directory
    // since that's what fs operations will be relative to
    .transform(untrustedPath => path.resolve(untrustedPath))
    // resolvedPath is now an absolute path
    .refine(resolvedPath => isSafePath(resolvedPath, options.basePath), {
      message: 'The provided path is unsafe.',
    })

export const toSchema = (options: ParsedPathValidatorOptions) => {
  return z.string().trim().pipe(createValidationSchema(options))
}
