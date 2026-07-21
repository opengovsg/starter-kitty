import { z } from 'zod/v4'
import { fromError } from 'zod-validation-error'

import { defaultDnsLookup, DnsLookupFn, resolveAndValidateHost } from '@/server/webhook-url/dns'
import { WebhookUrlValidationError } from '@/server/webhook-url/errors'
import { WebhookUrlValidatorOptions } from '@/server/webhook-url/options'

/**
 * Schema for webhook destination URLs, for immediate client/server feedback (e.g. in a form or API
 * input schema) on obvious blocked targets. Requires a real domain - `z.httpUrl()`'s hostname check
 * already rejects every literal IP address (v4, v6, and obfuscated forms like decimal/octal/hex
 * encoding or IPv4-mapped IPv6), so it also rejects `localhost` and single-label hostnames like the
 * bare `metadata` cloud-metadata alias; `*.localhost` subdomains (RFC 6761) are blocked explicitly,
 * since those are still valid-looking domains. Does not perform DNS resolution - use
 * {@link WebhookUrlValidator.fetch} or {@link WebhookUrlValidator.validateAsync} for that.
 *
 * @public
 */
export const webhookUrlSchema = z
  .httpUrl()
  .transform(raw => new URL(raw))
  .refine(url => !url.hostname.toLowerCase().endsWith('.localhost'), {
    message: 'Webhook URL points to a disallowed network target',
  })

/**
 * Validates webhook destination URLs supplied by users, to protect against SSRF.
 *
 * This is the inverse of {@link UrlValidator}: instead of allowlisting known-safe hosts for
 * redirects within your own app, it blocklists private/internal network targets for arbitrary,
 * user-supplied URLs that your server will make outbound requests to.
 *
 * Use {@link WebhookUrlValidator.fetch} to deliver, so validation and redirect rejection are
 * enforced on every call rather than relied on to be wired correctly at every call site.
 *
 * @public
 */
export class WebhookUrlValidator {
  private lookup: DnsLookupFn

  /**
   * Creates a new WebhookUrlValidator instance.
   *
   * @param options - The options to use for validation
   *
   * @public
   */
  constructor(options: WebhookUrlValidatorOptions = {}) {
    this.lookup = options.lookup ?? defaultDnsLookup
  }

  /**
   * Synchronously validates a webhook URL for immediate client/server feedback. Only catches
   * obvious blocked targets (literal IPs, localhost, single-label hostnames) - it does not resolve
   * DNS, so it cannot catch a hostname that resolves to a private address.
   *
   * @throws {@link WebhookUrlValidationError} if the URL is invalid or an obvious blocked target.
   *
   * @public
   */
  validate(url: string | URL): URL {
    const result = webhookUrlSchema.safeParse(url instanceof URL ? url.href : url)
    if (result.success) {
      return result.data
    }
    throw new WebhookUrlValidationError(fromError(result.error).toString())
  }

  /**
   * Fully validates a webhook URL for use at webhook save time and again immediately before every
   * delivery: runs the sync checks, then resolves the hostname and validates every resolved IP
   * address, to guard against DNS rebinding.
   *
   * Prefer {@link WebhookUrlValidator.fetch} when you can. Use this directly only if you need a
   * different HTTP client (e.g. for retries or streaming) - you're then responsible for making sure
   * that client actually rejects redirects rather than silently following them, since clients vary
   * (some, like `ky`, forward a `redirect: 'error'`-style fetch option straight through; others,
   * like `axios`, follow redirects by default and need explicit configuration to stop).
   *
   * @throws {@link WebhookUrlValidationError} if the URL is invalid, an obvious blocked target, or
   * resolves to a blocked network address.
   *
   * @public
   */
  async validateAsync(url: string | URL): Promise<URL> {
    const parsed = this.validate(url)
    await resolveAndValidateHost(parsed.hostname, this.lookup)
    return parsed
  }

  /**
   * Validates the URL (sync checks, then DNS resolution and resolved-IP checks) and delivers to it,
   * rejecting any redirect response instead of following it. This is the recommended way to
   * deliver to a webhook URL: one call enforces every protection unconditionally, rather than
   * relying on every call site to re-validate and to remember `redirect: 'error'` on its own fetch.
   *
   * Resolution and delivery happen back-to-back, immediately after each other; this does not pin
   * the connection to the exact resolved IP, so it does not close every theoretical DNS-rebinding
   * window down to zero. That level of guarantee needs connection-level pinning (e.g. a custom
   * dispatcher), which is out of scope for a validator - reach for a dedicated egress proxy if your
   * threat model requires it.
   *
   * @throws {@link WebhookUrlValidationError} if the URL fails validation, or if the destination
   * responds with a redirect.
   *
   * @public
   */
  async fetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
    const parsed = await this.validateAsync(url)
    try {
      return await fetch(parsed, { ...init, redirect: 'error' })
    } catch (error) {
      if (error instanceof TypeError && error.cause instanceof Error && /redirect/i.test(error.cause.message)) {
        throw new WebhookUrlValidationError(
          `Webhook request to "${parsed.href}" was redirected - provide the final destination URL directly instead of one that redirects.`,
        )
      }
      throw error
    }
  }
}

export type * from '@/server/webhook-url/errors'
export type { WebhookUrlValidatorOptions } from '@/server/webhook-url/options'
