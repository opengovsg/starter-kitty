import { DnsLookupFn } from '@/webhook-url/dns'

export const defaultWebhookProtocols: readonly string[] = ['http', 'https']

/**
 * The options to use for webhook URL validation.
 *
 * @public
 */
export interface WebhookUrlValidatorOptions {
  /**
   * The list of allowed protocols for webhook destination URLs.
   *
   * @defaultValue ['http', 'https']
   */
  protocols?: string[]
  /**
   * Custom DNS lookup function, used to resolve hostnames before validating their IP addresses.
   * Primarily useful for testing. Defaults to Node's `dns.lookup` with `{ all: true }`.
   */
  lookup?: DnsLookupFn
}

export interface ParsedWebhookUrlValidatorOptions {
  protocols: readonly string[]
}

export const parseOptions = (options: WebhookUrlValidatorOptions = {}): ParsedWebhookUrlValidatorOptions => ({
  protocols: options.protocols ?? defaultWebhookProtocols,
})
