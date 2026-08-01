---
"@opengovsg/starter-kitty-rate-limit": minor
---

Add `createBlockingRateLimiter`, a generic failure-counting primitive with `isBlocked`, `consume`, and `reset`, and `createAuthnRateLimiter`, an opinionated client-IP wrapper for failed credential verification. See [ADR 0011](https://github.com/opengovsg/starter-kitty/blob/develop/docs/adr/0011-failed-authentication-rate-limiting.md) for the threat model and usage recipe.
