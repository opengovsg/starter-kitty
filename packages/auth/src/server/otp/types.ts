import type { OtpResult } from '../../otp/errors.js'

/**
 * Storage for OTP verification records, injected into {@link createOtpAuth}.
 *
 * The `identifier` passed to every method is an opaque string minted by the
 * package (it encodes `[email, codeChallenge]`, and doubles as the scrypt
 * salt) — treat it as an opaque primary key, never construct or parse it.
 *
 * There is no `delete` method: deletion only ever happens as a side effect
 * of an expiry check or a successful {@link VerificationTokenStore.consume},
 * which is why both are shaped as atomic read-and-delete operations rather
 * than a separate `delete` a caller could get the ordering of wrong.
 *
 * A record whose OTP is never submitted is never deleted by this package —
 * expiry is only checked when `verifyOtp` is next called against it. Give
 * your adapter its own cleanup for abandoned records (a scheduled job that
 * deletes rows past their expiry, or a native TTL if your store has one —
 * e.g. a Postgres partial index plus a cron, or Redis `EXPIRE`), or rows
 * accumulate without bound.
 *
 * @public
 */
export interface VerificationTokenStore {
  /**
   * Create a new record. Returns `'conflict'` instead of throwing when a
   * record already exists for `identifier` (this email has already used
   * this PKCE challenge) — the caller decides how to surface that.
   */
  create(record: { identifier: string; hashedToken: string; issuedAt: Date }): Promise<'created' | 'conflict'>

  /**
   * Atomically increment `attempts` and return the resulting record, or
   * `null` if no record exists for `identifier`.
   *
   * Must be a single atomic operation (e.g. a database
   * `UPDATE ... SET attempts = attempts + 1`), not a read-then-write — concurrent requests
   * that each read-then-write can each pass an attempt-cap check before any
   * of them commits, giving an attacker free attempts under load.
   */
  incrementAttempts(identifier: string): Promise<{ hashedToken: string; attempts: number; issuedAt: Date } | null>

  /**
   * Delete the record for `identifier` as a claim on it, but only if its
   * current `hashedToken` still matches `expectedHashedToken` — the value
   * from the {@link VerificationTokenStore.incrementAttempts} call this
   * claim is based on. Returns whether this call was the one that deleted
   * it.
   *
   * The `expectedHashedToken` check exists to close a narrower race than
   * the one `incrementAttempts` guards against: if the record this call is
   * claiming was deleted (by a concurrent expiry or attempt-cap cleanup)
   * and a *new* OTP was issued and stored under the same `identifier`
   * before this call runs, an unconditional `DELETE WHERE identifier = ?`
   * would delete that unrelated new record instead — silently invalidating
   * someone else's freshly issued, unverified OTP. Matching on the hash too
   * ensures this call only ever deletes the exact record it validated.
   *
   * Must be atomic (e.g. a database
   * `DELETE ... WHERE identifier = ? AND token = ? RETURNING`) so that if
   * two concurrent verifications both pass validation, exactly one gets
   * `true` and the other gets `false` — the loser must be treated as a
   * failure, not a race it happened to lose harmlessly.
   */
  consume(identifier: string, expectedHashedToken: string): Promise<boolean>
}

/**
 * Sends a one-time password to its recipient (email, SMS, …). The plain OTP
 * only ever reaches this function — it is never returned from `issueOtp`.
 *
 * @public
 */
export type SendOtp = (args: { email: string; otp: string; otpPrefix: string }) => Promise<void>

/**
 * Options for {@link createOtpAuth}.
 *
 * @public
 */
export interface CreateOtpAuthOptions {
  /** Storage for verification records. See {@link VerificationTokenStore}. */
  store: VerificationTokenStore
  /** Delivers the plain OTP to its recipient. See {@link SendOtp}. */
  sendOtp: SendOtp
  /**
   * OTP length in characters, from a 32-character unambiguous alphabet.
   * Clamped to a minimum of 8 (no maximum — longer is only ever more
   * secure). Defaults to 8.
   */
  otpLength?: number
  /**
   * How long an issued OTP remains valid, in seconds. Not clamped — unlike
   * OTP length, no direction is unconditionally safer, so this is left
   * entirely to your risk profile. Defaults to 60 (1 minute).
   */
  otpExpirySeconds?: number
  /**
   * Verification attempts allowed per issued OTP before it is invalidated.
   * Clamped to 1-10. Defaults to 5.
   */
  maxAttempts?: number
  /**
   * Length of the separately-generated OTP prefix shown to the user as a
   * "this is your code" confirmation. Clamped to 2-6. Defaults to 3.
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
 * @public
 */
export interface OtpAuth {
  /**
   * Issue a new OTP for `email`, bound to `codeChallenge` (see
   * `@opengovsg/auth/pkce`), and hand it to `sendOtp` for delivery.
   *
   * On success, `data` is only `{ otpPrefix }` — a confirmation value, not
   * the OTP itself. The plain OTP is never in this function's return value;
   * it exists only as an argument to `sendOtp`.
   *
   * A `'conflict'` from the store (this `codeChallenge` was already used
   * for this `email`) surfaces as `error.code === 'invalid'`. If `store`
   * or `sendOtp` throws, that is caught and surfaced as
   * `error.code === 'unexpected'` with `error.cause` set to what was
   * thrown — this function itself still never throws.
   */
  issueOtp(args: { email: string; codeChallenge: string }): Promise<OtpResult<{ otpPrefix: string }>>

  /**
   * Verify a submitted OTP against the record for `email` +
   * `codeVerifier`'s derived challenge, and consume it on success.
   *
   * On failure, `error.code` is one of: no matching record, expired,
   * attempt cap exceeded, wrong code, the record already consumed by a
   * concurrent request, or — if `store` threw — `'unexpected'` (see
   * {@link OtpResult}). All carry the same generic `error.message` —
   * branch on `error.code`, never show `error.message` verbatim plus a
   * distinct explanation to the end user. `error.attemptCount` is set for
   * every code except `not_found`/`unexpected`, for your own logging.
   */
  verifyOtp(args: { email: string; token: string; codeVerifier: string }): Promise<OtpResult<{ email: string }>>
}
