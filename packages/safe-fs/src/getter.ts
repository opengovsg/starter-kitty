import fs from 'fs'
import { z } from 'zod'

import pathParams from './params.json'
import { sanitizePath } from './sanitizers'

const pathParamsRecordSchema = z.record(z.array(z.number()))
export type PathParamsRecord = z.infer<typeof paramsJsonSchema>

const pathParamsRecord = pathParamsRecordSchema.parse(pathParams)

export const createGetter =
  (basePath: string) => (target: typeof fs, p: keyof typeof fs, receiver) => {
    if (typeof target[p] === 'function') {
      const func = Reflect.get(target, p, receiver)
      const paramsToSanitize = pathParamsRecord[p]

      if (paramsToSanitize) {
        return (...args) => {
          const sanitizedArgs = args.map((arg, i) => {
            // the argument could be a file descriptor
            if (paramsToSanitize.includes(i) && typeof arg !== 'number') {
              return sanitizePath(arg as fs.PathLike, basePath)
            }
            return arg as Parameters<typeof func>[i]
          })
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument
          return func(...sanitizedArgs)
        }
        return func
      }
      return Reflect.get(target, p, receiver)
    }
  }
