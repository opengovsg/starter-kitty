import type { OtpResult } from '../../otp/errors.js'

/**
 * A stored OTP verification record, as returned by the store's read paths.
 *
 * @public
 */
export interface OtpVerificationRecord {
  /** The scrypt hash of the OTP — never the plain OTP. */
  hashedOtp: string
  /** Verification attempts made against this record so far. */
  attempts: number
  /** When this record was created, for the expiry check. */
  issuedAt: Date
}

/**
 * The outcome of {@link OtpVerificationStore.create}. On `'conflict'` the
 * existing record is returned too, so `issueOtp` can tell an expired
 * leftover (which it clears and retries) from a genuinely live OTP.
 *
 * @public
 */
export type CreateOtpRecordResult = { status: 'created' } | { status: 'conflict'; existing: OtpVerificationRecord }

/**
 * Storage for OTP verification records, injected into {@link createOtpAuth}.
 *
 * The `identifier` passed to every method is an opaque string minted by the
 * package (it encodes `[normalizedEmail, codeChallenge]`, and doubles as
 * the scrypt salt) — treat it as an opaque primary key, never construct or
 * parse it.
 *
 * There is no `delete` method: deletion only ever happens as a side effect
 * of an expiry check or a successful {@link OtpVerificationStore.consume},
 * which is why both are shaped as atomic read-and-delete operations rather
 * than a separate `delete` a caller could get the ordering of wrong.
 *
 * `issueOtp` self-heals an expired leftover record on conflict, so a stale
 * row does not permanently block re-issue for its identifier. It does not,
 * however, delete records that are simply never submitted and never
 * re-issued — nothing triggers a check on those. Give your adapter its own
 * cleanup for abandoned records (a scheduled job that deletes rows past
 * their expiry, or a native TTL if your store has one — e.g. a Postgres
 * partial index plus a cron, or Redis `EXPIRE`), or rows accumulate
 * without bound.
 *
 * @public
 */
export interface OtpVerificationStore {
  /**
   * Create a new record. Returns `{ status: 'conflict', existing }` instead
   * of throwing when a record already exists for `identifier` (this email
   * has already used this PKCE challenge).
   *
   * Returning the `existing` record on conflict is what lets `issueOtp`
   * distinguish an expired leftover — which it consumes and retries, so a
   * stale row cannot permanently block re-issue for that identifier — from
   * a live OTP that was genuinely issued moments ago.
   */
  create(record: { identifier: string; hashedOtp: string; issuedAt: Date }): Promise<CreateOtpRecordResult>

  /**
   * Atomically increment `attempts` and return the resulting record, or
   * `null` if no record exists for `identifier`.
   *
   * Must be a single atomic operation (e.g. a database
   * `UPDATE ... SET attempts = attempts + 1`), not a read-then-write — concurrent requests
   * that each read-then-write can each pass an attempt-cap check before any
   * of them commits, giving an attacker free attempts under load.
   */
  incrementAttempts(identifier: string): Promise<OtpVerificationRecord | null>

  /**
   * Delete the record for `identifier` as a claim on it, but only if its
   * current `hashedOtp` still matches `expectedHashedOtp` — the value from
   * the {@link OtpVerificationStore.incrementAttempts} (or
   * {@link OtpVerificationStore.create}) call this claim is based on.
   * Returns whether this call was the one that deleted it.
   *
   * The `expectedHashedOtp` check exists to close a narrower race than the
   * one `incrementAttempts` guards against: if the record this call is
   * claiming was deleted (by a concurrent expiry or attempt-cap cleanup)
   * and a *new* OTP was issued and stored under the same `identifier`
   * before this call runs, an unconditional `DELETE WHERE identifier = ?`
   * would delete that unrelated new record instead — silently invalidating
   * someone else's freshly issued, unverified OTP. Matching on the hash too
   * ensures this call only ever deletes the exact record it validated.
   *
   * Must be atomic (e.g. a database
   * `DELETE ... WHERE identifier = ? AND otp = ? RETURNING`) so that if two
   * concurrent verifications both pass validation, exactly one gets `true`
   * and the other gets `false` — the loser must be treated as a failure,
   * not a race it happened to lose harmlessly.
   */
  consume(identifier: string, expectedHashedOtp: string): Promise<boolean>
}

/**
 * Sends a one-time password to its recipient (email, SMS, …). The plain OTP
 * only ever reaches this function — it is never returned from `issueOtp`.
 *
 * @public
 */
export type SendOtp = (args: { normalizedEmail: string; otp: string; otpPrefix: string }) => Promise<void>

/**
 * Options for {@link createOtpAuth}.
 *
 * Every numeric option is range-checked at construction: an out-of-range
 * value throws `OtpOptionsError` rather than being silently clamped, so a
 * misconfiguration surfaces on first call instead of quietly weakening
 * every OTP the service issues.
 *
 * @public
 */
export interface CreateOtpAuthOptions {
  /** Storage for verification records. See {@link OtpVerificationStore}. */
  store: OtpVerificationStore
  /** Delivers the plain OTP to its recipient. See {@link SendOtp}. */
  sendOtp: SendOtp
  /**
   * OTP length in characters, from a 32-character unambiguous alphabet.
   * Minimum 8, no maximum — longer is only ever more secure. Defaults to 8.
   */
  otpLength?: number
  /**
   * How long an issued OTP remains valid, in seconds. Must be between 1 and
   * 600; the ceiling is NIST SP 800-63B's "SHALL be considered invalid if
   * not completed within 10 minutes". Defaults to 600.
   */
  otpExpirySeconds?: number
  /**
   * Verification attempts allowed per issued OTP before it is invalidated.
   * Must be between 1 and 10. Defaults to 5.
   */
  maxAttempts?: number
  /**
   * Length of the separately-generated OTP prefix shown to the user as a
   * "this is your code" confirmation. Must be between 2 and 6. Defaults
   * to 3.
   *
   * This is not a slice of the OTP itself — it is generated independently,
   * so displaying it never reduces the OTP's own entropy.
   */
  otpPrefixLength?: number
}

/**
 * The OTP issue/verify pair returned by {@link createOtpAuth}. Neither
 * function ever throws — both resolve to an {@link OtpResult}, in the shape
 * of Zod's `safeParse`. Check `result.success` (or use it as a type guard)
 * rather than wrapping calls in `try`/`catch`.
 *
 * Both take `normalizedEmail`, not `email`: this package uses the value
 * verbatim as half of the record's primary key and scrypt salt, and never
 * normalizes it. Lowercase (and otherwise canonicalize) the address on the
 * way in — the same way, at both issue and verify time — or the two calls
 * will not resolve to the same record. See the README.
 *
 * @public
 */
export interface OtpAuth {
  /**
   * Issue a new OTP for `normalizedEmail`, bound to `codeChallenge` (see
   * `@opengovsg/auth/pkce`), and hand it to `sendOtp` for delivery.
   *
   * On success, `data` is only `{ otpPrefix }` — a confirmation value, not
   * the OTP itself. The plain OTP is never in this function's return value;
   * it exists only as an argument to `sendOtp`.
   *
   * On failure, `error.code` is `'challenge_invalid'` (the challenge is not
   * a canonical S256 digest), `'challenge_conflict'` (a live, unexpired OTP
   * already exists for this pair — mint a fresh verifier), or
   * `'unexpected'` (your `store` or `sendOtp` threw; see `error.cause`).
   * A conflict against an *expired* record is not an error: that record is
   * consumed and issuing retried automatically.
   */
  issueOtp(args: { normalizedEmail: string; codeChallenge: string }): Promise<OtpResult<{ otpPrefix: string }>>

  /**
   * Verify a submitted OTP against the record for `normalizedEmail` +
   * `codeVerifier`'s derived challenge, and consume it on success.
   *
   * `otp` is trimmed and length-checked before any hashing happens, so
   * surrounding whitespace from a copy-paste verifies successfully and a
   * wrong-length guess is rejected without spending a scrypt call.
   *
   * On failure, `error.code` is one of: no matching record, expired,
   * attempt cap exceeded, wrong code, the record already consumed by a
   * concurrent request, or — if `store` threw — `'unexpected'` (see
   * {@link OtpResult}). All of these carry the same generic
   * `error.message` — branch on `error.code`, never show `error.message`
   * verbatim plus a distinct explanation to the end user.
   * `error.attemptCount` is set for every code except
   * `not_found`/`unexpected`, for your own logging.
   */
  verifyOtp(args: {
    normalizedEmail: string
    otp: string
    codeVerifier: string
  }): Promise<OtpResult<{ normalizedEmail: string }>>
}
