import { z } from 'zod'

import { ParsedUrlValidatorOptions } from '@/url/options'
import { getErrorMessage, IS_NOT_HOSTNAME_REGEX, resolveRelativeUrl } from '@/url/utils'

import { isDynamicRoute } from './nextjs-dynamic-route'

export const toSchema = (options: ParsedUrlValidatorOptions) => {
  const { whitelist } = options
  return z
    .string()
    .transform((url, ctx) => {
      try {
        return resolveRelativeUrl(url, options.baseOrigin)
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: getErrorMessage(error),
        })
        return z.NEVER
      }
    })
    .refine(
      url => {
        // only allow whitelisted protocols
        if (!whitelist.protocols.some(protocol => url.protocol === `${protocol}:`)) {
          return false
        }
        // only allow whitelisted characters in the path
        const conformsToPathRegex = z.string().regex(options.whitelist.validPathRegex).safeParse(url.pathname).success
        if (!conformsToPathRegex) {
          return false
        }

        if (whitelist.hosts) {
          // only allow whitelisted hosts
          if (!whitelist.hosts.some(host => url.host === host)) {
            return false
          }
        } else {
          // no hosts provided
          if (whitelist.disallowHostnames && !url.host.match(IS_NOT_HOSTNAME_REGEX)) {
            return false
          }
        }

        // don't allow pathname with double slashes
        if (url.pathname.replace(/\\/g, '/').startsWith('//')) {
          return false
        }

        // don't allow dynamic routes
        if (isDynamicRoute(url)) {
          return false
        }
        return true
      },
      {
        message: 'Unsafe URL',
      },
    )
}
