import * as fs from 'node:fs'

import { createGetter } from './getter'

const safeFs = (basePath: string = process.cwd()) => {
  return new Proxy<typeof fs>(fs, {
    get: createGetter(basePath),
  })
}

export default safeFs
