import fs from 'node:fs'

import { sanitizeFilePath } from './sanitizers'

export const writeFileSync = (
  file: Parameters<typeof fs.writeFileSync>[0],
  data: Parameters<typeof fs.writeFileSync>[1],
  options?: Parameters<typeof fs.writeFileSync>[2],
): void => {
  let sanitizedfile = file
  if (typeof file != 'number') {
    // refers to a filepath, not a file descriptor
    sanitizedfile = sanitizeFilePath(file.toString(), process.cwd())
  }
  return fs.writeFileSync(sanitizedfile, data, options)
}
