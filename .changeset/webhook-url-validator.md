---
'@opengovsg/starter-kitty-validators': minor
---

Add a `webhook-url` validator with SSRF protections for webhook destination URLs.
`webhookUrlSchema`, built on zod's `z.httpUrl()`, gives sync validation for immediate feedback: only `http`/`https` URLs with a real domain are accepted, so every literal IP address (public or private, including obfuscated and IPv4-mapped IPv6 forms) is rejected, along with `localhost` and its `*.localhost` subdomains.
`WebhookUrlValidator.fetch` delivers to the URL, validating it (including resolving and checking every resolved IP, to guard against DNS rebinding) and rejecting redirects with a clear, actionable error, enforced on every call; `validateAsync` is available if you need a different HTTP client.
This is the inverse of the existing `UrlValidator`: instead of allowlisting known-safe hosts for redirects within your own app, it blocklists private/internal network targets for user-supplied URLs your server calls out to.
