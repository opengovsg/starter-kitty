import path from 'node:path'

export const isSafePath = (
  untrustedPath: string,
  basePath: string,
): boolean => {
  // check for poison null bytes
  if (untrustedPath.indexOf('\0') !== -1) {
    return false
  }
  // check for backslashes
  if (untrustedPath.indexOf('\\') !== -1) {
    return false
  }
  // resolve the path relative to the Node process's current working directory
  // since that's what fs operations will be relative to
  const normalizedPath = path.resolve(untrustedPath) // normalizedPath is now an absolute path

  // check for dot segments, even if they don't normalize to anything
  if (normalizedPath.includes('..')) {
    return false
  }

  // check if the normalized path is within the provided 'safe' base path
  if (normalizedPath.indexOf(basePath) !== 0) {
    return false
  }
  return true
}
