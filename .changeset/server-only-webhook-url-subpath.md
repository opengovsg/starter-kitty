---
'@opengovsg/starter-kitty-validators': patch
---

Fix `webhook-url` breaking browser/edge bundles by moving `WebhookUrlValidator` to `/server/webhook-url`.

`WebhookUrlValidator` resolves DNS with `node:dns/promises`, which only exists in Node. The package root re-exported it alongside every other validator, so importing the bare package root in a browser or edge bundle failed to resolve `node:dns/promises`.
`WebhookUrlValidator` now lives under the `@opengovsg/starter-kitty-validators/server/webhook-url` subpath, and only that - import it from server-side code only.
`webhookUrlSchema` and `WebhookUrlValidationError` are plain sync validation with no Node dependency, so they stay at `@opengovsg/starter-kitty-validators/webhook-url` (and the package root) and remain safe to use on the client.
`url`, `path`, and `email` are unaffected.
