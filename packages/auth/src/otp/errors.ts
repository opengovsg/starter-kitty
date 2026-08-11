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
export type OtpVerificationErrorCode = 'not_found' | 'expired' | 'too_many_attempts' | 'invalid' | 'token_reused'

/**
 * Thrown by the `createOtpAuth` factory's `verifyOtp`
 * (`@opengovsg/auth/server/otp`) for every failure mode.
 *
 * @public
 */
export class OtpVerificationError extends Error {
  readonly code: OtpVerificationErrorCode

  constructor(code: OtpVerificationErrorCode) {
    super(GENERIC_AUTH_ERROR_MESSAGE)
    this.name = 'OtpVerificationError'
    this.code = code
  }
}
