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

Use `webhookUrlSchema` wherever a webhook URL is taken as input, so a request to save an obviously unsafe URL is rejected before it ever reaches storage:

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

Built on zod's `z.httpUrl()`, this only accepts `http`/`https` URLs with a real domain name as the host - **no literal IP address survives this check, public or private**, since `z.httpUrl()`'s hostname format already excludes every form of IP literal (v4, v6, and obfuscated encodings like decimal/octal/hex or IPv4-mapped IPv6). `localhost` and its `*.localhost` subdomains (RFC 6761) are rejected explicitly, since those are still valid-looking domains that the format check alone wouldn't catch.

It cannot catch a hostname that merely _resolves_ to a private address (e.g. `metadata.google.internal`, which is a syntactically valid domain but resolves to the `169.254.169.254` cloud metadata address) - that's what step 2 is for, which is why saving alone is not the full protection.

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
      // the stored URL is no longer safe to deliver to (e.g. DNS now resolves to a private address),
      // or the destination responded with a redirect - either way, don't retry; flag or disable the
      // webhook config, or ask the user for the final destination URL instead of one that redirects
    }
    throw error
  }
}
```

There's no separate "validate at save time" step to remember here: `fetch` always validates first, so step 1 exists purely for fast feedback on obviously bad input - `fetch` is what actually enforces the protection, on every delivery. Redirects aren't followed at all - `fetch` rejects them outright with a `WebhookUrlValidationError` telling you to provide the final destination URL, rather than a webhook config silently pointing somewhere it was never validated to reach.

Catch `WebhookUrlValidationError` by checking `error.name === 'WebhookUrlValidationError'` rather than `instanceof` - the class is exported as a type only (matching `UrlValidationError` above), so `instanceof` doesn't work when importing from the public entry point.

### Using a different HTTP client

Prefer `WebhookUrlValidator.fetch` by default - it's the only path that can't be used without also getting the redirect protection. If you need a different client (retries, streaming, an existing wrapper with its own interceptors), use `validateAsync` to get the same validation, then make the request yourself:

```ts
import ky from 'ky'

const validatedUrl = await webhookValidator.validateAsync(config.url)
const response = await ky.post(validatedUrl, { json: payload, redirect: 'error' })
```

You're now responsible for making sure your client actually **rejects** redirects rather than silently following them - clients differ here. `ky` is fetch-based and forwards `redirect: 'error'` straight through, same as the example above. `axios`, by contrast, follows redirects by default and needs explicit configuration (e.g. `maxRedirects: 0`) to stop - check your client's behavior rather than assuming it matches `fetch`'s.

## API reference

The full generated API reference is published to the [starter-kitty docsite](https://opengovsg.github.io/starter-kitty/api/).
