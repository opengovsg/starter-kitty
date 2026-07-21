import { z } from 'zod/v4'
import { fromError } from 'zod-validation-error'

import { WebhookUrlValidationError } from '@/webhook-url/errors'
import { stripBrackets } from '@/webhook-url/ip-utils'
import { parseOptions, WebhookUrlValidatorOptions } from '@/webhook-url/options'
import { assertResolvedIpsAreSafe as assertHostnameResolvesSafely } from '@/webhook-url/resolved-ips'
import { toSchema } from '@/webhook-url/schema'

/**
 * Create a schema that validates user-supplied webhook destination URLs. Rejects obvious SSRF
 * targets: literal private/loopback/link-local/reserved IPs, `localhost`, and known cloud metadata
 * hostnames. Does not perform DNS resolution - use {@link WebhookUrlValidator.assertResolvedIpsAreSafe}
 * for that.
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
 * This class performs no DNS resolution or other network I/O itself. At webhook save time and
 * again immediately before every delivery:
 * 1. Call {@link WebhookUrlValidator.validate} for the sync checks.
 * 2. Resolve the hostname yourself - e.g. `dns.lookup(url.hostname, { all: true })`, or the custom
 *    `lookup` hook most HTTP clients accept - and pass the resolved addresses to
 *    {@link WebhookUrlValidator.assertResolvedIpsAreSafe}.
 * 3. Make the outbound request with `redirect: 'error'` (or equivalent) so a redirect response is
 *    never followed to an unvalidated target.
 *
 * @public
 */
export class WebhookUrlValidator {
  private schema: z.ZodType<URL, string>

  /**
   * Creates a new WebhookUrlValidator instance.
   *
   * @param options - The options to use for validation
   *
   * @public
   */
  constructor(options: WebhookUrlValidatorOptions = {}) {
    this.schema = createWebhookUrlSchema(options)
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
   * Validates a webhook URL and the IP addresses your own DNS resolution returned for its
   * hostname, to guard against DNS rebinding (a hostname that resolves to a safe IP at save time
   * but an internal IP at delivery time, or that has both safe and unsafe A/AAAA records).
   *
   * @throws {@link WebhookUrlValidationError} if the URL fails the sync checks, or if any resolved
   * address falls within a blocked range.
   *
   * @public
   */
  assertResolvedIpsAreSafe(url: string | URL, resolvedIps: readonly string[]): URL {
    const parsed = this.validate(url)
    assertHostnameResolvesSafely(stripBrackets(parsed.hostname), resolvedIps)
    return parsed
  }
}

export type * from '@/webhook-url/errors'
export type { WebhookUrlValidatorOptions } from '@/webhook-url/options'
