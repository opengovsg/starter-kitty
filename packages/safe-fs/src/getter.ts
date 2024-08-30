import fs from 'fs'

import { sanitizePath } from './sanitizers'

export const createGetter =
  (basePath: string) => (target: typeof fs, p: keyof typeof fs, receiver) => {
    if (typeof target[p] === 'function') {
      return (...args) => {
        if (
          typeof args[0] === 'string' ||
          Buffer.isBuffer(args[0]) ||
          args[0] instanceof URL
        ) {
          args[0] = sanitizePath(args[0], basePath)
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument
        return (Reflect.get(target, p, receiver) as CallableFunction)(...args)
      }
    }
    return Reflect.get(target, p, receiver)
  }
