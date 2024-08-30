import path from 'node:path'

import { PathLike } from 'memfs/lib/node/types/misc'

const LEADING_DOT_SLASH_REGEX = /^(\.\.(\/|\\|$))+/

export const sanitizePath = (
  dangerousPath: PathLike,
  rootPath: string,
): string => {
  return path.join(
    rootPath,
    path
      .normalize(dangerousPath.toString())
      .replace(LEADING_DOT_SLASH_REGEX, ''),
  )
}
