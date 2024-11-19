import path from 'path'

export const isSafePath = (absPath: string, basePath: string): boolean => {
  // check for poison null bytes
  if (absPath.indexOf('\0') !== -1) {
    return false
  }
  // check for backslashes
  if (absPath.indexOf('\\') !== -1) {
    return false
  }

  // check for dot segments, even if they don't normalize to anything
  if (absPath.includes('..')) {
    return false
  }

  // check if the normalized path is within the provided 'safe' base path
  if (path.resolve(basePath, path.relative(basePath, absPath)) !== absPath) {
    return false
  }
  if (absPath.indexOf(basePath) !== 0) {
    return false
  }
  return true
}
