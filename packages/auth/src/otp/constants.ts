/**
 * Default configuration for the `createOtpAuth` factory
 * (`@opengovsg/auth/server/otp`). `otpLength` is clamped to a minimum of 8;
 * `maxAttempts` to 1-10; `otpPrefixLength` to 2-6. `otpExpirySeconds` is not
 * clamped.
 *
 * @public
 */
export const OTP_DEFAULTS = {
  otpLength: 8,
  otpExpirySeconds: 60,
  maxAttempts: 5,
  otpPrefixLength: 3,
} as const

// No upper bound: a longer OTP is only ever more secure, never a problem to
// clamp away. The lower bound keeps a 5-attempt cap meaningfully hard to
// brute-force — 8 characters from this 32-character alphabet is 40 bits.
export const OTP_LENGTH_RANGE = { min: 8 } as const

// otpExpirySeconds is intentionally unclamped: unlike OTP length, there is
// no direction that is unconditionally safer, so the choice is left
// entirely to the caller's risk profile.

export const MAX_ATTEMPTS_RANGE = { min: 1, max: 10 } as const
export const OTP_PREFIX_LENGTH_RANGE = { min: 2, max: 6 } as const

// Ambiguous characters (0/O, 1/I) removed so a user reading the code off an
// email doesn't mistype it.
export const OTP_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const OTP_PREFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

/** The message every {@link OtpVerificationError} carries, regardless of `code`. */
export const GENERIC_AUTH_ERROR_MESSAGE = 'Invalid or expired authentication session'
