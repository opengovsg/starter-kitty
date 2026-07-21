import { z } from 'zod/v4'

import { isBlockedHost } from '@/webhook-url/ip-utils'
import { ParsedWebhookUrlValidatorOptions } from '@/webhook-url/options'

export const toSchema = (options: ParsedWebhookUrlValidatorOptions) => {
  const protocolPattern = new RegExp(`^(${options.protocols.join('|')})$`)

  return z
    .url({ protocol: protocolPattern, message: 'Protocol not allowed for webhook URLs' })
    .transform(raw => new URL(raw))
    .refine(url => !isBlockedHost(url.hostname), {
      message: 'Webhook URL points to a disallowed network target',
    })
}
