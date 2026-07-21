---
'@opengovsg/starter-kitty-validators': minor
---

Add a `webhook-url` validator with SSRF protections for webhook destination URLs.
`webhookUrlSchema` / `createWebhookUrlSchema` give sync validation for immediate feedback, rejecting literal private/loopback/link-local/reserved IPs (including obfuscated and IPv4-mapped IPv6 forms), `localhost`, and known cloud metadata hostnames.
`WebhookUrlValidator.assertResolvedIpsAreSafe` validates the IP addresses your own DNS resolution returned for a hostname, to guard against DNS rebinding - this package performs no DNS resolution or other network I/O itself.
This is the inverse of the existing `UrlValidator`: instead of allowlisting known-safe hosts for redirects within your own app, it blocklists private/internal network targets for user-supplied URLs your server calls out to.
