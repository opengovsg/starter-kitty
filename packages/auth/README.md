# `@opengovsg/auth`

Framework-agnostic building blocks for a safe-by-default OTP login flow:
PKCE-style session binding and one-time-password generation/verification with
the ordering that closes known timing, brute-force, and replay attacks
already built in.

Requires Node.js `>=20.19.0`, or any modern browser, for the isomorphic parts
(Web Crypto's `globalThis.crypto.subtle`, unflagged in Node since v19).

## This is not an OAuth/OIDC library

The PKCE (RFC 7636) functions here mint a verifier/challenge pair and nothing
else — no `state`, no `nonce`, no authorization-code exchange. They exist to
bind a one-time password to the browser session that requested it, so an
attacker who intercepts the OTP in transit still cannot redeem it. **Do not
use this for an actual OAuth/OIDC authorization-code flow** — use a
maintained library such as [`openid-client`](https://github.com/panva/node-openid-client)
or [`jose`](https://github.com/panva/jose) for that.

## Entry points

| Import                       | Contents                                                            | Environment |
| ---------------------------- | ------------------------------------------------------------------- | ----------- |
| `@opengovsg/auth`            | Re-exports of `./pkce` and `./otp`                                  | Isomorphic  |
| `@opengovsg/auth/pkce`       | `createPkceVerifier`, `createPkceChallenge`, `isValidCodeChallenge` | Isomorphic  |
| `@opengovsg/auth/otp`        | `OTP_DEFAULTS`, `OtpVerificationError`                              | Isomorphic  |
| `@opengovsg/auth/server/otp` | `createOtpAuth` and its types                                       | Node only   |

Import `./server/otp` only in server code — it pulls in `node:crypto`, which
does not resolve in a browser bundle.

## The flow

1. **Client** calls `createPkceVerifier()`, keeps the result **in memory only**
   (a `Map`/`useRef`/closure — never `sessionStorage` or `localStorage`; it
   should not survive a page reload), derives `createPkceChallenge(verifier)`,
   and sends `{ email, codeChallenge }` to the server.
2. **Server** calls `issueOtp({ email, codeChallenge })`, which mints an OTP,
   hands it to your `sendOtp` callback (email, SMS, whatever you use), and
   resolves to `{ success: true, data: { otpPrefix } }` — `otpPrefix` is a
   confirmation value, **never the OTP itself**.
3. **Client** submits `{ email, token, codeVerifier }` (the plain verifier
   from step 1, plus the OTP the user typed in).
4. **Server** calls `verifyOtp({ email, token, codeVerifier })`, which
   re-derives the challenge, checks expiry, attempt count, and the hash, and
   resolves to `{ success: true, data: { email } }` on success. Session
   creation and user upsert/account-linking are your app's job, not this
   package's.

Neither `issueOtp` nor `verifyOtp` ever throws — both resolve to an
`OtpResult<T>`, in the shape of [Zod's `safeParse`](https://zod.dev/?id=safeparse):
`{ success: true, data: T } | { success: false, error: OtpVerificationError }`.
Check `result.success` (it narrows the type) instead of wrapping calls in
`try`/`catch`.

```ts
// server: src/otp-auth.ts
import { createOtpAuth } from '@opengovsg/auth/server/otp'

import { sendOtpEmail } from './mail'
import { verificationTokenStore } from './verification-token-store' // see below

export const otpAuth = createOtpAuth({
  store: verificationTokenStore,
  sendOtp: ({ email, otp, otpPrefix }) => sendOtpEmail(email, otp, otpPrefix),
})
```

```ts
// server: a login and a verify handler
const issued = await otpAuth.issueOtp({ email, codeChallenge })
if (!issued.success) {
  return res.status(400).json({ message: issued.error.message })
}
const { otpPrefix } = issued.data

// ...

const verified = await otpAuth.verifyOtp({ email, token, codeVerifier })
if (!verified.success) {
  const status = verified.error.code === 'too_many_attempts' ? 429 : 401
  return res.status(status).json({ message: verified.error.message })
}
const { email } = verified.data
// create your session / upsert the user here
```

```ts
// client
import { createPkceChallenge, createPkceVerifier } from '@opengovsg/auth/pkce'

const verifiers = new Map<string, string>() // challenge -> verifier, in memory only

async function startLogin(email: string) {
  const codeVerifier = createPkceVerifier()
  const codeChallenge = await createPkceChallenge(codeVerifier)
  verifiers.set(codeChallenge, codeVerifier)
  await api.login({ email, codeChallenge })
  return codeChallenge
}

async function submitOtp(email: string, token: string, codeChallenge: string) {
  const codeVerifier = verifiers.get(codeChallenge)
  if (!codeVerifier) throw new Error('No pending login for this challenge')
  await api.verifyOtp({ email, token, codeVerifier })
  verifiers.delete(codeChallenge)
}
```

## Handling verification failures

`OtpVerificationError.message` is one fixed generic string across every
`code` — a safe default for apps that don't want to think about copy. But
your app is free to write its own message per `code`; branch on `code`, not
on `message`:

```ts
const result = await otpAuth.verifyOtp({ email, token, codeVerifier })
if (!result.success) {
  if (result.error.code === 'too_many_attempts') {
    return res.status(429).json({ message: 'Wrong OTP was entered too many times. Please request a new OTP.' })
  }
  return res.status(401).json({ message: 'Token is invalid or has expired. Please request a new OTP.' })
}
const { email } = result.data
```

The one rule: keep `not_found` / `expired` / `invalid` / `token_reused` (and
usually `unexpected`) merged into a single bucket in your own copy too, the
way the example above does. Splitting those further — a distinct message
for "no such session" vs. "wrong code" vs. "already used" — lets an
attacker enumerate emails or learn exactly which verification step they
passed. `too_many_attempts` is safe to split out on its own: it says
nothing about whether the code was ever valid, only that this session's
guesses are exhausted, which your chosen HTTP status (429 vs. 401) already
implies regardless of what the message says.

`code` is one of:

| Code                | Meaning                                                        |
| ------------------- | -------------------------------------------------------------- |
| `not_found`         | No matching record (wrong email/verifier, or already consumed) |
| `expired`           | The OTP's `otpExpirySeconds` window has passed                 |
| `too_many_attempts` | `maxAttempts` exceeded for this record                         |
| `invalid`           | Wrong OTP, or `issueOtp` hit a `'conflict'` from the store     |
| `token_reused`      | A concurrent `verifyOtp` already consumed this record          |
| `unexpected`        | Your injected `store` or `sendOtp` threw — see `error.cause`   |

`token_reused` means a concurrent verification already consumed the record —
treat it as a failure like any other; it is not a race your app needs to
retry. `unexpected` is the one code that isn't an OTP outcome: it means your
own storage or mail-sending code threw, and the original error is attached
as `error.cause` for logging (never surfaced in `error.message`). If
`sendOtp` throws after the record was already created, `issueOtp` rolls the
record back (best effort) before returning `unexpected`, so retrying with
the same `codeChallenge` re-issues a fresh OTP instead of hitting a
`'conflict'` for one the user never received.

## Writing a `VerificationTokenStore`

There is no shipped store — persistence is your app's job. The interface is
three methods, all of which must be atomic operations at the database level
(not read-then-write), since that atomicity is what makes the attempt cap and
one-time-use guarantees hold under concurrent requests. Feel free to let a
genuine infrastructure failure (a dropped connection, for instance) throw —
`issueOtp`/`verifyOtp` catch it and surface it as
`{ success: false, error }` with `error.code === 'unexpected'` rather than
letting it propagate.

This package never deletes a record that was issued and never submitted —
expiry is only checked the next time `verifyOtp` runs against it. Give your
adapter its own cleanup for abandoned records (a scheduled job, or a native
TTL if your store has one) or rows accumulate without bound:

```ts
import type { VerificationTokenStore } from '@opengovsg/auth/server/otp'
```

### Prisma

```prisma
model VerificationToken {
  identifier String   @id
  token      String
  attempts   Int      @default(0)
  issuedAt   DateTime @default(now())
}
```

```ts
export const verificationTokenStore: VerificationTokenStore = {
  async create({ identifier, hashedToken, issuedAt }) {
    try {
      await db.verificationToken.create({ data: { identifier, token: hashedToken, issuedAt } })
      return 'created'
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return 'conflict'
      }
      throw error
    }
  },
  async incrementAttempts(identifier) {
    try {
      const record = await db.verificationToken.update({
        where: { identifier },
        data: { attempts: { increment: 1 } },
      })
      return { hashedToken: record.token, attempts: record.attempts, issuedAt: record.issuedAt }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return null // no matching row
      }
      throw error
    }
  },
  async consume(identifier, expectedHashedToken) {
    const { count } = await db.verificationToken.deleteMany({
      where: { identifier, token: expectedHashedToken },
    })
    return count > 0
  },
}
```

### Kysely

```ts
export const verificationTokenStore: VerificationTokenStore = {
  async create({ identifier, hashedToken, issuedAt }) {
    try {
      await db.insertInto('VerificationToken').values({ identifier, token: hashedToken, issuedAt }).execute()
      return 'created'
    } catch (error) {
      // Postgres unique-violation SQLSTATE — check whatever your driver
      // surfaces for a uniqueness conflict, and rethrow everything else.
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        return 'conflict'
      }
      throw error
    }
  },
  async incrementAttempts(identifier) {
    const record = await db
      .updateTable('VerificationToken')
      .set(eb => ({ attempts: eb('attempts', '+', 1) }))
      .where('identifier', '=', identifier)
      .returningAll()
      .executeTakeFirst()
    return record ? { hashedToken: record.token, attempts: record.attempts, issuedAt: record.issuedAt } : null
  },
  async consume(identifier, expectedHashedToken) {
    const result = await db
      .deleteFrom('VerificationToken')
      .where('identifier', '=', identifier)
      .where('token', '=', expectedHashedToken)
      .executeTakeFirst()
    return result.numDeletedRows > 0n
  },
}
```

## Configuration

`createOtpAuth` accepts:

| Option             | Default | Clamped range                                            |
| ------------------ | ------- | -------------------------------------------------------- |
| `otpLength`        | `8`     | Minimum 8, no maximum — longer is only ever more secure  |
| `otpExpirySeconds` | `60`    | Not clamped — no direction is unconditionally safer here |
| `maxAttempts`      | `5`     | 1-10                                                     |
| `otpPrefixLength`  | `3`     | 2-6                                                      |

The PKCE verifier length is fixed at 128 (the RFC 7636 maximum) and is not
configurable — shorter is strictly worse, and there's no scenario where
tuning it down helps.

## Pairing with rate limiting

This package enforces per-OTP attempt limits, not request-rate limits. Pair
it with [`@opengovsg/rate-limit`](../rate-limit/), mounted **per-IP, not
per-email** — a per-email cooldown lets an attacker lock out the real user by
spamming login requests for their address.

See the [documentation website](https://kit.open.gov.sg/) for full API docs.
