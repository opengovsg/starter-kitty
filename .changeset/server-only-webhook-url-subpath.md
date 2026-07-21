---
'@opengovsg/starter-kitty-validators': patch
---

Fix `webhook-url` breaking browser/edge bundles and move it to `/server/webhook-url`.

`webhookUrlSchema` and `WebhookUrlValidator` resolve DNS with `node:dns/promises`, which only exists in Node. The package root re-exported them alongside every other validator, so importing the bare package root in a browser or edge bundle failed to resolve `node:dns/promises`.
The root no longer re-exports it, and the subpath moves from `/webhook-url` to `/server/webhook-url` to make the server-only requirement explicit. Import from `@opengovsg/starter-kitty-validators/server/webhook-url`, and only from server-side code.
`url`, `path`, and `email` are unaffected - they remain available from both their existing subpaths and the package root.
