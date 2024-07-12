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
    .transform((value) => new URL(value))
    .refine(
      (value) => value.protocol === 'http:' || value.protocol === 'https:',
    )
    .optional(),
  whitelist: whitelistSchema,
})

export type Options = z.infer<typeof optionsSchema>
