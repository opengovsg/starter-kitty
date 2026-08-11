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

### A result type, not thrown errors; one error type with a code discriminant

`issueOtp` and `verifyOtp` never throw. Both resolve to an `OtpResult<T>` —
`{ success: true, data: T } | { success: false, error: OtpVerificationError }`,
in the shape of Zod's `safeParse` — so a caller checks `result.success`
(narrowing the type) instead of wrapping every call in `try`/`catch`. This
includes failures from the caller's own injected `store` or `sendOtp`: those
are caught internally and surfaced as `error.code === 'unexpected'` with
`error.cause` set to whatever was thrown, rather than propagating as an
exception. A `try`/`catch`-based design was the initial shape but was
rejected: this package's entire value proposition is that a caller cannot
get the verify sequence wrong, and a forgettable `try`/`catch` around every
call site reintroduces exactly the kind of easy-to-omit safety step the
package exists to remove.

`OtpVerificationError.code` is one of `not_found | expired |
too_many_attempts | invalid | token_reused | unexpected`, all carrying the
identical message `"Invalid or expired authentication session"` — a safe
default, not a restriction on the caller. `code` is deliberately granular so
the app *can* branch (e.g. `too_many_attempts` → HTTP 429, `unexpected` →
log `error.cause` and 500, and its own user-facing copy per bucket); only
the package's own bundled `message` stays fixed. The line the README draws
for app-level copy: `too_many_attempts` is safe to give its own message,
since it says nothing about whether the code was ever valid. The rest
(`not_found`/`expired`/`invalid`/`token_reused`/`unexpected`) should stay
merged in the app's own copy too — splitting those further is exactly what
lets an attacker enumerate emails or learn which verification step they
passed. `token_reused` doubles as the package's only audit signal — no
logger dependency was added, since the error code already tells the caller
what to log.

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
  storage adapter and a `sendOtp` callback; the dangerous ordering is no
  longer something every app must get right independently.
- The plain OTP is structurally unable to leak through `issueOtp`'s return
  value — it only ever reaches the injected `sendOtp` callback.
- Callers cannot forget error handling: TypeScript forces a `success` check
  before `data`/`error` is accessible, and there is no exception path to
  accidentally leave uncaught.
- Two API reports (`etc/auth.api.md`, `etc/auth-server.api.md`) must both be
  regenerated (`pnpm build:report`) when either entry point's public surface
  changes.
- Apps still own: session creation, user upsert/account linking, tRPC/REST
  routing, and rate limiting (pair with `@opengovsg/rate-limit`) — none of
  that is in scope here.
- starter-kit is expected to adopt this package in a follow-up PR, replacing
  `auth.utils.ts`, `lib/pkce/`, and the storage-facing half of
  `auth.service.ts`.
