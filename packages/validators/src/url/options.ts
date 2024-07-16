import { z } from 'zod'

export const defaultOptions = {
  whitelist: {
    protocols: ['http', 'https'],
  },
}

export const whitelistSchema = z.object({
  protocols: z.array(z.string()).default(defaultOptions.whitelist.protocols),
  hosts: z.array(z.string()).optional(),
})

export type Whitelist = z.infer<typeof whitelistSchema>

export const optionsSchema = z.object({
  baseUrl: z
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

export type Options = z.infer<typeof optionsSchema>
