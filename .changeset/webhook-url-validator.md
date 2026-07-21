---
'@opengovsg/starter-kitty-validators': minor
---

Add a `webhook-url` validator with SSRF protections for webhook destination URLs.
`webhookUrlSchema` / `createWebhookUrlSchema` give sync validation for immediate feedback, rejecting literal private/loopback/link-local/reserved IPs (including obfuscated and IPv4-mapped IPv6 forms), `localhost`, and known cloud metadata hostnames.
`WebhookUrlValidator.validateAsync` additionally resolves the hostname on the server and validates every resolved IP to guard against DNS rebinding, and `WebhookUrlValidator.fetch` performs the outbound request with `redirect: 'error'` so redirects to internal targets can't be followed.
This is the inverse of the existing `UrlValidator`: instead of allowlisting known-safe hosts for redirects within your own app, it blocklists private/internal network targets for user-supplied URLs your server calls out to.
