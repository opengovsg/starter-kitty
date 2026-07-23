import { z } from 'zod/v4'

/**
 * Schema for webhook destination URLs, for immediate client/server feedback (e.g. in a form or API
 * input schema) on obvious blocked targets. Requires a real domain - `z.httpUrl()`'s hostname check
 * already rejects every literal IP address (v4, v6, and obfuscated forms like decimal/octal/hex
 * encoding or IPv4-mapped IPv6), so it also rejects `localhost` and single-label hostnames like the
 * bare `metadata` cloud-metadata alias; `*.localhost` subdomains (RFC 6761) are blocked explicitly,
 * since those are still valid-looking domains. Does not perform DNS resolution - use
 * `WebhookUrlValidator.fetch` or `WebhookUrlValidator.validateAsync` (from the
 * `@opengovsg/validators/server/webhook-url` subpath) for that.
 *
 * @public
 */
export const webhookUrlSchema = z
  .httpUrl()
  .transform(raw => new URL(raw))
  .refine(url => !url.hostname.toLowerCase().endsWith('.localhost'), {
    message: 'Webhook URL points to a disallowed network target',
  })
