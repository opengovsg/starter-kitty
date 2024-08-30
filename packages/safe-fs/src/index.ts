import * as fs from 'node:fs'

import { createGetter } from './getter'

const createFs = (basePath: string = process.cwd()) => {
  return new Proxy<typeof fs>(fs, {
    get: createGetter(basePath),
  })
}

export default createFs
