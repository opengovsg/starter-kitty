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
 * hostnames. Does not perform DNS resolution - use {@link WebhookUrlValidator} for that.
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
 * Validates webhook destination URLs supplied by users and delivers to them safely.
 *
 * This is the inverse of {@link UrlValidator}: instead of allowlisting known-safe hosts for
 * redirects within your own app, it blocklists private/internal network targets for arbitrary,
 * user-supplied URLs that your server will make outbound requests to - guarding against SSRF.
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
   * Fully validates a webhook URL for use at webhook save and delivery time: runs the sync checks,
   * then resolves the hostname on the server and validates every resolved IP address, to guard
   * against DNS rebinding.
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
   * Validates the URL (including DNS-rebinding checks) and performs the outbound webhook delivery,
   * rejecting any redirect response instead of following it.
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
