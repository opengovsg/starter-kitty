import path from 'node:path'

import { z } from 'zod'

/**
 * The options to use for path validation.
 *
 * @public
 */
export interface PathValidatorOptions {
  /**
   * The base path to use for validation. Defaults to the current working directory.
   * This must be an absolute path.
   *
   * All provided paths, resolved relative to the working directory of the Node process,
   * must be within this directory (or its subdirectories), or they will be considered unsafe.
   * You should provide a safe base path that does not contain sensitive files or directories.
   *
   * @defaultValue `process.cwd()` (the current working directory)
   * @example `'/var/www'`
   */
  basePath?: string
}

export const optionsSchema = z.object({
  basePath: z
    .string()
    .optional()
    .default(() => process.cwd())
    .refine((basePath) => {
      return basePath === path.resolve(basePath) && path.isAbsolute(basePath)
    }),
})

export type ParsedPathValidatorOptions = z.infer<typeof optionsSchema>
