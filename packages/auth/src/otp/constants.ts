/**
 * Default configuration for the `createOtpAuth` factory
 * (`@opengovsg/auth/server/otp`). Every option is range-checked at
 * construction. An out-of-range value throws {@link OtpOptionsError} rather
 * than being silently clamped. See {@link OTP_LENGTH_RANGE},
 * {@link OTP_EXPIRY_SECONDS_RANGE}, {@link MAX_ATTEMPTS_RANGE} and
 * {@link OTP_PREFIX_LENGTH_RANGE}.
 *
 * @public
 */
export const OTP_DEFAULTS = {
  otpLength: 8,
  otpExpirySeconds: 600,
  maxAttempts: 5,
  otpPrefixLength: 3,
} as const

/**
 * Accepted range for `otpLength`. No upper bound: a longer OTP is only ever
 * more secure. The lower bound keeps a 5-attempt cap meaningfully hard to
 * brute-force. 8 characters from this 32-character alphabet is 40 bits.
 *
 * @public
 */
export const OTP_LENGTH_RANGE = { min: 8 } as const

/**
 * Accepted range for `otpExpirySeconds`. The upper bound is the NIST SP
 * 800-63B ceiling: "the authentication SHALL be considered invalid if not
 * completed within 10 minutes". The lower bound only rules out zero and
 * negative values, which would expire every OTP the instant it was issued.
 *
 * @public
 */
export const OTP_EXPIRY_SECONDS_RANGE = { min: 1, max: 600 } as const

/**
 * Accepted range for `maxAttempts`.
 *
 * @public
 */
export const MAX_ATTEMPTS_RANGE = { min: 1, max: 10 } as const

/**
 * Accepted range for `otpPrefixLength`.
 *
 * @public
 */
export const OTP_PREFIX_LENGTH_RANGE = { min: 2, max: 6 } as const

// Ambiguous characters (0/O, 1/I) removed so a user reading the code off an
// email doesn't mistype it.
export const OTP_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const OTP_PREFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

/** The message every {@link OtpVerificationError} carries, regardless of `code`. */
export const GENERIC_AUTH_ERROR_MESSAGE = 'Invalid or expired authentication session'
