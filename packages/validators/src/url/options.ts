import { z } from 'zod'

export const defaultOptions = {
  whitelist: {
    protocols: ['http', 'https'],
  },
}

export const whitelistSchema = z.object({
  /**
   * The list of allowed protocols.
   * Caution: allowing `javascript` or `data` protocols can lead to XSS vulnerabilities.
   *
   * @defaultValue ['http', 'https']
   */
  protocols: z.array(z.string()).default(defaultOptions.whitelist.protocols),
  /**
   * The list of allowed hostnames.
   * It is recommended to provide a list of allowed hostnames to prevent open redirects.
   */
  hosts: z.array(z.string()).optional(),
})

export type Whitelist = z.infer<typeof whitelistSchema>

export const optionsSchema = z.object({
  baseOrigin: z
    .string()
    .transform((value, ctx) => {
      if (!URL.canParse(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid base URL',
        })
        return z.NEVER
      }
      return new URL(value)
    })
    .refine((url) => url.protocol === 'http:' || url.protocol === 'https:', {
      message: 'Base URL must use HTTP or HTTPS',
    })
    .refine((url) => url.pathname === '/', {
      message: 'Base URL must not have a path',
    })
    .optional(),
  whitelist: whitelistSchema,
})

export type ParsedOptions = z.infer<typeof optionsSchema>
