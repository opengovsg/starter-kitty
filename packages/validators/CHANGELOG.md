# @opengovsg/starter-kitty-validators

## 1.4.1

### Patch Changes

- [#96](https://github.com/opengovsg/starter-kitty/pull/96) [`a819cd9`](https://github.com/opengovsg/starter-kitty/commit/a819cd9ea6d5dff673ced56ec3e40823f18dfa71) Thanks [@karrui](https://github.com/karrui)! - Fix `webhook-url` breaking browser/edge bundles by moving `WebhookUrlValidator` to `/server/webhook-url`.

  `WebhookUrlValidator` resolves DNS with `node:dns/promises`, which only exists in Node. The package root re-exported it alongside every other validator, so importing the bare package root in a browser or edge bundle failed to resolve `node:dns/promises`.
  `WebhookUrlValidator` now lives under the `@opengovsg/starter-kitty-validators/server/webhook-url` subpath, and only that - import it from server-side code only.
  `webhookUrlSchema` and `WebhookUrlValidationError` are plain sync validation with no Node dependency, so they stay at `@opengovsg/starter-kitty-validators/webhook-url` (and the package root) and remain safe to use on the client.
  `url`, `path`, and `email` are unaffected.

## 1.4.0

### Minor Changes

- [#92](https://github.com/opengovsg/starter-kitty/pull/92) [`bd07d36`](https://github.com/opengovsg/starter-kitty/commit/bd07d36cd1cb5b94f88bc0d38b07a9a8c0effdb0) Thanks [@karrui](https://github.com/karrui)! - Add a `webhook-url` validator with SSRF protections for webhook destination URLs.
  `webhookUrlSchema`, built on zod's `z.httpUrl()`, gives sync validation for immediate feedback: only `http`/`https` URLs with a real domain are accepted, so every literal IP address (public or private, including obfuscated and IPv4-mapped IPv6 forms) is rejected, along with `localhost` and its `*.localhost` subdomains.
  `WebhookUrlValidator.fetch` delivers to the URL, validating it (including resolving and checking every resolved IP, to guard against DNS rebinding) and rejecting redirects with a clear, actionable error, enforced on every call; `validateAsync` is available if you need a different HTTP client.
  This is the inverse of the existing `UrlValidator`: instead of allowlisting known-safe hosts for redirects within your own app, it blocklists private/internal network targets for user-supplied URLs your server calls out to.

## 1.3.0

### Minor Changes

- [#54](https://github.com/opengovsg/starter-kitty/pull/54) [`45af9bc`](https://github.com/opengovsg/starter-kitty/commit/45af9bc97b01c26cedbbc012b0180df9c0092dee) Thanks [@karrui](https://github.com/karrui)! - Add Zod v4 compatibility
