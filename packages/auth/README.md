# `@opengovsg/auth`

Framework-agnostic building blocks for a safe-by-default OTP login flow:
PKCE-style session binding and one-time-password generation/verification with
the ordering that closes known timing, brute-force, and replay attacks
already built in.

Requires Node.js `>=20.19.0`, or any modern browser, for the isomorphic parts
(Web Crypto's `globalThis.crypto.subtle`, unflagged in Node since v19).

## This is not an OAuth/OIDC library

The PKCE (RFC 7636) functions here mint a verifier/challenge pair and nothing
else: no `state`, no `nonce`, no authorization-code exchange. They exist to
bind a one-time password to the browser session that requested it, so an
attacker who intercepts the OTP in transit still cannot redeem it. **Do not
use this for an actual OAuth/OIDC authorization-code flow.** Use a
maintained library such as [`openid-client`](https://github.com/panva/node-openid-client)
or [`jose`](https://github.com/panva/jose) for that.

## Entry points

| Import                       | Contents                                                            | Environment |
| ---------------------------- | ------------------------------------------------------------------- | ----------- |
| `@opengovsg/auth`            | Re-exports of `./pkce` and `./otp`                                  | Isomorphic  |
| `@opengovsg/auth/pkce`       | `createPkceVerifier`, `createPkceChallenge`, `isValidCodeChallenge` | Isomorphic  |
| `@opengovsg/auth/otp`        | `OTP_DEFAULTS`, `OtpVerificationError`                              | Isomorphic  |
| `@opengovsg/auth/server/otp` | `createOtpAuth` and its types                                       | Node only   |

Import `./server/otp` only in server code. It pulls in `node:crypto`, which
does not resolve in a browser bundle.

## Normalize the email before you call

Both `issueOtp` and `verifyOtp` take `normalizedEmail`, not `email`. This
package uses that value **verbatim** as half of the record's primary key and
scrypt salt, and never normalizes it. `Alice@example.com` at issue time and
`alice@example.com` at verify time resolve to two different records, and
verification fails.

Normalize on the way in, the same way at both call sites. At minimum,
lowercase it. [`@opengovsg/validators`](../validators/)'s `createEmailSchema`
validates and trims but does **not** lowercase, so add that yourself:

```ts
import { createEmailSchema } from '@opengovsg/validators/email'

const emailSchema = createEmailSchema({ domains: [{ domain: 'gov.sg', includeSubdomains: true }] })

// Parse, then lowercase. This is the value to hand to issueOtp/verifyOtp.
const normalizedEmail = emailSchema.parse(input).toLowerCase()
```

Whatever rule you pick (lowercasing only, or something stricter like
stripping plus-addressing), apply it consistently and store the same
normalized form on your user records.

## The flow

1. **Client** calls `createPkceVerifier()`, keeps the result **in memory only**
   (a `Map`/`useRef`/closure, never `sessionStorage` or `localStorage`; it
   should not survive a page reload), derives `createPkceChallenge(verifier)`,
   and sends `{ normalizedEmail, codeChallenge }` to the server.
2. **Server** calls `issueOtp({ normalizedEmail, codeChallenge })`, which mints
   an OTP, hands it to your `sendOtp` callback (email, SMS, whatever you use),
   and resolves to `{ success: true, data: { otpPrefix } }`. `otpPrefix` is a
   confirmation value, **never the OTP itself**.
3. **Client** submits `{ normalizedEmail, otp, codeVerifier }` (the plain
   verifier from step 1, plus the OTP the user typed in).
4. **Server** calls `verifyOtp({ normalizedEmail, otp, codeVerifier })`, which
   re-derives the challenge, checks expiry, attempt count, and the hash, and
   resolves to `{ success: true, data: { normalizedEmail } }` on success.
   Session creation and user upsert/account-linking are your app's job, not
   this package's.

Neither `issueOtp` nor `verifyOtp` ever throws. Both resolve to an
`OtpResult<T>`, in the shape of [Zod's `safeParse`](https://zod.dev/?id=safeparse):
`{ success: true, data: T } | { success: false, error: OtpVerificationError }`.
Check `result.success` (it narrows the type) instead of wrapping calls in
`try`/`catch`.

(`createOtpAuth` itself does throw `OtpOptionsError` if you pass an
out-of-range option. That is a wiring mistake, caught once at startup
rather than silently weakening every OTP the service issues.)

```ts
// server: src/otp-auth.ts
import { createOtpAuth } from '@opengovsg/auth/server/otp'

import { sendOtpEmail } from './mail'
import { otpVerificationStore } from './otp-verification-store' // see below

export const otpAuth = createOtpAuth({
  store: otpVerificationStore,
  sendOtp: ({ normalizedEmail, otp, otpPrefix }) => sendOtpEmail(normalizedEmail, otp, otpPrefix),
})
```

```ts
// server: a login handler
const issued = await otpAuth.issueOtp({ normalizedEmail, codeChallenge })
if (!issued.success) {
  if (issued.error.code === 'unexpected') {
    logger.error({ err: issued.error.cause }, 'OTP issue failed')
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
  // challenge_invalid or challenge_conflict: the client should mint a fresh
  // verifier + challenge and retry.
  return res.status(400).json({ message: 'Please refresh the page and try again.' })
}
const { otpPrefix } = issued.data
```

```ts
// client
import { createPkceChallenge, createPkceVerifier } from '@opengovsg/auth/pkce'

const verifiers = new Map<string, string>() // challenge -> verifier, in memory only

async function startLogin(normalizedEmail: string) {
  const codeVerifier = createPkceVerifier()
  const codeChallenge = await createPkceChallenge(codeVerifier)
  verifiers.set(codeChallenge, codeVerifier)
  await api.login({ normalizedEmail, codeChallenge })
  return codeChallenge
}

async function submitOtp(normalizedEmail: string, otp: string, codeChallenge: string) {
  const codeVerifier = verifiers.get(codeChallenge)
  if (!codeVerifier) throw new Error('No pending login for this challenge')
  await api.verifyOtp({ normalizedEmail, otp, codeVerifier })
  verifiers.delete(codeChallenge)
}
```

## Handling verification failures

`OtpVerificationError.message` is one fixed generic string across every
`code`, a safe default for apps that don't want to think about copy. But
your app is free to write its own message per `code`. Branch on `code`, not
on `message`:

```ts
const result = await otpAuth.verifyOtp({ normalizedEmail, otp, codeVerifier })
if (!result.success) {
  if (result.error.code === 'unexpected') {
    // Your store or mailer failed. This is not the user's fault. Log the
    // cause and return a server error; do not tell them their code is wrong.
    logger.error({ err: result.error.cause }, 'OTP verification failed')
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
  if (result.error.code === 'too_many_attempts') {
    return res.status(429).json({ message: 'Wrong OTP was entered too many times. Please request a new OTP.' })
  }
  return res.status(401).json({ message: 'Token is invalid or has expired. Please request a new OTP.' })
}
const { normalizedEmail: verifiedEmail } = result.data
```

Note the `unexpected` branch. Without it, a database outage or SMTP failure
returns a 401 telling the user their perfectly good code is invalid, and
`error.cause`, the only record of what actually broke, is silently
discarded.

The rule for the remaining verify-path codes: keep `not_found` / `expired` /
`invalid` / `otp_reused` merged into a single bucket in your own copy, the
way the example above does. Splitting those further, with a distinct message
for "no such session" vs. "wrong code" vs. "already used", lets an attacker
enumerate emails or learn exactly which verification step they passed.
`too_many_attempts` is safe to split out on its own: it says nothing about
whether the code was ever valid, only that this session's guesses are
exhausted.

This applies to **user-facing copy only**. HTTP status codes, structured
logs, metrics, and audit events should distinguish every code, which is what
`error.code` and `error.attemptCount` are for. The concern is what an
unauthenticated caller can read off the response body, not what your own
observability records.

`code` is one of:

| Code                 | Meaning                                                              | `attemptCount` |
| -------------------- | -------------------------------------------------------------------- | -------------- |
| `not_found`          | No matching record (wrong email/verifier, malformed input, consumed) | never set      |
| `expired`            | The OTP's `otpExpirySeconds` window has passed                       | set            |
| `too_many_attempts`  | `maxAttempts` exceeded for this record                               | set            |
| `invalid`            | Wrong OTP submitted to `verifyOtp`                                   | set            |
| `otp_reused`         | A concurrent `verifyOtp` already consumed this record                | set            |
| `challenge_invalid`  | `issueOtp` got a challenge that isn't a canonical S256 digest        | never set      |
| `challenge_conflict` | `issueOtp` found a live OTP already issued for this pair             | never set      |
| `unexpected`         | Your injected `store` or `sendOtp` threw; see `error.cause`          | never set      |

`error.attemptCount` is the record's attempt count, including this one, at
the point of failure, for your own logging/metrics. It is never part of
`error.message`. It is only ever set for a code reached _after_ a record was
found and `incrementAttempts` ran.

The two issue-path codes are safe to disambiguate for the client, since the
client generated the challenge itself and learns nothing about any other
user: `challenge_invalid` means it wasn't minted by `createPkceChallenge`,
`challenge_conflict` means a live OTP already exists for this
`(normalizedEmail, codeChallenge)` pair and the client should mint a fresh
verifier rather than reusing one.

`otp_reused` means a concurrent verification already consumed the record.
Treat it as a failure like any other; it is not a race your app needs to
retry.

### Behaviour worth knowing

- **The attempt cap fires exactly once.** Exceeding `maxAttempts` consumes
  the record, so the _next_ call gets `not_found`, not another
  `too_many_attempts`. This is deliberate: a locked-out record that stayed
  around would be an oracle for confirming an OTP was ever issued for an
  address. It also means the same challenge can be re-issued immediately
  after a lockout.
- **Expired leftovers self-heal on re-issue.** If a record expires without
  ever being submitted, the next `issueOtp` for that same identifier clears
  it and issues fresh, rather than returning `challenge_conflict` forever.
  Records that are never re-issued against still need adapter-side cleanup.
  See below.
- **Malformed input doesn't burn attempts.** A wrong-length OTP or malformed
  verifier is rejected before `incrementAttempts` runs, so a garbage request
  can't drain a legitimate session's budget (and can't make the server spend
  a scrypt call either).

### On issue-time enumeration

This package makes `issueOtp` behave identically whether or not the address
belongs to a known user, since it never looks users up. If your app gates OTP
issuance behind an allowlist, an eligibility check, or "only send to
existing accounts", **you** reintroduce an enumeration oracle: the response
body, the status code, or just the latency of an awaited `sendOtp` tells an
attacker which addresses are registered.

If that matters for your product (it usually does for anything
health-related or otherwise sensitive), return the same response for both
cases, such as "If this address is eligible, we've sent a code", and make
sure the ineligible path takes similar time to the eligible one rather than
returning immediately without any mail call.

## Writing an `OtpVerificationStore`

There is no shipped store; persistence is your app's job. The interface is
three methods, all of which must be atomic operations at the database level
(not read-then-write), since that atomicity is what makes the attempt cap and
one-time-use guarantees hold under concurrent requests. Feel free to let a
genuine infrastructure failure (a dropped connection, for instance) throw.
`issueOtp`/`verifyOtp` catch it and surface it as
`{ success: false, error }` with `error.code === 'unexpected'` rather than
letting it propagate.

`create` returns the existing record on conflict, which is what lets
`issueOtp` self-heal an expired leftover instead of being blocked by it.
That covers records that are re-issued against; a record that is issued,
never submitted, and never re-issued is never revisited by this package at
all. Give your adapter its own cleanup for those (a scheduled job, or a
native TTL if your store has one) or rows accumulate without bound:

```ts
import type { OtpVerificationStore } from '@opengovsg/auth/server/otp'
```

### Prisma

```prisma
model OtpVerification {
  identifier String   @id
  hashedOtp  String
  attempts   Int      @default(0)
  issuedAt   DateTime @default(now())
}
```

```ts
export const otpVerificationStore: OtpVerificationStore = {
  async create({ identifier, hashedOtp, issuedAt }) {
    try {
      await db.otpVerification.create({ data: { identifier, hashedOtp, issuedAt } })
      return { status: 'created' }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await db.otpVerification.findUniqueOrThrow({ where: { identifier } })
        return { status: 'conflict', existing }
      }
      throw error
    }
  },
  async incrementAttempts(identifier) {
    try {
      return await db.otpVerification.update({
        where: { identifier },
        data: { attempts: { increment: 1 } },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return null // no matching row
      }
      throw error
    }
  },
  async consume(identifier, expectedHashedOtp) {
    const { count } = await db.otpVerification.deleteMany({
      where: { identifier, hashedOtp: expectedHashedOtp },
    })
    return count > 0
  },
}
```

### Kysely

```ts
export const otpVerificationStore: OtpVerificationStore = {
  async create({ identifier, hashedOtp, issuedAt }) {
    const inserted = await db
      .insertInto('OtpVerification')
      .values({ identifier, hashedOtp, issuedAt, attempts: 0 })
      .onConflict(oc => oc.column('identifier').doNothing())
      .returningAll()
      .executeTakeFirst()

    if (inserted) return { status: 'created' }

    const existing = await db
      .selectFrom('OtpVerification')
      .selectAll()
      .where('identifier', '=', identifier)
      .executeTakeFirstOrThrow()
    return { status: 'conflict', existing }
  },
  async incrementAttempts(identifier) {
    const record = await db
      .updateTable('OtpVerification')
      .set(eb => ({ attempts: eb('attempts', '+', 1) }))
      .where('identifier', '=', identifier)
      .returningAll()
      .executeTakeFirst()
    return record ?? null
  },
  async consume(identifier, expectedHashedOtp) {
    const result = await db
      .deleteFrom('OtpVerification')
      .where('identifier', '=', identifier)
      .where('hashedOtp', '=', expectedHashedOtp)
      .executeTakeFirst()
    return result.numDeletedRows > 0n
  },
}
```

Whatever store you use, `issuedAt` must come back as a real `Date`. An
adapter that returns the raw column as a string surfaces as an `unexpected`
error with an explanatory `cause`, rather than silently treating every OTP
as unexpired.

## Configuration

`createOtpAuth` accepts the options below. Every one is range-checked at
construction. An out-of-range or non-integer value throws `OtpOptionsError`
rather than being silently clamped, so a misconfiguration surfaces at
startup instead of quietly weakening every OTP:

| Option             | Default | Accepted range                                    |
| ------------------ | ------- | ------------------------------------------------- |
| `otpLength`        | `8`     | Minimum 8, no maximum; longer is only more secure |
| `otpExpirySeconds` | `600`   | 1–600 (the NIST SP 800-63B 10-minute ceiling)     |
| `maxAttempts`      | `5`     | 1–10                                              |
| `otpPrefixLength`  | `3`     | 2–6                                               |

`createPkceVerifier` always mints 128 characters, the RFC 7636 maximum, and
that is not configurable. Shorter is strictly worse, and there's no scenario
where tuning it down helps. `verifyOtp` still accepts any verifier in the
RFC's 43-128 range, so a verifier minted elsewhere verifies normally.

### On the scrypt work factor

OTP hashing uses Node's default scrypt parameters (N=2¹⁴, r=8, p=1, ~16 MiB
per hash) rather than [OWASP's password-storage
recommendation](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt)
of N=2¹⁷. This is deliberate. OWASP's parameters are tuned for long-lived,
low-entropy, frequently-reused human passwords; this hashes a
CSPRNG-generated 40-bit OTP that is single-use and expires within minutes.
N=2¹⁷ also exceeds Node's default 32 MiB `maxmem`, so it would require an
explicit override and would let a handful of concurrent logins exhaust the
threadpool's memory budget. The hash's job here is to keep a stolen database
row from being trivially crackable inside the OTP's short life, which these
parameters do.

## Pairing with rate limiting

This package enforces per-OTP attempt limits, not request-rate limits. Pair
it with [`@opengovsg/rate-limit`](../rate-limit/), mounted **per-IP, not
per-email**. A per-email cooldown lets an attacker lock out the real user by
spamming login requests for their address.

See the [documentation website](https://kit.open.gov.sg/) for full API docs.
