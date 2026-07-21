# @opengovsg/starter-kitty-validators

## Installation

```bash
npm i --save @opengovsg/starter-kitty-validators
```

## Path Validation

```javascript
import { createPathSchema } from '@opengovsg/starter-kitty-validators/path'

const pathSchema = createPathSchema({
  basePath: '/app/content',
})

const contentSubmissionSchema = z.object({
  fullPermalink: pathSchema,
  title: z.string(),
  content: z.string(),
})

type ContentSubmission = z.infer<typeof contentSubmissionSchema>
```

`fullPermalink`, when resolved relative to the working directory of the Node process, must lie within `/app/content`.

## Email Validation

```javascript
import { createEmailSchema } from '@opengovsg/starter-kitty-validators/email'

const emailSchema = createEmailSchema({
  domains: [{ domain: 'gov.sg', includeSubdomains: true }],
})

const formSchema = z.object({
  name: z.string(),
  email: emailSchema,
})

type FormValues = z.infer<typeof formSchema>
```

`email` must be a valid email address and have a domain that is `gov.sg` or a subdomain of `gov.sg`.

## URL Validation

Validating a post-login redirect URL provided in a query parameter:

```javascript
import { UrlValidator } from '@opengovsg/starter-kitty-validators/url'

const validator = new RelUrlValidator(window.location.origin)
```

```javascript
const fallbackUrl = '/home'
window.location.pathname = validator.parsePathname(redirectUrl, fallbackUrl)

// alternatively
router.push(validator.parsePathname(redirectUrl, fallbackUrl))
```

For more control you can create the UrlValidator instance yourself and invoke .parse

```javascript
import { UrlValidator } from '@opengovsg/starter-kitty-validators/url'

const validator = new UrlValidator({
  whitelist: {
    protocols: ['http', 'https', 'mailto'],
    hosts: ['open.gov.sg'],
  },
})

...

validator.parse(userInput)
```

Using the validator as part of a Zod schema to validate the URL and fall back to a default URL if the URL is invalid:

```javascript
import { createUrlSchema } from '@opengovsg/starter-kitty-validators/url'

const baseUrl = new URL(getBaseUrl())

export const callbackUrlSchema = z
  .string()
  .optional()
  .default(HOME)
  .pipe(
    createUrlSchema({
      baseOrigin: baseUrl.origin,
      whitelist: {
        protocols: ['http', 'https'],
        hosts: [baseUrl.host],
      },
    }),
  )
  .catch(new URL(HOME, baseUrl.origin))
```

## Webhook URL Validation

`WebhookUrlValidator` is the inverse of `UrlValidator`: it blocklists private/internal network targets (RFC 1918, loopback, link-local/metadata, and related reserved ranges) for user-supplied webhook destination URLs, instead of allowlisting known-safe hosts. There are two places to use it: when the URL is first saved, and every time you actually send to it.

Validating the URL when it's saved as config, so an obviously unsafe URL never reaches storage:

```javascript
import { webhookUrlSchema } from '@opengovsg/starter-kitty-validators/server/webhook-url'

const saveWebhookConfigSchema = z.object({
  url: webhookUrlSchema,
  events: z.array(z.string()),
})

export const saveWebhookConfig = async input => {
  const { url, events } = saveWebhookConfigSchema.parse(input) // throws ZodError if url is an obvious blocked target
  await db.webhookConfig.upsert({ url: url.href, events })
}
```

Built on zod's `z.httpUrl()`, this only accepts `http`/`https` URLs with a real domain name as the host - no literal IP address survives this check, public or private, including obfuscated forms (decimal/octal/hex-encoded IPv4, IPv4-mapped IPv6). `localhost` and its `*.localhost` subdomains are rejected explicitly. It cannot catch a hostname that merely _resolves_ to a private address (e.g. `metadata.google.internal`, a valid domain that resolves to the `169.254.169.254` cloud metadata address) - that's what sending is for, which is why saving alone is not the full protection.

Sending a webhook, every time an event fires - not just once at registration:

```javascript
import { WebhookUrlValidator } from '@opengovsg/starter-kitty-validators/server/webhook-url'

const webhookValidator = new WebhookUrlValidator()

export const sendWebhook = async (config, payload) => {
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
      // the stored URL is no longer safe to deliver to, or the destination responded with a
      // redirect - either way, don't retry; flag or disable the webhook config instead
    }
    throw error
  }
}
```

`fetch` re-runs the sync checks, resolves the hostname, validates every resolved IP (catching DNS rebinding), and only then makes the request, rejecting redirects outright instead of following them - all enforced unconditionally on every call, so there's nothing to remember at each call site. Catch `WebhookUrlValidationError` via `error.name`, not `instanceof` - it's exported as a type only, matching `UrlValidationError` above.

Need a different HTTP client (retries, streaming, an existing wrapper)? Use `validateAsync` to get the same validation, then make the request yourself - you're then responsible for confirming your client actually rejects redirects rather than silently following them:

```javascript
import ky from 'ky'

const validatedUrl = await webhookValidator.validateAsync(config.url)
const response = await ky.post(validatedUrl, { json: payload, redirect: 'error' })
```

See the [package README](https://github.com/opengovsg/starter-kitty/tree/develop/packages/validators#webhook-url-validation) for further detail.
