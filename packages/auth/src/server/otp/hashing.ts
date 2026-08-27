import { scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

const SCRYPT_KEYLEN = 64

/**
 * The record's primary key, doubling as the scrypt salt for its OTP hash.
 *
 * A JSON array, not a concatenation: `normalizedEmail + codeChallenge` is
 * ambiguous (`"ab" + "c" === "a" + "bc"`);
 * `JSON.stringify([normalizedEmail, codeChallenge])` is not.
 *
 * `normalizedEmail` is used verbatim. This package does not normalize it.
 * See `CreateOtpAuthOptions` and the README. If the caller passes
 * `Alice@example.com` at issue time and `alice@example.com` at verify time,
 * the two produce different identifiers and verification fails.
 */
export function createIdentifier(normalizedEmail: string, codeChallenge: string): string {
  return JSON.stringify([normalizedEmail, codeChallenge])
}

/**
 * Hash a plain OTP for storage. `identifier` doubles as the salt. It is
 * already unique per (normalizedEmail, codeChallenge) pair and is not a
 * secret, so reusing it avoids a second column while still avoiding a
 * shared global salt, which would let one rainbow table crack every row.
 *
 * Uses the async `scrypt`, not `scryptSync`. scrypt is deliberately
 * expensive, and the sync variant blocks Node's event loop for the entire
 * computation. Under concurrent login traffic that serializes every other
 * request the process is handling, not only OTP ones. The async variant
 * runs on the libuv threadpool instead.
 *
 * **On the scrypt work factor.** This deliberately uses Node's defaults
 * (N=2^14, r=8, p=1, ~16 MiB per hash) rather than OWASP's password-storage
 * recommendation of N=2^17 (~134 MiB). Two reasons: OWASP's parameters are
 * tuned for long-lived, low-entropy, often-reused human passwords, whereas
 * this hashes a CSPRNG-generated 40-bit OTP that is single-use and expires
 * in minutes; and N=2^17 exceeds Node's default 32 MiB `maxmem`, so it
 * would need an explicit `maxmem` override and would let a few concurrent
 * logins exhaust the libuv threadpool's memory budget. The hash's job here
 * is to make a stolen database row not-instantly-crackable within the OTP's
 * short life, which these parameters do.
 */
export async function hashOtp(otp: string, identifier: string): Promise<string> {
  const derivedKey = (await scryptAsync(otp, identifier, SCRYPT_KEYLEN)) as Buffer
  return derivedKey.toString('base64')
}

/**
 * Timing-safe comparison of a submitted OTP's hash against the stored hash.
 * Length mismatches are compared against themselves rather than
 * short-circuiting, so a mismatched length takes the same time as a match.
 */
export function isValidOtpHash(submittedHash: string, storedHash: string): boolean {
  try {
    const submitted = Buffer.from(submittedHash)
    const stored = Buffer.from(storedHash)
    if (submitted.length !== stored.length) {
      timingSafeEqual(submitted, submitted)
      return false
    }
    return timingSafeEqual(submitted, stored)
  } catch {
    return false
  }
}
