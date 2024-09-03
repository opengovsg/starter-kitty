# @opengovsg/starter-kitty-validators

## Installation

```bash
npm i --save @opengovsg/starter-kitty-validators
```

## Path Validation

```javascript
import { createPathSchema } from '@opengovsg/starter-kitty-validators'

const pathSchema = createPathSchema({
  basePath: '/app/content',
})

const contentSubmissionSchema = z.object({
  fullPermalink: pathSchema,
  title: z.string(),
  content: z.string(),
})

type ContentSubmission = z.infer<typeof contentSchema>
```

## Email Validation

```javascript
import { createEmailSchema } from '@opengovsg/starter-kitty-validators'

const emailSchema = createEmailSchema({
  domains: [{ domain: 'gov.sg', includeSubdomains: true }],
})

const formSchema = z.object({
  name: z.string(),
  email: emailSchema,
})

type FormValues = z.infer<typeof formSchema>
```

## URL Validation

```javascript
import { UrlValidator } from '@opengovsg/starter-kitty-validators'

const validator = new UrlValidator({
  whitelist: {
    protocols: ['http', 'https', 'mailto'],
    hosts: ['open.gov.sg'],
  },
})
```

Validating a post-login redirect URL provided in a query parameter:

```javascript
try {
  router.push(validator.parse(redirectUrl))
} catch (error) {
  router.push('/home')
}
```

Consider using the validator as part of a Zod schema to validate the URL and fall back to a default URL if the URL is invalid.

```javascript
const baseUrl = getBaseUrl()

const validator = new UrlValidator({
  baseOrigin: new URL(baseUrl).origin,
  whitelist: {
    protocols: ['http', 'https'],
    hosts: [new URL(baseUrl).host],
  },
})

export const callbackUrlSchema = z
  .string()
  .optional()
  .default(HOME)
  .transform((url, ctx) => {
    try {
      return validator.parse(url)
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: (error as Error).message,
      })
      return z.NEVER
    }
  })
  .catch(new URL(HOME, baseUrl))
```
