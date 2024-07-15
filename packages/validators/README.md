# Validators

This package provides a set of validators that provide sensible defaults to prevent common security vulnerabilities.

## Class: `UrlValidator`

Validates URLs against a whitelist of allowed protocols and hostnames, preventing open redirects, XSS, SSRF, and other security vulnerabilities.

### new UrlValidator(options)

`options?`: `<Object>`

- `baseUrl`: `<string>` - The base URL to use for relative URLs. If no base URL is provided, relative URLs will be considered invalid.
- `whitelist`: `<Object>`
  - `protocols`: `<string[]>` - A list of allowed protocols. If no protocols are provided, the validator will use the default protocols: `['http', 'https']`. **Caution: allowing `javascript` or `data` protocols can lead to XSS vulnerabilities.**
  - `hostnames`: `<string[]>` - A list of allowed hostnames. If no hostnames are provided, the validator will allow any hostname. **It is recommended to provide a list of allowed hostnames to prevent open redirects.**

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

### Example
  
```javascript
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
