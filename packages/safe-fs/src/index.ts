import * as fs from 'node:fs'

import { createGetter } from './getter'

/**
 * Creates a safe-by-default version of the Node.js `fs` module.
 *
 * @public
 * @param basePath - The base path to use for all file system operations.
 * @returns
 * A safe version of the Node.js `fs` module, guarded against path traversal
 * attacks and absolute path usage.
 *
 * All interfaces are exactly the same as the original `fs` module,
 * but all file paths are resolved relative to the provided `basePath`
 * and are guaranteed to fall within the `basePath` when the `fs`
 * operations are executed.
 *
 * The use of file descriptors in place of a file path is not affected.
 */
const safeFs = (basePath: string = process.cwd()) => {
  return new Proxy<typeof fs>(fs, {
    get: createGetter(basePath),
  })
}

export default safeFs
