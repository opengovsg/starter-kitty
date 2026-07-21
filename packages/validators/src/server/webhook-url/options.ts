import { DnsLookupFn } from '@/server/webhook-url/dns'

/**
 * The options to use for webhook URL validation.
 *
 * @public
 */
export interface WebhookUrlValidatorOptions {
  /**
   * Custom DNS lookup function, used to resolve hostnames before validating their IP addresses.
   * Primarily useful for testing. Defaults to Node's `dns.lookup` with `{ all: true }`.
   */
  lookup?: DnsLookupFn
}
