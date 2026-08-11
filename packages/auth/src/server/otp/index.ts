/**
 * The server-side OTP issue/verify orchestration: the sequence in which
 * expiry, attempt-count, and hash checks must run to close the timing,
 * brute-force, and replay attacks a naive implementation reopens. See the
 * package README for the storage adapter you need to write, and
 * `@opengovsg/auth/pkce` for binding an OTP to the session that requested
 * it.
 *
 * @packageDocumentation
 */

import { customAlphabet } from 'nanoid'

import {
  MAX_ATTEMPTS_RANGE,
  OTP_ALPHABET,
  OTP_DEFAULTS,
  OTP_EXPIRY_SECONDS_RANGE,
  OTP_LENGTH_RANGE,
  OTP_PREFIX_ALPHABET,
  OTP_PREFIX_LENGTH_RANGE,
} from '../../otp/constants.js'
import { OtpVerificationError } from '../../otp/errors.js'
import { createPkceChallenge } from '../../pkce/index.js'
import { createIdentifier, hashToken, isValidTokenHash } from './hashing.js'
import type { CreateOtpAuthOptions, OtpAuth } from './types.js'

export { OTP_DEFAULTS } from '../../otp/constants.js'
export type { OtpVerificationErrorCode } from '../../otp/errors.js'
export { OtpVerificationError } from '../../otp/errors.js'
export type { CreateOtpAuthOptions, OtpAuth, SendOtp, VerificationTokenStore } from './types.js'

function clamp(value: number, { min, max }: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * Create an OTP issue/verify pair: generation, scrypt hashing, and a verify
 * sequence that enforces expiry, an atomic attempt cap, a timing-safe
 * compare, and one-time use — in that order, since reordering any one of
 * them reopens a known attack (see the storage-adapter README section).
 *
 * @public
 */
export function createOtpAuth(options: CreateOtpAuthOptions): OtpAuth {
  const { store, sendOtp } = options
  const otpLength = clamp(options.otpLength ?? OTP_DEFAULTS.otpLength, OTP_LENGTH_RANGE)
  const otpExpirySeconds = clamp(options.otpExpirySeconds ?? OTP_DEFAULTS.otpExpirySeconds, OTP_EXPIRY_SECONDS_RANGE)
  const maxAttempts = clamp(options.maxAttempts ?? OTP_DEFAULTS.maxAttempts, MAX_ATTEMPTS_RANGE)
  const otpPrefixLength = clamp(options.otpPrefixLength ?? OTP_DEFAULTS.otpPrefixLength, OTP_PREFIX_LENGTH_RANGE)

  const generateOtp = customAlphabet(OTP_ALPHABET, otpLength)
  const generateOtpPrefix = customAlphabet(OTP_PREFIX_ALPHABET, otpPrefixLength)

  function isExpired(issuedAt: Date): boolean {
    return Date.now() - issuedAt.getTime() > otpExpirySeconds * 1000
  }

  return {
    async issueOtp({ email, codeChallenge }) {
      const identifier = createIdentifier(email, codeChallenge)
      const otp = generateOtp()
      const otpPrefix = generateOtpPrefix()
      const hashedToken = hashToken(otp, identifier)

      const result = await store.create({ identifier, hashedToken, issuedAt: new Date() })
      if (result === 'conflict') {
        throw new OtpVerificationError('invalid')
      }

      await sendOtp({ email, otp, otpPrefix })
      return { otpPrefix }
    },

    async verifyOtp({ email, token, codeVerifier }) {
      const codeChallenge = await createPkceChallenge(codeVerifier)
      const identifier = createIdentifier(email, codeChallenge)

      // Increment before validating anything else: the count must commit
      // regardless of outcome, or concurrent guesses can each pass the cap
      // check before any of them is recorded.
      const record = await store.incrementAttempts(identifier)
      if (!record) {
        throw new OtpVerificationError('not_found')
      }

      if (isExpired(record.issuedAt)) {
        await store.consume(identifier)
        throw new OtpVerificationError('expired')
      }

      if (record.attempts > maxAttempts) {
        await store.consume(identifier)
        throw new OtpVerificationError('too_many_attempts')
      }

      if (!isValidTokenHash(hashToken(token, identifier), record.hashedToken)) {
        throw new OtpVerificationError('invalid')
      }

      const consumed = await store.consume(identifier)
      if (!consumed) {
        // A concurrent verification already consumed this record between
        // our hash check and our delete — someone else won the race.
        throw new OtpVerificationError('token_reused')
      }

      return { email }
    },
  }
}
