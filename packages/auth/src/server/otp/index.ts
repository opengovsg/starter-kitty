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
import { OtpOptionsError, OtpVerificationError } from '../../otp/errors.js'
import { PKCE_VERIFIER_ALPHABET, PKCE_VERIFIER_LENGTH_RANGE } from '../../pkce/constants.js'
import { createPkceChallenge, isValidCodeChallenge } from '../../pkce/index.js'
import { createIdentifier, hashOtp, isValidOtpHash } from './hashing.js'
import type { CreateOtpAuthOptions, OtpAuth, OtpVerificationRecord } from './types.js'

export {
  MAX_ATTEMPTS_RANGE,
  OTP_DEFAULTS,
  OTP_EXPIRY_SECONDS_RANGE,
  OTP_LENGTH_RANGE,
  OTP_PREFIX_LENGTH_RANGE,
} from '../../otp/constants.js'
export type { OtpResult, OtpVerificationErrorCode } from '../../otp/errors.js'
export { OtpOptionsError, OtpVerificationError } from '../../otp/errors.js'
export type {
  CreateOtpAuthOptions,
  CreateOtpRecordResult,
  OtpAuth,
  OtpVerificationRecord,
  OtpVerificationStore,
  SendOtp,
} from './types.js'

/**
 * Range-check an option at construction time. Throws rather than clamping:
 * a silently-corrected `maxAttempts: 100` would weaken every OTP the
 * service issues without anyone noticing, whereas a throw surfaces on the
 * very first call.
 */
function requireInRange(name: string, value: number, { min, max }: { min: number; max?: number }): number {
  if (!Number.isInteger(value)) {
    throw new OtpOptionsError(`${name} must be an integer, received ${String(value)}`)
  }
  if (value < min || (max !== undefined && value > max)) {
    const bound = max === undefined ? `at least ${min}` : `between ${min} and ${max}`
    throw new OtpOptionsError(`${name} must be ${bound}, received ${String(value)}`)
  }
  return value
}

const VERIFIER_CHARSET = new Set(PKCE_VERIFIER_ALPHABET)

function isWellFormedVerifier(codeVerifier: string): boolean {
  // The RFC's whole 43-128 range, not just the length createPkceVerifier
  // mints. A caller may bring a compliant verifier from elsewhere, and
  // createPkceChallenge hashes any string, so a narrower gate here would
  // issue an OTP that could never be verified.
  if (codeVerifier.length < PKCE_VERIFIER_LENGTH_RANGE.min) return false
  if (codeVerifier.length > PKCE_VERIFIER_LENGTH_RANGE.max) return false
  for (const char of codeVerifier) {
    if (!VERIFIER_CHARSET.has(char)) return false
  }
  return true
}

/**
 * Adapters are plain user code, and an ORM that hands back a timestamp
 * string instead of a `Date` would otherwise fail deep inside the expiry
 * arithmetic as a silent `NaN` comparison, which evaluates false, so every
 * OTP would read as unexpired. Fail loudly and specifically instead.
 */
function toIssuedAtMs(issuedAt: Date, source: string): number {
  const ms = issuedAt instanceof Date ? issuedAt.getTime() : Number.NaN
  if (!Number.isFinite(ms)) {
    throw new TypeError(
      `${source} returned an invalid issuedAt (expected a valid Date, received ${
        issuedAt === null ? 'null' : typeof issuedAt
      }). Adapters must map their storage column to a Date.`,
    )
  }
  return ms
}

/**
 * Create an OTP issue/verify pair: generation, scrypt hashing, and a verify
 * sequence that enforces expiry, an atomic attempt cap, a timing-safe
 * compare, and one-time use, in that order. Reordering any one of them
 * reopens a known attack (see the storage-adapter README section).
 *
 * Neither returned function ever throws. See {@link OtpResult}.
 *
 * Throws {@link OtpOptionsError} if any option is outside its accepted
 * range. That is a construction-time programming error, not a runtime
 * outcome.
 *
 * @public
 */
export function createOtpAuth(options: CreateOtpAuthOptions): OtpAuth {
  const { store, sendOtp } = options
  const otpLength = requireInRange('otpLength', options.otpLength ?? OTP_DEFAULTS.otpLength, OTP_LENGTH_RANGE)
  const otpExpirySeconds = requireInRange(
    'otpExpirySeconds',
    options.otpExpirySeconds ?? OTP_DEFAULTS.otpExpirySeconds,
    OTP_EXPIRY_SECONDS_RANGE,
  )
  const maxAttempts = requireInRange('maxAttempts', options.maxAttempts ?? OTP_DEFAULTS.maxAttempts, MAX_ATTEMPTS_RANGE)
  const otpPrefixLength = requireInRange(
    'otpPrefixLength',
    options.otpPrefixLength ?? OTP_DEFAULTS.otpPrefixLength,
    OTP_PREFIX_LENGTH_RANGE,
  )

  const generateOtp = customAlphabet(OTP_ALPHABET, otpLength)
  const generateOtpPrefix = customAlphabet(OTP_PREFIX_ALPHABET, otpPrefixLength)

  function isExpired(record: OtpVerificationRecord, source: string): boolean {
    // Inclusive: at exactly otpExpirySeconds the OTP is already expired, so
    // the documented lifetime is the real one and the NIST ceiling is not
    // exceeded by a millisecond.
    return Date.now() - toIssuedAtMs(record.issuedAt, source) >= otpExpirySeconds * 1000
  }

  return {
    async issueOtp({ normalizedEmail, codeChallenge }) {
      const identifier = createIdentifier(normalizedEmail, codeChallenge)
      try {
        // Reject a malformed challenge before hashing/storing/sending.
        // verifyOtp can only ever derive a canonical 43-char S256 challenge,
        // so an OTP stored under anything else could never be verified.
        if (!isValidCodeChallenge(codeChallenge)) {
          return { success: false, error: new OtpVerificationError('challenge_invalid') }
        }

        const otp = generateOtp()
        const otpPrefix = generateOtpPrefix()
        const hashedOtp = await hashOtp(otp, identifier)

        let created = await store.create({ identifier, hashedOtp, issuedAt: new Date() })

        if (created.status === 'conflict') {
          // An expired leftover must not permanently block re-issue for
          // this identifier, so clear it and retry once. A *live* record is
          // a real conflict: re-issuing would silently invalidate an OTP
          // the user may be about to type in.
          if (!isExpired(created.existing, 'store.create')) {
            return { success: false, error: new OtpVerificationError('challenge_conflict') }
          }
          await store.consume(identifier, created.existing.hashedOtp)
          created = await store.create({ identifier, hashedOtp, issuedAt: new Date() })
          if (created.status === 'conflict') {
            // Lost a race to a concurrent issue that recreated the record.
            return { success: false, error: new OtpVerificationError('challenge_conflict') }
          }
        }

        try {
          await sendOtp({ normalizedEmail, otp, otpPrefix })
        } catch (cause) {
          // Delivery failed after the record was created. Roll it back on
          // a best-effort basis, since a secondary failure here must not
          // mask the original one, so a retry with the same codeChallenge
          // re-issues instead of conflicting over an OTP the user never got.
          await store.consume(identifier, hashedOtp).catch(() => {})
          throw cause
        }

        return { success: true, data: { otpPrefix } }
      } catch (cause) {
        // Every failure from the injected store or sendOtp lands here as
        // 'unexpected', including one that happens to be an
        // OtpVerificationError instance thrown by a caller's own store.
        // This function's contract is that ANY dependency failure becomes
        // 'unexpected', with no exceptions.
        return { success: false, error: new OtpVerificationError('unexpected', { cause }) }
      }
    },

    async verifyOtp({ normalizedEmail, otp, codeVerifier }) {
      try {
        // Trim before anything else: a copy-pasted OTP often carries
        // surrounding whitespace, and without this it would hash to a
        // mismatch and burn one of the user's attempts.
        const submittedOtp = otp.trim()

        // Reject obviously-wrong shapes before spending a scrypt call.
        // Both inputs are attacker-controlled and scrypt is deliberately
        // expensive, so an unauthenticated caller must not be able to make
        // the server do that work with a value that could never match.
        // Deliberately checked BEFORE incrementAttempts, so malformed input
        // does not consume a legitimate session's attempt budget either.
        if (submittedOtp.length !== otpLength || !isWellFormedVerifier(codeVerifier)) {
          return { success: false, error: new OtpVerificationError('not_found') }
        }

        const codeChallenge = await createPkceChallenge(codeVerifier)
        const identifier = createIdentifier(normalizedEmail, codeChallenge)

        // Increment before validating anything else: the count must commit
        // regardless of outcome, or concurrent guesses can each pass the cap
        // check before any of them is recorded.
        const record = await store.incrementAttempts(identifier)
        if (!record) {
          return { success: false, error: new OtpVerificationError('not_found') }
        }

        if (isExpired(record, 'store.incrementAttempts')) {
          await store.consume(identifier, record.hashedOtp)
          return { success: false, error: new OtpVerificationError('expired', { attemptCount: record.attempts }) }
        }

        if (record.attempts > maxAttempts) {
          // Consuming here means the cap fires exactly once: the next
          // attempt finds no record and gets 'not_found'. See the README.
          // This is deliberate, so a locked-out record cannot be probed
          // repeatedly to confirm that an OTP was ever issued.
          await store.consume(identifier, record.hashedOtp)
          return {
            success: false,
            error: new OtpVerificationError('too_many_attempts', { attemptCount: record.attempts }),
          }
        }

        if (!isValidOtpHash(await hashOtp(submittedOtp, identifier), record.hashedOtp)) {
          return { success: false, error: new OtpVerificationError('invalid', { attemptCount: record.attempts }) }
        }

        // Pass the hash this specific check validated, not just the
        // identifier: if this exact record was already deleted (by a
        // concurrent expiry/attempt-cap cleanup) and a new OTP issued under
        // the same identifier before this call runs, an unconditional
        // delete-by-identifier would destroy that unrelated new record.
        // Matching on the hash too means this call can only ever claim the
        // record it validated.
        const consumed = await store.consume(identifier, record.hashedOtp)
        if (!consumed) {
          // A concurrent verification already consumed this record between
          // our hash check and our delete, so someone else won the race.
          return {
            success: false,
            error: new OtpVerificationError('otp_reused', { attemptCount: record.attempts }),
          }
        }

        return { success: true, data: { normalizedEmail } }
      } catch (cause) {
        return { success: false, error: new OtpVerificationError('unexpected', { cause }) }
      }
    },
  }
}
