# Validators

This package provides a set of validators that provide sensible defaults to prevent common security vulnerabilities.

## Installation

```bash
npm i --save @opengovsg/starter-kitty-validators
```

### Example

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

## Class: `UrlValidator`

Validates URLs against a whitelist of allowed protocols and hostnames, preventing open redirects, XSS, SSRF, and other security vulnerabilities.

### new UrlValidator(options)

`options?`: `<Object>`

- `baseOrigin?`: `<string>` - The base origin to use for relative URLs. If no base origin is provided, relative URLs will be considered invalid.

  An origin does not include the path or query parameters. For example, a valid base origin is `https://example.com` or `http://localhost:3000`.
  
- `whitelist?`: `<Object>`
  - `protocols`: `<string[]>` - A list of allowed protocols.
  
    **Caution: allowing `javascript` or `data` protocols can lead to XSS vulnerabilities.**
  - `hostnames`: `<string[]>` - A list of allowed hostnames. If no hostnames are provided, the validator will allow any hostname.
  
    **It is recommended to provide a list of allowed hostnames to prevent open redirects.**

If no options are provided, the validator will use the default options:

```javascript
{
  whitelist: {
    protocols: ['http', 'https'],
  },
}
```

### UrlValidator.parse(url)

- `url`: `<string>` - The URL to parse.
- Returns: `<URL>` - The parsed URL object.
- Throws: `<UrlValidationError>` - If the URL is invalid or unsafe.
