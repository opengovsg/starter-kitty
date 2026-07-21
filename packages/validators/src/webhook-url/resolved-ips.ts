import { WebhookUrlValidationError } from '@/webhook-url/errors'
import { isBlockedIp } from '@/webhook-url/ip-utils'

/**
 * Validates a set of already-resolved IP addresses for a webhook hostname against the blocked
 * private/reserved ranges, to prevent DNS rebinding (a hostname that resolves to a safe IP at save
 * time but an internal IP at delivery time, or that has both safe and unsafe A/AAAA records).
 *
 * This package performs no DNS resolution or other network I/O itself - resolve the hostname
 * yourself (e.g. via `dns.lookup(hostname, { all: true })`, or the custom `lookup` hook most HTTP
 * clients accept) and pass the resulting addresses in here before connecting.
 *
 * @throws {@link WebhookUrlValidationError} if no addresses are given, or if any resolved address
 * falls within a blocked range.
 */
export const assertResolvedIpsAreSafe = (hostname: string, resolvedIps: readonly string[]): void => {
  if (!resolvedIps.length) {
    throw new WebhookUrlValidationError(`No resolved IP addresses provided for webhook host: ${hostname}`)
  }

  const blocked = resolvedIps.find(isBlockedIp)
  if (blocked) {
    throw new WebhookUrlValidationError(`Webhook host "${hostname}" resolves to a blocked network address (${blocked})`)
  }
}
