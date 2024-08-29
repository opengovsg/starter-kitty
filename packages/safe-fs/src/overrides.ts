import fs from 'node:fs'

import { sanitizeFilePath } from '@/sanitizers'

export class Overrides {
  private basePath: string

  constructor(basePath: string) {
    this.basePath = basePath
  }

  writeFileSync(
    file: Parameters<typeof fs.writeFileSync>[0],
    data: Parameters<typeof fs.writeFileSync>[1],
    options?: Parameters<typeof fs.writeFileSync>[2],
  ) {
    let sanitizedfile = file
    if (typeof file != 'number') {
      // refers to a filepath, not a file descriptor
      sanitizedfile = sanitizeFilePath(file.toString(), this.basePath)
    }
    return fs.writeFileSync(sanitizedfile, data, options)
  }

  readFileSync(
    file: Parameters<typeof fs.readFileSync>[0],
    options?: Parameters<typeof fs.readFileSync>[1],
  ) {
    let sanitizedfile = file
    if (typeof file != 'number') {
      // refers to a filepath, not a file descriptor
      sanitizedfile = sanitizeFilePath(file.toString(), this.basePath)
    }
    return fs.readFileSync(sanitizedfile, options)
  }
}
