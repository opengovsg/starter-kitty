import * as fs from 'node:fs'
import { promisify } from 'node:util'

import * as overrides from './overrides'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FSFunction = (...args: any[]) => any

type OverrideMethods<T> = {
  [K in keyof T]?: T[K] extends FSFunction ? T[K] : never
}

function createFSProxy(overrides: OverrideMethods<typeof fs> = {}): typeof fs {
  return new Proxy({} as typeof fs, {
    get: (target, prop: keyof typeof fs) => {
      if (prop in overrides) {
        return overrides[prop]
      }

      const fsMethod = fs[prop]
      if (typeof fsMethod === 'function' && prop !== 'promises') {
        return promisify(fsMethod)
      }
      return fsMethod
    },
  })
}

export default createFSProxy(overrides)
