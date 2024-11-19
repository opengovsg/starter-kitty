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
