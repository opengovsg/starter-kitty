# 11. Auth package design

Date: 2026-08-11
Status: Accepted

## Context

Apps built from [`opengovsg/starter-kit`](https://github.com/opengovsg/starter-kit)
hand-roll an OTP login flow: OTP generation and hashing
(`auth.utils.ts`), a PKCE-style verifier/challenge pair binding the OTP to
the requesting browser session (`lib/pkce/`), and a five-step verify sequence
(`auth.service.ts`) whose ordering — atomic attempt increment before
validation, expiry check, attempt cap, timing-safe compare, delete-as-claim —
is exactly where a naive reimplementation reopens a known attack. This ADR
records the design of `@opengovsg/auth`, which extracts that flow.

Note this is **not an OAuth/OIDC package**. starter-kit's own PKCE files carry
the comment "do not use this for actual OAuth flows" — there is no `state`,
`nonce`, or authorization-code exchange here. PKCE (RFC 7636) is reused only
as a session-binding mechanism: the browser mints a verifier, sends only its
challenge with the login request, and the challenge becomes the OTP record's
primary key and hash salt.

## Decision

### Orchestration, not bare primitives

`createOtpAuth` ships the full `issueOtp`/`verifyOtp` sequence behind an
injected `VerificationTokenStore`, rather than exporting only
`hashToken`/`isValidToken`-style primitives. The vulnerabilities in this flow
live in the *ordering* of the verify steps, not in any single primitive — a
caller who gets that ordering wrong is exposed even with correct primitives.
Since the storage port has real independent implementations across OGP apps
(Prisma, Kysely, Drizzle), this is not a single-implementation interface
manufactured for its own sake.

### One isomorphic PKCE implementation via Web Crypto

starter-kit carries two independent PKCE challenge implementations — Node
`createHash('sha256')` server-side, manual `btoa` + regex replacement
client-side — with nothing asserting they agree. `createPkceChallenge` uses
`globalThis.crypto.subtle.digest('SHA-256', ...)` instead: one implementation
for both environments, so divergence is impossible by construction rather
than something to keep testing for. Web Crypto has been available unflagged
on `globalThis` since Node.js 19; this repo's `engines.node` floor of
`>=20.19.0` is comfortably past that. A defensive `node:crypto` import
fallback was considered and rejected — under Next.js Edge, a Node builtin
import (static or dynamic) is replaced with a proxy that throws on property
access, which is worse than the bare call it's meant to guard.

### Split entry points, isomorphic root

- `.` / `./pkce` / `./otp` — safe to bundle into a browser: PKCE
  verifier/challenge functions, OTP constants, and the `OtpVerificationError`
  type.
- `./server/otp` — the `createOtpAuth` factory, scrypt hashing, and
  `timingSafeEqual` comparison. Node-only (`node:crypto`), and reported
  through a second `api-extractor.server.json` config
  (`etc/auth-server.api.md`) so this, the most sensitive surface in the
  package, gets its own reviewed report rather than silently riding along
  with (or being absent from) the root one.

### One error type with a code discriminant, no logger port

`verifyOtp` throws `OtpVerificationError` for every failure mode
(`not_found | expired | too_many_attempts | invalid | token_reused`), all
carrying the identical message `"Invalid or expired authentication session"`.
Distinct messages per failure let an attacker enumerate emails or learn which
verification step they passed; the `code` exists only for the caller's own
branching (e.g. `too_many_attempts` → HTTP 429). `token_reused` doubles as
the package's only audit signal — no logger dependency was added, since the
error code already tells the caller what to log.

### No zod schemas, no dependency on `@opengovsg/validators`

The OTP/PKCE-shaped validation left in starter-kit's `validators/auth.ts`
(`z.string().length(OTP_LENGTH)`, a base64url-and-32-bytes check) is a few
lines against exported constants — not enough surface to justify a zod peer
dependency, let alone a runtime edge to another published package to save
writing that line. `isValidCodeChallenge` covers the one check worth
shipping as code.

### Test-only in-memory store, not exported

`createOtpAuth`'s test suite runs against a `VerificationTokenStore` built
for that purpose, deliberately not part of the package's public exports.
Shipping a working in-memory store invites production use of something with
no persistence and no cross-instance sharing; Prisma/Kysely adapters are
README recipes instead. This also means the package has no
testcontainers/Docker-backed tests — unlike `@opengovsg/rate-limit`, nothing
here talks to real infrastructure.

### No React

The client-side verifier lifecycle (keep the verifier in memory — a `Map` or
closure — never `sessionStorage`/`localStorage`, since it should die with the
page) is documented in the README rather than shipped as a `PkceProvider`/
`usePkce` context. This would be the repo's first package with a React peer
dependency; the actual app-specific state (wizard steps, resend timers,
toasts) that surrounds the verifier in every real app makes a one-size
provider low-value.

## Consequences

- Apps get a safe-by-default OTP verify sequence by implementing a 3-method
  storage adapter and an `sendOtp` callback; the dangerous ordering is no
  longer something every app must get right independently.
- The plain OTP is structurally unable to leak through `issueOtp`'s return
  value — it only ever reaches the injected `sendOtp` callback.
- Two API reports (`etc/auth.api.md`, `etc/auth-server.api.md`) must both be
  regenerated (`pnpm build:report`) when either entry point's public surface
  changes.
- Apps still own: session creation, user upsert/account linking, tRPC/REST
  routing, and rate limiting (pair with `@opengovsg/rate-limit`) — none of
  that is in scope here.
- starter-kit is expected to adopt this package in a follow-up PR, replacing
  `auth.utils.ts`, `lib/pkce/`, and the storage-facing half of
  `auth.service.ts`.
