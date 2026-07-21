# `@opengovsg/starter-kitty-validators`

A set of [zod](https://zod.dev/)-based validators providing sensible defaults to prevent common security vulnerabilities: path traversal, open redirects, XSS, and SSRF.
Each validator is its own subpath export, so you only pull in what you use.

## Install

```sh
pnpm add @opengovsg/starter-kitty-validators zod
```

`zod` (`^3.25.0 || ^4.0.0`) is a peer dependency - you supply the version your app already uses.

## Path validation

```ts
import { createPathSchema } from '@opengovsg/starter-kitty-validators/path'

const pathSchema = createPathSchema({ basePath: '/app/content' })

const contentSubmissionSchema = z.object({
  fullPermalink: pathSchema,
  title: z.string(),
})
```

`fullPermalink`, when resolved relative to the working directory of the Node process, must lie within `/app/content`.

## Email validation

```ts
import { createEmailSchema } from '@opengovsg/starter-kitty-validators/email'

const emailSchema = createEmailSchema({ domains: [{ domain: 'gov.sg', includeSubdomains: true }] })

const formSchema = z.object({
  name: z.string(),
  email: emailSchema,
})
```

`email` must be a valid email address whose domain is `gov.sg` or a subdomain of it.

## URL validation

`UrlValidator` **allowlists** known-safe hosts, for validating redirect targets and other URLs your own app navigates to:

```ts
import { UrlValidator } from '@opengovsg/starter-kitty-validators/url'

const validator = new UrlValidator({
  whitelist: {
    protocols: ['http', 'https', 'mailto'],
    hosts: ['open.gov.sg'],
  },
})

validator.parse(userSuppliedRedirectUrl)
```

`RelUrlValidator` is a convenience subclass for the common case of validating a relative post-login redirect against the current origin:

```ts
import { RelUrlValidator } from '@opengovsg/starter-kitty-validators/url'

const validator = new RelUrlValidator(window.location.origin)
window.location.pathname = validator.parsePathname(redirectUrl, '/home') // falls back to /home if invalid
```

`createUrlSchema` returns a plain zod schema for composing into a larger schema instead of using the class API.

## Webhook URL validation

`WebhookUrlValidator` is the **inverse** of `UrlValidator`: instead of allowlisting known-safe hosts for redirects within your own app, it **blocklists** private/internal network targets for arbitrary, user-supplied URLs that your server will make outbound requests to - the shape of the problem when a user registers a webhook destination. There are two places to use it: when the URL is first saved, and every time you actually send to it.

### 1. Validating the URL when it's saved as config

Use `webhookUrlSchema` (or `createWebhookUrlSchema` if you need to restrict protocols) wherever a webhook URL is taken as input, so a request to save an obviously unsafe URL is rejected before it ever reaches storage:

```ts
import { webhookUrlSchema } from '@opengovsg/starter-kitty-validators/webhook-url'

const saveWebhookConfigSchema = z.object({
  url: webhookUrlSchema,
  events: z.array(z.string()),
})

export const saveWebhookConfig = async (input: unknown) => {
  const { url, events } = saveWebhookConfigSchema.parse(input) // throws ZodError if url is an obvious blocked target
  await db.webhookConfig.upsert({ url: url.href, events })
}
```

This rejects non-`http(s)` protocols, `localhost` (and `*.localhost`), known cloud metadata hostnames, and literal private/loopback/link-local/reserved IP addresses - including obfuscated forms (decimal/octal/hex-encoded IPv4, IPv4-mapped IPv6). It cannot catch a hostname that merely _resolves_ to a private address, since it does no DNS resolution - that's what step 2 is for, which is why saving alone is not the full protection.

Not using zod for this input? `new WebhookUrlValidator().validate(rawUrl)` does the same check directly, returning a `URL` or throwing `WebhookUrlValidationError`.

### 2. Sending a webhook

Use `WebhookUrlValidator.fetch` to actually deliver, every time an event fires - not just once at registration. It re-runs the sync checks, resolves the hostname, validates every resolved IP (catching DNS rebinding: a hostname that resolved to a safe address when saved but an internal one now, or that has a mix of safe and unsafe A/AAAA records), and only then makes the request, rejecting redirects instead of following them:

```ts
import { WebhookUrlValidator, WebhookUrlValidationError } from '@opengovsg/starter-kitty-validators/webhook-url'

const webhookValidator = new WebhookUrlValidator()

export const sendWebhook = async (config: { url: string; events: string[] }, payload: unknown) => {
  try {
    const response = await webhookValidator.fetch(config.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      // the destination is reachable but rejected the request - your usual retry/backoff logic applies
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'WebhookUrlValidationError') {
      // the stored URL is no longer safe to deliver to (e.g. DNS now resolves to a private address) -
      // don't retry; flag or disable the webhook config instead
    }
    throw error
  }
}
```

There's no separate "validate at save time" step to remember here: `fetch` always validates first, so step 1 exists purely for fast feedback on obviously bad input - `fetch` is what actually enforces the protection, on every delivery.

Catch `WebhookUrlValidationError` by checking `error.name === 'WebhookUrlValidationError'` rather than `instanceof` - the class is exported as a type only (matching `UrlValidationError` above), so `instanceof` doesn't work when importing from the public entry point.

If you need a different HTTP client than `fetch` (e.g. for retries or streaming), use `WebhookUrlValidator.validateAsync(url)` to get the same validation and wire up redirect rejection yourself - but prefer `fetch` by default, since it can't be used without also getting the redirect protection.

## API reference

The full generated API reference is published to the [starter-kitty docsite](https://opengovsg.github.io/starter-kitty/api/).
