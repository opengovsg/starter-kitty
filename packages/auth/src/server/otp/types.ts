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
   * Delete the record for `identifier` as a claim on it, returning whether
   * this call was the one that deleted it.
   *
   * Must be atomic (e.g. a database `DELETE ... RETURNING`) so that if two
   * concurrent verifications both pass validation, exactly one gets `true`
   * and the other gets `false` — the loser must be treated as a failure,
   * not a race it happened to lose harmlessly.
   */
  consume(identifier: string): Promise<boolean>
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
   * Clamped to 6-12. Defaults to 8.
   */
  otpLength?: number
  /**
   * How long an issued OTP remains valid, in seconds. Clamped to 60-1800
   * (1-30 minutes). Defaults to 600 (10 minutes).
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
 * The OTP issue/verify pair returned by {@link createOtpAuth}.
 *
 * @public
 */
export interface OtpAuth {
  /**
   * Issue a new OTP for `email`, bound to `codeChallenge` (see
   * `@opengovsg/auth/pkce`), and hand it to `sendOtp` for delivery.
   *
   * Returns only `otpPrefix` — a confirmation value, not the OTP itself. The
   * plain OTP is never in this function's return value; it exists only as
   * an argument to `sendOtp`.
   *
   * Throws whatever `store.create` or `sendOtp` throw. A `'conflict'` from
   * the store (this `codeChallenge` was already used for this `email`) is
   * surfaced as an `OtpVerificationError` with code `'invalid'`.
   */
  issueOtp(args: { email: string; codeChallenge: string }): Promise<{ otpPrefix: string }>

  /**
   * Verify a submitted OTP against the record for `email` +
   * `codeVerifier`'s derived challenge, and consume it on success.
   *
   * Throws {@link OtpVerificationError} for every failure mode: no matching
   * record, expired, attempt cap exceeded, wrong code, or the record already
   * consumed by a concurrent request. All carry the same generic message —
   * branch on `error.code`, never show `error.message` verbatim plus a
   * distinct explanation to the end user.
   */
  verifyOtp(args: { email: string; token: string; codeVerifier: string }): Promise<{ email: string }>
}
