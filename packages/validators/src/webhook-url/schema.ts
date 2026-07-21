import { z } from 'zod/v4'

import { isBlockedHost } from '@/webhook-url/ip-utils'
import { ParsedWebhookUrlValidatorOptions } from '@/webhook-url/options'

export const toSchema = (options: ParsedWebhookUrlValidatorOptions) => {
  return z
    .string()
    .transform((raw, ctx) => {
      try {
        return new URL(raw)
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid URL: ${raw}`,
        })
        return z.NEVER
      }
    })
    .refine(url => options.protocols.some(protocol => url.protocol === `${protocol}:`), {
      message: 'Protocol not allowed for webhook URLs',
    })
    .refine(url => !isBlockedHost(url.hostname), {
      message: 'Webhook URL points to a disallowed network target',
    })
}
