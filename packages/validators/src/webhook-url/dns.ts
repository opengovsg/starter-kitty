import { lookup as nodeLookup } from 'node:dns/promises'

import { WebhookUrlValidationError } from '@/webhook-url/errors'
import { isBlockedIp } from '@/webhook-url/ip-utils'

export interface DnsLookupResult {
  address: string
  family: number
}

export type DnsLookupFn = (hostname: string) => Promise<DnsLookupResult[]>

export const defaultDnsLookup: DnsLookupFn = hostname => nodeLookup(hostname, { all: true, verbatim: true })

/**
 * Resolves a webhook hostname on the server and validates every resolved IP address against the
 * blocked private/reserved ranges, to prevent DNS rebinding (a hostname that resolves to a safe IP
 * at save time but an internal IP at delivery time, or that has both safe and unsafe A/AAAA records).
 *
 * @throws {@link WebhookUrlValidationError} if the hostname cannot be resolved, or if any resolved
 * address falls within a blocked range.
 * @returns The list of resolved IP addresses, all validated as safe.
 */
export const resolveAndValidateHost = async (
  hostname: string,
  lookup: DnsLookupFn = defaultDnsLookup,
): Promise<string[]> => {
  let results: DnsLookupResult[]
  try {
    results = await lookup(hostname)
  } catch {
    throw new WebhookUrlValidationError(`Could not resolve webhook host: ${hostname}`)
  }

  if (!results.length) {
    throw new WebhookUrlValidationError(`Could not resolve webhook host: ${hostname}`)
  }

  const blocked = results.find(result => isBlockedIp(result.address))
  if (blocked) {
    throw new WebhookUrlValidationError(
      `Webhook host "${hostname}" resolves to a blocked network address (${blocked.address})`,
    )
  }

  return results.map(result => result.address)
}
