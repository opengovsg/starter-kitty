import { scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT_KEYLEN = 64

/**
 * The record's primary key, doubling as the scrypt salt for its token hash.
 *
 * A JSON array, not a concatenation: `email + codeChallenge` is ambiguous
 * (`"ab" + "c" === "a" + "bc"`); `JSON.stringify([email, codeChallenge])`
 * is not.
 */
export function createIdentifier(email: string, codeChallenge: string): string {
  return JSON.stringify([email, codeChallenge])
}

/**
 * Hash a plain OTP for storage. `identifier` doubles as the salt — it is
 * already unique per (email, codeChallenge) pair and is not a secret, so
 * reusing it avoids a second column while still avoiding a shared global
 * salt (which would let one rainbow table crack every row).
 */
export function hashToken(token: string, identifier: string): string {
  return scryptSync(token, identifier, SCRYPT_KEYLEN).toString('base64')
}

/**
 * Timing-safe comparison of a submitted token's hash against the stored
 * hash. Length mismatches are compared against themselves rather than
 * short-circuiting, so a mismatched length takes the same time as a match.
 */
export function isValidTokenHash(submittedHash: string, storedHash: string): boolean {
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
