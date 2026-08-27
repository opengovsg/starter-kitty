---
'@opengovsg/auth': minor
---

Initial release: safe-by-default OTP login building blocks, extracted from `opengovsg/starter-kit`.

- `createPkceVerifier`, `createPkceChallenge`, `isValidCodeChallenge`: a single isomorphic PKCE (RFC 7636) implementation via Web Crypto, for binding a one-time password to the browser session that requested it.
- `createOtpAuth`: an injected-storage OTP issue/verify orchestrator enforcing atomic attempt limiting, expiry, timing-safe comparison, and one-time use, in the order that closes known timing/brute-force/replay attacks. `issueOtp`/`verifyOtp` never throw; both resolve to an `OtpResult`, in the shape of Zod's `safeParse`. Options are range-checked at construction, throwing `OtpOptionsError` rather than being silently clamped.
- `OtpResult`, `OtpVerificationError`, `OtpOptionsError`, `OTP_DEFAULTS`: a single error type with a `code` discriminant, plus `attemptCount` and `cause` for logging. The verify-path codes share one generic user-facing message, while the issue-path codes (`challenge_invalid`, `challenge_conflict`) are safe to disambiguate.
- `OtpVerificationStore`: the three-method storage port you implement (Prisma and Kysely recipes in the README). `issueOtp` self-heals an expired leftover record on conflict, so a stale row cannot permanently block re-issue.
