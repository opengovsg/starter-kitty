import { z } from 'zod/v4'
import { fromError } from 'zod-validation-error'

import { defaultDnsLookup, DnsLookupFn, resolveAndValidateHost } from '@/webhook-url/dns'
import { WebhookUrlValidationError } from '@/webhook-url/errors'
import { stripBrackets } from '@/webhook-url/ip-utils'
import { parseOptions, WebhookUrlValidatorOptions } from '@/webhook-url/options'
import { toSchema } from '@/webhook-url/schema'

/**
 * Create a schema that validates user-supplied webhook destination URLs. Rejects obvious SSRF
 * targets: literal private/loopback/link-local/reserved IPs, `localhost`, and known cloud metadata
 * hostnames. Does not perform DNS resolution - use {@link WebhookUrlValidator.validateAsync} for
 * that.
 *
 * @param options - The options to use for validation
 * @returns A Zod schema that validates webhook URLs.
 *
 * @public
 */
export const createWebhookUrlSchema = (options: WebhookUrlValidatorOptions = {}): z.ZodType<URL, string> =>
  toSchema(parseOptions(options))

/**
 * Ready-to-use schema for webhook destination URLs with default options, for immediate
 * client/server feedback (e.g. in a form or API input schema) on obvious blocked targets.
 *
 * @public
 */
export const webhookUrlSchema = createWebhookUrlSchema()

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
  private schema: z.ZodType<URL, string>
  private lookup: DnsLookupFn

  /**
   * Creates a new WebhookUrlValidator instance.
   *
   * @param options - The options to use for validation
   *
   * @public
   */
  constructor(options: WebhookUrlValidatorOptions = {}) {
    this.schema = createWebhookUrlSchema(options)
    this.lookup = options.lookup ?? defaultDnsLookup
  }

  /**
   * Synchronously validates a webhook URL for immediate client/server feedback. Only catches
   * obvious blocked targets (literal IPs, localhost, metadata hostnames) - it does not resolve
   * DNS, so it cannot catch a hostname that resolves to a private address.
   *
   * @throws {@link WebhookUrlValidationError} if the URL is invalid or an obvious blocked target.
   *
   * @public
   */
  validate(url: string | URL): URL {
    const result = this.schema.safeParse(url instanceof URL ? url.href : url)
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
   * @throws {@link WebhookUrlValidationError} if the URL is invalid, an obvious blocked target, or
   * resolves to a blocked network address.
   *
   * @public
   */
  async validateAsync(url: string | URL): Promise<URL> {
    const parsed = this.validate(url)
    await resolveAndValidateHost(stripBrackets(parsed.hostname), this.lookup)
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
   * @throws {@link WebhookUrlValidationError} if the URL fails validation.
   *
   * @public
   */
  async fetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
    const parsed = await this.validateAsync(url)
    return fetch(parsed, { ...init, redirect: 'error' })
  }
}

export type * from '@/webhook-url/errors'
export type { WebhookUrlValidatorOptions } from '@/webhook-url/options'
