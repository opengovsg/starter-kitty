import path from 'path'
import { z } from 'zod'

/**
 * The options to use for path validation.
 *
 * @public
 */
export interface PathValidatorOptions {
  /**
   * The base path to use for validation. This must be an absolute path.
   *
   * All provided paths, resolved relative to the working directory of the Node process,
   * must be within this directory (or its subdirectories), or they will be considered unsafe.
   * You should provide a safe base path that does not contain sensitive files or directories.
   *
   * @example `'/var/www'`
   */
  basePath: string
}

export const optionsSchema = z.object({
  basePath: z.string().refine(basePath => {
    return basePath === path.resolve(basePath) && path.isAbsolute(basePath)
  }, 'The base path must be an absolute path'),
})

export type ParsedPathValidatorOptions = z.infer<typeof optionsSchema>
