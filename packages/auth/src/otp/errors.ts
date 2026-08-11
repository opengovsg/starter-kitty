import { GENERIC_AUTH_ERROR_MESSAGE } from './constants.js'

/**
 * The reason an OTP verification attempt failed.
 *
 * Every value maps to the same user-facing `OtpVerificationError.message` —
 * the distinction exists for the caller's own branching (e.g. mapping
 * `too_many_attempts` to an HTTP 429 and everything else to a 401), not for
 * disclosure to the end user. Showing a distinct message per code lets an
 * attacker enumerate emails or learn which step of verification they passed.
 *
 * @public
 */
export type OtpVerificationErrorCode =
  | 'not_found'
  | 'expired'
  | 'too_many_attempts'
  | 'invalid'
  | 'token_reused'
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
   * `expired | too_many_attempts | invalid | token_reused` — the codes
   * `verifyOtp` reaches only after a record was found and its attempts
   * incremented. `undefined` for `not_found` (no record ever existed to
   * count attempts on) and `unexpected` (the failure may have happened
   * before an attempt count was known). Not part of `message` — this is
   * for your own logging/metrics, never for display to the end user.
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
