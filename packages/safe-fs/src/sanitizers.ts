import { PathLike } from 'fs'
import path from 'path'

const LEADING_DOT_SLASH_REGEX = /^(\.\.(\/|\\|$))+/

export const sanitizePath = (dangerousPath: PathLike, rootPath: string): string => {
  return path.join(rootPath, path.normalize(dangerousPath.toString()).replace(LEADING_DOT_SLASH_REGEX, ''))
}
