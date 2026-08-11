# Auth

OTP login: PKCE-style session binding plus one-time-password generation and
verification. The glossary below names the parts of that flow, since the
source this package was extracted from used **token** for two different
things in the same file — exactly the kind of ambiguity that produces a
plaintext-secret bug.

## Language

**Verifier**:
The random secret minted by the requesting client (`createPkceVerifier`),
128 characters from the RFC 7636 unreserved alphabet. Held only by the
client that requested it — in memory, never `sessionStorage` or
`localStorage` — and sent to the server only at verify time, as
`codeVerifier`.
_Avoid_: secret, code (ambiguous with OTP), session token

**Challenge**:
`SHA-256(verifier)`, base64url-encoded (`createPkceChallenge`). Sent with the
_issue_ request, never the verifier itself. Becomes half of the record's
**identifier** and doubles as its hash salt.
_Avoid_: hash (ambiguous with the OTP's hash), digest

**OTP**:
The plain one-time password (`createOtpAuth`'s internal `otp` variable) —
the value emailed to the user. Exists only as an argument to the injected
`sendOtp` callback. **Never** the value returned from `issueOtp`, logged, or
persisted in plain form.
_Avoid_: token (this is the ambiguity starter-kit's `auth.utils.ts` had —
`token` meant both this and the **OTP hash**, in the same file)

**OTP hash**:
The scrypt hash of the OTP, keyed by the **identifier** as salt. The only
form of the OTP that reaches a `VerificationTokenStore`.
_Avoid_: token, hashed token (ambiguous with the plain OTP if either is
shortened to just "token")

**Prefix**:
A short (2-6 char) string shown to the user as a "this is your code"
confirmation. Generated independently of the OTP (`createOtpAuth`'s internal
`otpPrefix`) — not a slice of it, so displaying it never reduces the OTP's
own entropy.
_Avoid_: OTP prefix meaning `otp.slice(0, n)` — that is a different, weaker
design this package deliberately does not use.

**Identifier**:
The `VerificationTokenStore` record's primary key:
`JSON.stringify([email, codeChallenge])`. Opaque to store implementations —
they receive it, they never construct or parse it. Doubles as the OTP hash's
salt, since it is already unique per (email, challenge) pair and is not
itself secret.
_Avoid_: key (too generic — could mean a Redis key, a store's primary key
column, or this), salt (it is also this, but calling it only "salt" hides
that it is also the lookup key)

**Consume**:
The store operation that deletes a record as a _claim_ on it, returning
whether this call was the one that deleted it (`VerificationTokenStore.consume`).
Not a plain delete: the boolean return is what lets `verifyOtp` detect a
concurrent verification that already won the race and reject it as
`token_reused`.
_Avoid_: delete (loses the "and tell me if I was first" contract)
