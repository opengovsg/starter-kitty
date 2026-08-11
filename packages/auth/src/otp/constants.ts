/**
 * Default configuration for the `createOtpAuth` factory
 * (`@opengovsg/auth/server/otp`), and the range each option is clamped to.
 *
 * @public
 */
export const OTP_DEFAULTS = {
  otpLength: 8,
  otpExpirySeconds: 600,
  maxAttempts: 5,
  otpPrefixLength: 3,
} as const

export const OTP_LENGTH_RANGE = { min: 6, max: 12 } as const
export const OTP_EXPIRY_SECONDS_RANGE = { min: 60, max: 1800 } as const
export const MAX_ATTEMPTS_RANGE = { min: 1, max: 10 } as const
export const OTP_PREFIX_LENGTH_RANGE = { min: 2, max: 6 } as const

// Ambiguous characters (0/O, 1/I/L) removed so a user reading the code off an
// email doesn't mistype it.
export const OTP_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const OTP_PREFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

/** The message every {@link OtpVerificationError} carries, regardless of `code`. */
export const GENERIC_AUTH_ERROR_MESSAGE = 'Invalid or expired authentication session'
