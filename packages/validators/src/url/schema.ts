import { z } from 'zod'

import { Options } from '@/url/options'
import { isSafeUrl, resolveRelativeUrl } from '@/url/utils'

export const createUrlSchema = (options: Options) => {
  return z
    .string()
    .transform((url) => resolveRelativeUrl(url, options.baseOrigin))
    .refine((url) => isSafeUrl(url, options.whitelist), {
      message: 'Unsafe URL',
    })
}
