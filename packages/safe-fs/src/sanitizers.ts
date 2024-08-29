import path from 'node:path'

const LEADING_DOT_SLASH_REGEX = /^(\.\.(\/|\\|$))+/

export const sanitizeFilePath = (
  filePath: string,
  rootPath: string,
): string => {
  return path.join(
    rootPath,
    path.normalize(filePath).replace(LEADING_DOT_SLASH_REGEX, ''),
  )
}
