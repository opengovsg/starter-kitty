# 11. Auth package design

Date: 2026-08-11
Status: Accepted

## Context

Apps built from [`opengovsg/starter-kit`](https://github.com/opengovsg/starter-kit)
hand-roll an OTP login flow: OTP generation and hashing
(`auth.utils.ts`), a PKCE-style verifier/challenge pair binding the OTP to
the requesting browser session (`lib/pkce/`), and a five-step verify sequence
(`auth.service.ts`) whose ordering is exactly where a naive
reimplementation reopens a known attack: atomic attempt increment before
validation, expiry check, attempt cap, timing-safe compare, delete-as-claim. This ADR
records the design of `@opengovsg/auth`, which extracts that flow.

Note this is **not an OAuth/OIDC package**. starter-kit's own PKCE files carry
the comment "do not use this for actual OAuth flows". There is no `state`,
`nonce`, or authorization-code exchange here. PKCE (RFC 7636) is reused only
as a session-binding mechanism: the browser mints a verifier, sends only its
challenge with the login request, and the challenge becomes the OTP record's
primary key and hash salt.

## Decision

### Orchestration, not bare primitives

`createOtpAuth` ships the full `issueOtp`/`verifyOtp` sequence behind an
injected `OtpVerificationStore`, rather than exporting only
`hashOtp`/`isValidOtpHash`-style primitives. The vulnerabilities in this flow
live in the *ordering* of the verify steps, not in any single primitive. A
caller who gets that ordering wrong is exposed even with correct primitives.
Since the storage port has real independent implementations across OGP apps
(Prisma, Kysely, Drizzle), this is not a single-implementation interface
manufactured for its own sake.

### One isomorphic PKCE implementation via Web Crypto

starter-kit carries two independent PKCE challenge implementations, Node
`createHash('sha256')` server-side and manual `btoa` + regex replacement
client-side, with nothing asserting they agree. `createPkceChallenge` uses
`globalThis.crypto.subtle.digest('SHA-256', ...)` instead: one implementation
for both environments, so divergence is impossible by construction rather
than something to keep testing for. Web Crypto has been available unflagged
on `globalThis` since Node.js 19; this repo's `engines.node` floor of
`>=20.19.0` is comfortably past that. A defensive `node:crypto` import
fallback was considered and rejected. Under Next.js Edge, a Node builtin
import (static or dynamic) is replaced with a proxy that throws on property
access, which is worse than the bare call it's meant to guard.

The package ships **ESM-only**, matching the rest of this monorepo and its
one runtime dependency (`nanoid` v5). The same `>=20.19.0` floor makes this
cost-free for CommonJS consumers: `require(esm)` is supported from 20.19,
so a CJS codebase can `require('@opengovsg/auth')` without a dual build or
a dynamic `import()`.

### Split entry points, isomorphic root

- `.` / `./pkce` / `./otp`, safe to bundle into a browser: PKCE
  verifier/challenge functions, OTP constants, and the `OtpVerificationError`
  type.
- `./server/otp`, holding the `createOtpAuth` factory, scrypt hashing, and
  `timingSafeEqual` comparison. Node-only (`node:crypto`), and reported
  through a second `api-extractor.server.json` config
  (`etc/auth-server.api.md`) so this, the most sensitive surface in the
  package, gets its own reviewed report rather than silently riding along
  with (or being absent from) the root one.

### A result type, not thrown errors; one error type with a code discriminant

`issueOtp` and `verifyOtp` never throw. Both resolve to an `OtpResult<T>`,
`{ success: true, data: T } | { success: false, error: OtpVerificationError }`,
in the shape of Zod's `safeParse`, so a caller checks `result.success`
(narrowing the type) instead of wrapping every call in `try`/`catch`. This
includes failures from the caller's own injected `store` or `sendOtp`: those
are caught internally and surfaced as `error.code === 'unexpected'` with
`error.cause` set to whatever was thrown, rather than propagating as an
exception. A `try`/`catch`-based design was the initial shape but was
rejected: this package's entire value proposition is that a caller cannot
get the verify sequence wrong, and a forgettable `try`/`catch` around every
call site reintroduces exactly the kind of easy-to-omit safety step the
package exists to remove.

Every `OtpVerificationError` carries the identical message `"Invalid or
expired authentication session"`, a safe default rather than a restriction
on the caller. `code` is deliberately granular so the app *can* branch (e.g.
`too_many_attempts` → HTTP 429, `unexpected` → log `error.cause` and 500,
and its own user-facing copy per bucket); only the package's own bundled
`message` stays fixed. This applies to user-facing copy only: status codes,
logs, metrics, and audit events should distinguish every code, which is
what `code` and `attemptCount` exist for.

The verify-path codes (`not_found`, `expired`, `invalid`, `otp_reused`)
should stay merged into one bucket in the app's own copy too. Splitting
those further is exactly what lets an attacker enumerate emails or learn
which verification step they passed. `too_many_attempts` is safe to split
out, since it says nothing about whether the code was ever valid.

The **issue-path** codes are deliberately *not* merged: `challenge_invalid`
(the challenge was not minted by `createPkceChallenge`) and
`challenge_conflict` (a live OTP already exists for this pair) are safe to
disambiguate, because the client generated the challenge itself and learns
nothing about any other user from the distinction. Collapsing both into a
generic `invalid`, the original shape, left the client unable to tell "my
code is buggy" from "mint a fresh verifier and retry".

`otp_reused` doubles as the package's only audit signal. No logger
dependency was added, since the error code already tells the caller what to
log.

`OtpVerificationError` also carries an optional `attemptCount`: the
record's attempt count at the point of failure, set for every code reached
after a record was found and `incrementAttempts` ran
(`expired`/`too_many_attempts`/`invalid`/`otp_reused`), `undefined` for
everything else. This is for the caller's own logging/metrics, never part
of `message`, and is a lower-cost alternative to adding a logger dependency
for this one piece of data the package already has in hand at the point of
failure.

### Options are range-checked, not clamped

Every numeric option is validated at construction and throws
`OtpOptionsError` if out of range, rather than being silently corrected to
the nearest legal value. Clamping was the initial shape and was wrong for a
security package: a typo'd `maxAttempts: 100` silently becoming `10`, or a
`otpExpirySeconds: 86400` silently becoming the ceiling, weakens (or
appears to weaken) every OTP the service issues with nothing in the logs to
say so. A throw surfaces the mistake at startup, on the first call.

`otpExpirySeconds` is capped at 600 rather than left unbounded, per NIST SP
800-63B: "the authentication SHALL be considered invalid if not completed
within 10 minutes". 600 is also the default, since the ceiling is the
sensible value here rather than a limit to design against. An earlier revision defaulted to
60 seconds, which is well inside the standard but punishing for email
delivery, where a minute can elapse before the message even lands.

### `issueOtp` self-heals an expired leftover

`store.create` returns the existing record on conflict rather than a bare
`'conflict'`, which lets `issueOtp` distinguish a live OTP (a real
conflict, since re-issuing would invalidate a code the user is about to
type) from an expired leftover (which it consumes, then retries). Without this,
an abandoned record blocks re-issue for its `(normalizedEmail,
codeChallenge)` pair until adapter-side cleanup happens to run, which for a
client that reuses a challenge on resend means a login that cannot proceed.

This does not remove the need for adapter-side cleanup: a record that is
issued, never submitted, and never re-issued against is never revisited.
Self-healing covers availability, TTL cleanup covers storage growth.

### `normalizedEmail`, not `email`

The public argument is `normalizedEmail` because the package uses it
verbatim as half the record's primary key and scrypt salt, and never
canonicalizes it, so `Alice@example.com` at issue and `alice@example.com`
at verify are two different records. Normalizing inside the package was
rejected: it would bake in an opinion about plus-addressing and Unicode, and
would silently diverge from whatever form the app stored on its own user
rows. Naming the parameter for its precondition makes the requirement
visible at every call site instead of only in prose that a caller may not
read.

### No zod schemas, no dependency on `@opengovsg/validators`

The OTP/PKCE-shaped validation left in starter-kit's `validators/auth.ts`
(`z.string().length(OTP_LENGTH)`, a base64url-and-32-bytes check) is a few
lines against exported constants, not enough to justify a zod peer
dependency, let alone a runtime edge to another published package to save
writing that line. `isValidCodeChallenge` covers the one check worth
shipping as code.

### Test-only in-memory store, not exported

`createOtpAuth`'s test suite runs against an `OtpVerificationStore` built
for that purpose, deliberately not part of the package's public exports.
Shipping a working in-memory store invites production use of something with
no persistence and no cross-instance sharing; Prisma/Kysely adapters are
README recipes instead. This also means the package has no
testcontainers/Docker-backed tests. Unlike `@opengovsg/rate-limit`, nothing
here talks to real infrastructure.

### No React

The client-side verifier lifecycle (keep the verifier in memory, in a `Map`
or closure rather than `sessionStorage`/`localStorage`, since it should die
with the page) is documented in the README rather than shipped as a
`PkceProvider`/`usePkce` context. This would be the repo's first package with a React peer
dependency; the actual app-specific state (wizard steps, resend timers,
toasts) that surrounds the verifier in every real app makes a one-size
provider low-value.

## Consequences

- Apps get a safe-by-default OTP verify sequence by implementing a 3-method
  storage adapter and a `sendOtp` callback; the dangerous ordering is no
  longer something every app must get right independently.
- The plain OTP is structurally unable to leak through `issueOtp`'s return
  value; it only ever reaches the injected `sendOtp` callback.
- Callers cannot forget error handling: TypeScript forces a `success` check
  before `data`/`error` is accessible, and there is no exception path to
  accidentally leave uncaught.
- Two API reports (`etc/auth.api.md`, `etc/auth-server.api.md`) must both be
  regenerated (`pnpm build:report`) when either entry point's public surface
  changes.
- Apps still own: session creation, user upsert/account linking, tRPC/REST
  routing, and rate limiting (pair with `@opengovsg/rate-limit`). None of
  that is in scope here.
- starter-kit is expected to adopt this package in a follow-up PR, replacing
  `auth.utils.ts`, `lib/pkce/`, and the storage-facing half of
  `auth.service.ts`.
- The public API says **otp**, never **token**: `verifyOtp({ otp })`,
  `hashedOtp`/`expectedHashedOtp`, `hashOtp`/`isValidOtpHash`, `otp_reused`,
  `OtpVerificationStore`. The source this was extracted from used `token`
  for both the plain OTP and its hash in the same file; naming every part of
  the flow for the material it actually handles is what
  [CONTEXT.md](../../packages/auth/CONTEXT.md) exists to enforce, and the
  code has to comply with its own glossary for that to mean anything. Done
  pre-1.0, while the package had only ever been published as a snapshot.
