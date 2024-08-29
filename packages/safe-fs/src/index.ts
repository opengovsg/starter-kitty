import * as fs from 'node:fs'

import { Overrides } from '@/overrides'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FsFunction = (...args: any[]) => any

type OverrideMethods<T> = {
  // We only want to override methods, not properties
  [K in keyof T]?: T[K] extends FsFunction ? T[K] : never
}

function createFs(basePath: string = process.cwd()): typeof fs {
  const overrides = new Overrides(basePath) as OverrideMethods<typeof fs>

  return new Proxy({} as typeof fs, {
    get: (target, prop: keyof typeof fs) => {
      if (prop in overrides) {
        return overrides[prop]
      }

      return fs[prop]
    },
  })
}

export default createFs
