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

`WebhookUrlValidator` is the **inverse** of `UrlValidator`: instead of allowlisting known-safe hosts for redirects within your own app, it **blocklists** private/internal network targets for arbitrary, user-supplied URLs that your server will make outbound requests to - the shape of the problem when a user registers a webhook destination.

### 1. Sync validation, for immediate feedback

Use `webhookUrlSchema` (or `createWebhookUrlSchema` if you need to restrict protocols) wherever you take a webhook URL as input - a settings form, an API body - to reject obviously unsafe input before it is even saved:

```ts
import { webhookUrlSchema } from '@opengovsg/starter-kitty-validators/webhook-url'

const createWebhookSchema = z.object({
  url: webhookUrlSchema,
  events: z.array(z.string()),
})
```

This rejects non-`http(s)` protocols, `localhost` (and `*.localhost`), known cloud metadata hostnames, and literal private/loopback/link-local/reserved IP addresses - including obfuscated forms (decimal/octal/hex-encoded IPv4, IPv4-mapped IPv6). It cannot catch a hostname that merely _resolves_ to a private address, since it does no DNS resolution.

### 2. Deliver with `WebhookUrlValidator.fetch`

A hostname can resolve to a safe address when you save the webhook and an internal address when you deliver to it later (DNS rebinding), or resolve to a mix of safe and unsafe addresses across its A/AAAA records. `fetch` re-runs the sync checks, resolves the hostname, validates every resolved IP, and only then makes the request - rejecting redirects instead of following them, since a redirect could point at an internal target that was never validated:

```ts
import { WebhookUrlValidator, WebhookUrlValidationError } from '@opengovsg/starter-kitty-validators/webhook-url'

const webhookValidator = new WebhookUrlValidator()

const response = await webhookValidator.fetch(storedWebhookUrl, {
  method: 'POST',
  body: JSON.stringify(payload),
}) // throws WebhookUrlValidationError before ever connecting, if unsafe
```

Call this at delivery time - every time an event fires, not just once at registration - so a hostname whose DNS record changes after being saved is still caught. There's no separate "validate at save time" step to remember: calling `fetch` always validates first, so registering a webhook can simply be a call to `webhookValidator.validate(url)` (the sync check, for fast feedback) followed by storing the URL - `fetch` is what enforces the rest, every time it's used.

Catch `WebhookUrlValidationError` to surface a clean error; `error.name === 'WebhookUrlValidationError'` identifies it (the class is exported as a type only, matching `UrlValidationError` above, so use `.name` rather than `instanceof` when importing from the public entry point).

If you need a different HTTP client than `fetch` (e.g. for retries or streaming), use `WebhookUrlValidator.validateAsync(url)` to get the same validation and wire up redirect rejection yourself - but prefer `fetch` by default, since it can't be used without also getting the redirect protection.

## API reference

The full generated API reference is published to the [starter-kitty docsite](https://opengovsg.github.io/starter-kitty/api/).
