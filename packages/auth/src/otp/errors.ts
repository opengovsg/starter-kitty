import { GENERIC_AUTH_ERROR_MESSAGE } from './constants.js'

/**
 * The reason an OTP issue or verification attempt failed.
 *
 * The verify-path codes (`not_found`, `expired`, `too_many_attempts`,
 * `invalid`, `otp_reused`) all map to the same user-facing
 * `OtpVerificationError.message` — the distinction exists for the caller's
 * own branching (e.g. mapping `too_many_attempts` to an HTTP 429 and the
 * rest to a 401), not for disclosure to the end user. Showing a distinct
 * message per verify code lets an attacker enumerate emails or learn which
 * step of verification they passed.
 *
 * The issue-path codes (`challenge_invalid`, `challenge_conflict`) are safe
 * to disambiguate for the client, since the client generated the challenge
 * itself and learns nothing about any other user from the distinction.
 *
 * @public
 */
export type OtpVerificationErrorCode =
  /** No record matched: wrong email, wrong verifier, or already consumed. */
  | 'not_found'
  /** The record's `otpExpirySeconds` window has elapsed. */
  | 'expired'
  /** `maxAttempts` exceeded for this record. */
  | 'too_many_attempts'
  /** The submitted OTP did not match. */
  | 'invalid'
  /** A concurrent `verifyOtp` consumed this record first. */
  | 'otp_reused'
  /**
   * `issueOtp` was given a `codeChallenge` that is not a canonical
   * base64url-encoded SHA-256 digest, so no OTP issued under it could ever
   * be verified. Mint the challenge with `createPkceChallenge`.
   */
  | 'challenge_invalid'
  /**
   * `issueOtp` found a live, unexpired OTP already issued for this
   * `(normalizedEmail, codeChallenge)` pair. Mint a fresh verifier and
   * challenge rather than reusing this one.
   */
  | 'challenge_conflict'
  /**
   * Your injected `store` or `sendOtp` threw. The original error is on
   * {@link OtpVerificationError.cause}, for logging — it is never part of
   * `message`, which stays the same generic string as every other code.
   */
  | 'unexpected'

/**
 * Carried as the `error` of a failed {@link OtpResult} for every OTP failure
 * mode. Never thrown by the `createOtpAuth` factory's `issueOtp`/`verifyOtp`
 * (`@opengovsg/auth/server/otp`) — it is a plain value, not a control-flow
 * exception. (It still extends `Error` for a useful stack trace and so
 * `instanceof` checks work if you choose to throw it yourself.)
 *
 * @public
 */
export class OtpVerificationError extends Error {
  readonly code: OtpVerificationErrorCode

  /**
   * The record's attempt count at the point this error occurred, for
   * `expired | too_many_attempts | invalid | otp_reused` — the codes
   * `verifyOtp` reaches only after a record was found and its attempts
   * incremented. `undefined` for every other code: `not_found` (no record
   * existed to count attempts on), the issue-path codes (no attempt has
   * been made yet), and `unexpected` (the failure may have happened before
   * an attempt count was known). Not part of `message` — this is for your
   * own logging/metrics, never for display to the end user.
   */
  readonly attemptCount?: number

  constructor(code: OtpVerificationErrorCode, options?: { cause?: unknown; attemptCount?: number }) {
    super(GENERIC_AUTH_ERROR_MESSAGE, options)
    this.name = 'OtpVerificationError'
    this.code = code
    this.attemptCount = options?.attemptCount
  }
}

/**
 * Thrown by `createOtpAuth` when an option is outside its accepted range —
 * at construction time, not per request, so a misconfiguration fails on the
 * first call rather than silently weakening every OTP.
 *
 * This is the one thing in this package that throws: it signals a
 * programming error in your own wiring, not a runtime authentication
 * outcome, so it deliberately does not travel as an {@link OtpResult}.
 *
 * @public
 */
export class OtpOptionsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OtpOptionsError'
  }
}

/**
 * The outcome of `issueOtp`/`verifyOtp`: either `{ success: true, data }` or
 * `{ success: false, error }`, in the shape of Zod's `safeParse` result.
 * Neither function ever throws — check `success` (or use it as a type
 * guard) instead of wrapping calls in `try`/`catch`.
 *
 * This includes failures from your own injected `store` or `sendOtp` (a
 * database outage, for instance): they are caught and surfaced as
 * `{ success: false, error }` with `error.code === 'unexpected'` and
 * `error.cause` set to whatever was thrown, rather than propagating as an
 * exception.
 *
 * @public
 */
export type OtpResult<T> = { success: true; data: T } | { success: false; error: OtpVerificationError }
