import type { VerificationTokenStore } from '../types.js'

/**
 * A minimal in-memory {@link VerificationTokenStore}, used only by this
 * package's own tests. Deliberately not exported from the package: shipping
 * a "just use this" store invites production use of something with no
 * persistence and no cross-instance sharing. Write a real adapter — see the
 * README for Prisma/Kysely sketches.
 */
export function createInMemoryStore(): VerificationTokenStore {
  const records = new Map<string, { hashedToken: string; attempts: number; issuedAt: Date }>()

  return {
    create({ identifier, hashedToken, issuedAt }) {
      if (records.has(identifier)) {
        return Promise.resolve('conflict')
      }
      records.set(identifier, { hashedToken, attempts: 0, issuedAt })
      return Promise.resolve('created')
    },

    incrementAttempts(identifier) {
      const record = records.get(identifier)
      if (!record) return Promise.resolve(null)
      record.attempts += 1
      return Promise.resolve({ ...record })
    },

    consume(identifier, expectedHashedToken) {
      const record = records.get(identifier)
      if (!record || record.hashedToken !== expectedHashedToken) {
        return Promise.resolve(false)
      }
      records.delete(identifier)
      return Promise.resolve(true)
    },
  }
}
