import fs from 'fs'

import PARAMS_TO_SANITIZE from '@/params'
import { sanitizePath } from '@/sanitizers'

type ReturnType<F extends CallableFunction> = F extends (...args: infer A) => infer R ? R : never

type FsFunction = Extract<(typeof fs)[keyof typeof fs], CallableFunction>

export const createGetter: (basePath: string) => ProxyHandler<typeof fs>['get'] =
  (basePath: string) => (target: typeof fs, p: keyof typeof fs, receiver) => {
    if (typeof target[p] === 'function') {
      const func = Reflect.get(target, p, receiver) as FsFunction
      const paramsToSanitize = PARAMS_TO_SANITIZE[p]

      if (paramsToSanitize) {
        return (...args: Parameters<typeof func>) => {
          const sanitizedArgs = args.map((arg, i) => {
            // the argument could be a file descriptor
            if (paramsToSanitize.includes(i) && typeof arg !== 'number') {
              return sanitizePath(arg as fs.PathLike, basePath)
            }
            return arg
          })
          return (func as CallableFunction)(...sanitizedArgs) as ReturnType<typeof func>
        }
      }
      return func
    }
    return Reflect.get(target, p, receiver)
  }
