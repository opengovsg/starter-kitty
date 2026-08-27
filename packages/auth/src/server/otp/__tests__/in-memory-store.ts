import type { OtpVerificationRecord, OtpVerificationStore } from '../types.js'

/**
 * A minimal in-memory {@link OtpVerificationStore}, used only by this
 * package's own tests. Deliberately not exported from the package: shipping
 * a "just use this" store invites production use of something with no
 * persistence and no cross-instance sharing. Write a real adapter — see the
 * README for Prisma/Kysely sketches.
 */
export function createInMemoryStore(): OtpVerificationStore {
  const records = new Map<string, OtpVerificationRecord>()

  return {
    create({ identifier, hashedOtp, issuedAt }) {
      const existing = records.get(identifier)
      if (existing) {
        return Promise.resolve({ status: 'conflict' as const, existing: { ...existing } })
      }
      records.set(identifier, { hashedOtp, attempts: 0, issuedAt })
      return Promise.resolve({ status: 'created' as const })
    },

    incrementAttempts(identifier) {
      const record = records.get(identifier)
      if (!record) return Promise.resolve(null)
      record.attempts += 1
      return Promise.resolve({ ...record })
    },

    consume(identifier, expectedHashedOtp) {
      const record = records.get(identifier)
      if (!record || record.hashedOtp !== expectedHashedOtp) {
        return Promise.resolve(false)
      }
      records.delete(identifier)
      return Promise.resolve(true)
    },
  }
}
