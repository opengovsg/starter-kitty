# Auth

OTP login: PKCE-style session binding plus one-time-password generation and
verification. The glossary below names the parts of that flow. The source
this package was extracted from used **token** for two different things in
the same file, the plain OTP and its hash. That is exactly the kind of
ambiguity that produces a plaintext-secret bug, so the word does not appear
in this package's API at all.

## Language

**Verifier**:
The random secret minted by the requesting client (`createPkceVerifier`),
128 characters from the RFC 7636 unreserved alphabet. Held only by the
client that requested it, in memory rather than `sessionStorage` or
`localStorage`, and sent to the server only at verify time, as
`codeVerifier`.
_Avoid_: secret, code (ambiguous with OTP), session token

**Challenge**:
`SHA-256(verifier)`, base64url-encoded (`createPkceChallenge`). Sent with the
_issue_ request, never the verifier itself. Becomes half of the record's
**identifier** and doubles as its hash salt.
_Avoid_: hash (ambiguous with the OTP's hash), digest

**OTP**:
The plain one-time password: the value emailed to the user, and the `otp`
field on `verifyOtp` and the `sendOtp` callback. Exists only as an argument
to `sendOtp`. **Never** the value returned from `issueOtp`, logged, or
persisted in plain form.
_Avoid_: token (this is the ambiguity the source had, where `token` meant
both this and the **OTP hash** in the same file), code (ambiguous with
**challenge**)

**OTP hash**:
The scrypt hash of the OTP, salted with the **identifier** (`hashOtp`,
`isValidOtpHash`). The only form of the OTP that reaches an
`OtpVerificationStore`, where it is the `hashedOtp` field, and
`expectedHashedOtp` when passed back to `consume` as the condition on the
delete.
_Avoid_: token, hashed token

**Prefix**:
A short (2-6 char) string shown to the user as a "this is your code"
confirmation. Generated independently of the OTP (`otpPrefix`), not a slice
of it, so displaying it never reduces the OTP's own entropy.
_Avoid_: OTP prefix meaning `otp.slice(0, n)`, which is a different, weaker
design this package deliberately does not use.

**Normalized email**:
The user's email address, already lowercased (and otherwise canonicalized)
by the caller. Named `normalizedEmail` everywhere in the API precisely
because this package uses it verbatim and never normalizes it. The name is
the reminder that canonicalizing it is the caller's job.
_Avoid_: email (hides the precondition, which is the whole point)

**Identifier**:
The `OtpVerificationStore` record's primary key:
`JSON.stringify([normalizedEmail, codeChallenge])`. Opaque to store
implementations: they receive it, they never construct or parse it. Doubles
as the OTP hash's salt, since it is already unique per (email, challenge)
pair and is not itself secret.
_Avoid_: key (too generic, since it could mean a Redis key, a store's
primary key column, or this), salt (it is also this, but calling it only
"salt" hides that it is also the lookup key)

**Consume**:
The store operation that deletes a record as a _claim_ on it, returning
whether this call was the one that deleted it
(`OtpVerificationStore.consume`). Not a plain delete, in two ways: it is
conditional on the **OTP hash** it was given, so it can only ever delete the
exact record the caller validated; and the boolean return is what lets
`verifyOtp` detect a concurrent verification that already won the race and
reject it as `otp_reused`.
_Avoid_: delete (loses both the conditionality and the "tell me if I was
first" contract)
