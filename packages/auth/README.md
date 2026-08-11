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
   returns `{ otpPrefix }` — a confirmation value, **never the OTP itself**.
3. **Client** submits `{ email, token, codeVerifier }` (the plain verifier
   from step 1, plus the OTP the user typed in).
4. **Server** calls `verifyOtp({ email, token, codeVerifier })`, which
   re-derives the challenge, checks expiry, attempt count, and the hash, and
   returns `{ email }` on success. Session creation and user
   upsert/account-linking are your app's job, not this package's.

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
const { otpPrefix } = await otpAuth.issueOtp({ email, codeChallenge })
// ...
const { email } = await otpAuth.verifyOtp({ email, token, codeVerifier })
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

```ts
import { OtpVerificationError } from '@opengovsg/auth/otp'

try {
  await otpAuth.verifyOtp({ email, token, codeVerifier })
} catch (error) {
  if (error instanceof OtpVerificationError) {
    if (error.code === 'too_many_attempts') {
      return res.status(429).json({ message: error.message })
    }
    return res.status(401).json({ message: error.message })
  }
  throw error
}
```

Every `OtpVerificationError` carries the same generic `message` regardless of
`code` — branch on `code` for your own logic (metrics, rate limiting,
choosing an HTTP status), but never show the user a distinct message per
`code`. Doing so lets an attacker enumerate emails or learn which
verification step they passed.

`code` is one of `not_found | expired | too_many_attempts | invalid |
token_reused`. `token_reused` means a concurrent verification already
consumed the record — treat it as a failure like any other; it is not a
race your app needs to retry.

## Writing a `VerificationTokenStore`

There is no shipped store — persistence is your app's job. The interface is
three methods, all of which must be atomic operations at the database level
(not read-then-write), since that atomicity is what makes the attempt cap and
one-time-use guarantees hold under concurrent requests:

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
    } catch {
      return null // P2025: no matching row
    }
  },
  async consume(identifier) {
    const { count } = await db.verificationToken.deleteMany({ where: { identifier } })
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
    } catch {
      return 'conflict' // unique constraint violation on `identifier`
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
  async consume(identifier) {
    const result = await db.deleteFrom('VerificationToken').where('identifier', '=', identifier).executeTakeFirst()
    return result.numDeletedRows > 0n
  },
}
```

## Configuration

`createOtpAuth` accepts, all clamped to the ranges below:

| Option             | Default        | Clamped range |
| ------------------ | -------------- | ------------- |
| `otpLength`        | `8`            | 6-12          |
| `otpExpirySeconds` | `600` (10 min) | 60-1800       |
| `maxAttempts`      | `5`            | 1-10          |
| `otpPrefixLength`  | `3`            | 2-6           |

The PKCE verifier length is fixed at 128 (the RFC 7636 maximum) and is not
configurable — shorter is strictly worse, and there's no scenario where
tuning it down helps.

## Pairing with rate limiting

This package enforces per-OTP attempt limits, not request-rate limits. Pair
it with [`@opengovsg/rate-limit`](../rate-limit/), mounted **per-IP, not
per-email** — a per-email cooldown lets an attacker lock out the real user by
spamming login requests for their address.

See the [documentation website](https://kit.open.gov.sg/) for full API docs.
