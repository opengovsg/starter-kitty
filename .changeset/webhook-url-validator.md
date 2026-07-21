---
'@opengovsg/starter-kitty-validators': minor
---

Add a `webhook-url` validator with SSRF protections for webhook destination URLs.
`webhookUrlSchema` / `createWebhookUrlSchema` give sync validation for immediate feedback, rejecting literal private/loopback/link-local/reserved IPs (including obfuscated and IPv4-mapped IPv6 forms), `localhost`, and known cloud metadata hostnames.
`WebhookUrlValidator.fetch` delivers to the URL, validating it (including resolving and checking every resolved IP, to guard against DNS rebinding) and rejecting redirects, enforced on every call; `validateAsync` is available if you need a different HTTP client.
This is the inverse of the existing `UrlValidator`: instead of allowlisting known-safe hosts for redirects within your own app, it blocklists private/internal network targets for user-supplied URLs your server calls out to.
