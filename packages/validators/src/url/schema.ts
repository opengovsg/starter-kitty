import { z } from 'zod'

import { ParsedUrlValidatorOptions } from '@/url/options'
import { isSafeUrl, resolveRelativeUrl } from '@/url/utils'

export const createUrlSchema = (options: ParsedUrlValidatorOptions) => {
  return z
    .string()
    .transform((url) => resolveRelativeUrl(url, options.baseOrigin))
    .refine((url) => isSafeUrl(url, options.whitelist), {
      message: 'Unsafe URL',
    })
}
