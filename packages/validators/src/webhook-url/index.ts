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
 * DNS resolution (read-only, no data ever leaves your server) happens inside this class so that
 * checking resolved IPs against the blocklist is a single call. Making the actual outbound webhook
 * request - the part that sends your data to a third party - stays your app's responsibility:
 * do it with `redirect: 'error'` so a redirect response is never followed to an unvalidated target.
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
}

export type * from '@/webhook-url/errors'
export type { WebhookUrlValidatorOptions } from '@/webhook-url/options'
