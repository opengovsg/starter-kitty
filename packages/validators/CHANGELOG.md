# @opengovsg/starter-kitty-validators

## 1.4.0

### Minor Changes

- [#92](https://github.com/opengovsg/starter-kitty/pull/92) [`bd07d36`](https://github.com/opengovsg/starter-kitty/commit/bd07d36cd1cb5b94f88bc0d38b07a9a8c0effdb0) Thanks [@karrui](https://github.com/karrui)! - Add a `webhook-url` validator with SSRF protections for webhook destination URLs.
  `webhookUrlSchema`, built on zod's `z.httpUrl()`, gives sync validation for immediate feedback: only `http`/`https` URLs with a real domain are accepted, so every literal IP address (public or private, including obfuscated and IPv4-mapped IPv6 forms) is rejected, along with `localhost` and its `*.localhost` subdomains.
  `WebhookUrlValidator.fetch` delivers to the URL, validating it (including resolving and checking every resolved IP, to guard against DNS rebinding) and rejecting redirects with a clear, actionable error, enforced on every call; `validateAsync` is available if you need a different HTTP client.
  This is the inverse of the existing `UrlValidator`: instead of allowlisting known-safe hosts for redirects within your own app, it blocklists private/internal network targets for user-supplied URLs your server calls out to.

## 1.3.0

### Minor Changes

- [#54](https://github.com/opengovsg/starter-kitty/pull/54) [`45af9bc`](https://github.com/opengovsg/starter-kitty/commit/45af9bc97b01c26cedbbc012b0180df9c0092dee) Thanks [@karrui](https://github.com/karrui)! - Add Zod v4 compatibility
