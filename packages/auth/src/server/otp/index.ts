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
  OTP_LENGTH_RANGE,
  OTP_PREFIX_ALPHABET,
  OTP_PREFIX_LENGTH_RANGE,
} from '../../otp/constants.js'
import { OtpVerificationError } from '../../otp/errors.js'
import { createPkceChallenge } from '../../pkce/index.js'
import { createIdentifier, hashToken, isValidTokenHash } from './hashing.js'
import type { CreateOtpAuthOptions, OtpAuth } from './types.js'

export { OTP_DEFAULTS } from '../../otp/constants.js'
export type { OtpResult, OtpVerificationErrorCode } from '../../otp/errors.js'
export { OtpVerificationError } from '../../otp/errors.js'
export type { CreateOtpAuthOptions, OtpAuth, SendOtp, VerificationTokenStore } from './types.js'

function clampMin(value: number, min: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.trunc(value))
}

function clampRange(value: number, { min, max }: { min: number; max: number }, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function toInt(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : fallback
}

/**
 * Create an OTP issue/verify pair: generation, scrypt hashing, and a verify
 * sequence that enforces expiry, an atomic attempt cap, a timing-safe
 * compare, and one-time use — in that order, since reordering any one of
 * them reopens a known attack (see the storage-adapter README section).
 *
 * Neither returned function ever throws. See {@link OtpResult}.
 *
 * @public
 */
export function createOtpAuth(options: CreateOtpAuthOptions): OtpAuth {
  const { store, sendOtp } = options
  const otpLength = clampMin(options.otpLength ?? OTP_DEFAULTS.otpLength, OTP_LENGTH_RANGE.min, OTP_DEFAULTS.otpLength)
  const otpExpirySeconds = toInt(
    options.otpExpirySeconds ?? OTP_DEFAULTS.otpExpirySeconds,
    OTP_DEFAULTS.otpExpirySeconds,
  )
  const maxAttempts = clampRange(
    options.maxAttempts ?? OTP_DEFAULTS.maxAttempts,
    MAX_ATTEMPTS_RANGE,
    OTP_DEFAULTS.maxAttempts,
  )
  const otpPrefixLength = clampRange(
    options.otpPrefixLength ?? OTP_DEFAULTS.otpPrefixLength,
    OTP_PREFIX_LENGTH_RANGE,
    OTP_DEFAULTS.otpPrefixLength,
  )

  const generateOtp = customAlphabet(OTP_ALPHABET, otpLength)
  const generateOtpPrefix = customAlphabet(OTP_PREFIX_ALPHABET, otpPrefixLength)

  function isExpired(issuedAt: Date): boolean {
    return Date.now() - issuedAt.getTime() > otpExpirySeconds * 1000
  }

  function toUnexpected(cause: unknown): OtpVerificationError {
    return cause instanceof OtpVerificationError ? cause : new OtpVerificationError('unexpected', { cause })
  }

  return {
    async issueOtp({ email, codeChallenge }) {
      try {
        const identifier = createIdentifier(email, codeChallenge)
        const otp = generateOtp()
        const otpPrefix = generateOtpPrefix()
        const hashedToken = hashToken(otp, identifier)

        const result = await store.create({ identifier, hashedToken, issuedAt: new Date() })
        if (result === 'conflict') {
          return { success: false, error: new OtpVerificationError('invalid') }
        }

        await sendOtp({ email, otp, otpPrefix })
        return { success: true, data: { otpPrefix } }
      } catch (cause) {
        return { success: false, error: toUnexpected(cause) }
      }
    },

    async verifyOtp({ email, token, codeVerifier }) {
      try {
        const codeChallenge = await createPkceChallenge(codeVerifier)
        const identifier = createIdentifier(email, codeChallenge)

        // Increment before validating anything else: the count must commit
        // regardless of outcome, or concurrent guesses can each pass the cap
        // check before any of them is recorded.
        const record = await store.incrementAttempts(identifier)
        if (!record) {
          return { success: false, error: new OtpVerificationError('not_found') }
        }

        if (isExpired(record.issuedAt)) {
          await store.consume(identifier)
          return { success: false, error: new OtpVerificationError('expired') }
        }

        if (record.attempts > maxAttempts) {
          await store.consume(identifier)
          return { success: false, error: new OtpVerificationError('too_many_attempts') }
        }

        if (!isValidTokenHash(hashToken(token, identifier), record.hashedToken)) {
          return { success: false, error: new OtpVerificationError('invalid') }
        }

        const consumed = await store.consume(identifier)
        if (!consumed) {
          // A concurrent verification already consumed this record between
          // our hash check and our delete — someone else won the race.
          return { success: false, error: new OtpVerificationError('token_reused') }
        }

        return { success: true, data: { email } }
      } catch (cause) {
        return { success: false, error: toUnexpected(cause) }
      }
    },
  }
}
