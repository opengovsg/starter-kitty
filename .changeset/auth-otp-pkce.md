---
'@opengovsg/auth': minor
---

Initial release: safe-by-default OTP login building blocks, extracted from `opengovsg/starter-kit`.

- `createPkceVerifier`, `createPkceChallenge`, `isValidCodeChallenge`: a single isomorphic PKCE (RFC 7636) implementation via Web Crypto, for binding a one-time password to the browser session that requested it.
- `createOtpAuth`: an injected-storage OTP issue/verify orchestrator enforcing atomic attempt limiting, expiry, timing-safe comparison, and one-time use, in the order that closes known timing/brute-force/replay attacks.
- `OtpVerificationError`, `OTP_DEFAULTS`: a single error type with a `code` discriminant and one generic user-facing message across every failure mode.
