import path from 'node:path'

import { z } from 'zod'

import { ParsedPathValidatorOptions } from '@/path/options'
import { isSafePath } from '@/path/utils'

const createValidationSchema = (options: ParsedPathValidatorOptions) =>
  z
    .string()
    .transform((untrustedPath) => path.resolve(untrustedPath))
    .refine((resolvedPath) => isSafePath(resolvedPath, options.basePath), {
      message: 'The provided path is unsafe.',
    })

export const toSchema = (options: ParsedPathValidatorOptions) => {
  return z.string().trim().pipe(createValidationSchema(options))
}
