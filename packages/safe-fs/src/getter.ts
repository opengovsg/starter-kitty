import fs from 'node:fs'

import { z } from 'zod'

import pathParams from './params.json'
import { sanitizePath } from './sanitizers'

const pathParamsRecordSchema = z.record(z.array(z.number()))
export type PathParamsRecord = z.infer<typeof pathParamsRecordSchema>

const pathParamsRecord = pathParamsRecordSchema.parse(pathParams)

type ReturnType<F extends CallableFunction> = F extends (
  ...args: infer A
) => infer R
  ? R
  : never

export const createGetter: (
  basePath: string,
) => ProxyHandler<typeof fs>['get'] =
  (basePath: string) => (target: typeof fs, p: keyof typeof fs, receiver) => {
    if (
      typeof target[p] === 'function' &&
      // required for func to get the correct type
      p !== 'promises' &&
      p !== 'constants' &&
      p !== 'Stats' &&
      p !== 'StatsFs' &&
      p !== 'Dirent' &&
      p !== 'Dir' &&
      p !== 'ReadStream' &&
      p !== 'WriteStream'
    ) {
      const func = Reflect.get(target, p, receiver)
      const paramsToSanitize = pathParamsRecord[p]

      if (paramsToSanitize) {
        return (...args: Parameters<typeof func>) => {
          const sanitizedArgs = args.map((arg, i) => {
            // the argument could be a file descriptor
            if (paramsToSanitize.includes(i) && typeof arg !== 'number') {
              return sanitizePath(arg as fs.PathLike, basePath)
            }
            return arg
          })
          return (func as CallableFunction)(...sanitizedArgs) as ReturnType<
            typeof func
          >
        }
      }
      return func
    }
    return Reflect.get(target, p, receiver)
  }
