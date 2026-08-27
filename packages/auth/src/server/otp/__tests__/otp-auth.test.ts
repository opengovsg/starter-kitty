import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OtpOptionsError, OtpVerificationError } from '../../../otp/errors.js'
import { createPkceChallenge, createPkceVerifier } from '../../../pkce/index.js'
import type { OtpResult, OtpVerificationStore, SendOtp } from '../index.js'
import { createOtpAuth } from '../index.js'
import { createInMemoryStore } from './in-memory-store.js'

function expectFailure<T>(result: OtpResult<T>): OtpVerificationError {
  if (result.success) {
    throw new Error('expected a failed OtpResult, got a successful one')
  }
  return result.error
}

function expectSuccess<T>(result: OtpResult<T>): T {
  if (!result.success) {
    throw new Error(`expected a successful OtpResult, got error code: ${result.error.code}`)
  }
  return result.data
}

describe('createOtpAuth', () => {
  let sendOtp: ReturnType<typeof vi.fn> & SendOtp
  let sent: { normalizedEmail: string; otp: string; otpPrefix: string }[]

  beforeEach(() => {
    sent = []
    sendOtp = vi.fn((args: { normalizedEmail: string; otp: string; otpPrefix: string }) => {
      sent.push(args)
      return Promise.resolve()
    }) as ReturnType<typeof vi.fn> & SendOtp
  })

  function build(overrides: Partial<Parameters<typeof createOtpAuth>[0]> = {}) {
    const store = overrides.store ?? createInMemoryStore()
    return createOtpAuth({ store, sendOtp, ...overrides })
  }

  function lastSent() {
    const entry = sent.at(-1)
    if (!entry) throw new Error('sendOtp was never called')
    return entry
  }

  describe('option validation', () => {
    it.each([
      ['otpLength', { otpLength: 6 }],
      ['otpExpirySeconds', { otpExpirySeconds: 0 }],
      ['otpExpirySeconds above the NIST ceiling', { otpExpirySeconds: 601 }],
      ['maxAttempts', { maxAttempts: 0 }],
      ['maxAttempts above the cap', { maxAttempts: 11 }],
      ['otpPrefixLength', { otpPrefixLength: 1 }],
    ])('throws OtpOptionsError for out-of-range %s', (_label, overrides) => {
      expect(() => build(overrides)).toThrow(OtpOptionsError)
    })

    it('throws OtpOptionsError for a non-integer option', () => {
      expect(() => build({ maxAttempts: 2.5 })).toThrow(OtpOptionsError)
    })

    it('accepts the documented defaults and boundaries', () => {
      expect(() => build()).not.toThrow()
      expect(() => build({ otpExpirySeconds: 600, maxAttempts: 10, otpLength: 8, otpPrefixLength: 6 })).not.toThrow()
    })
  })

  it('issueOtp never returns the plain OTP, only the prefix', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)

    const data = expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))

    expect(Object.keys(data)).toEqual(['otpPrefix'])
    expect(sendOtp).toHaveBeenCalledTimes(1)
    const call = lastSent()
    expect(call.normalizedEmail).toBe('a@example.com')
    expect(call.otp).toHaveLength(8)
    expect(call.otpPrefix).toBe(data.otpPrefix)
  })

  it('rejects re-issuing while a live OTP exists for the same email + challenge', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)

    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    const error = expectFailure(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    expect(error.code).toBe('challenge_conflict')
  })

  it('self-heals an expired leftover record instead of conflicting forever', async () => {
    vi.useFakeTimers()
    try {
      const otpAuth = build({ otpExpirySeconds: 60 })
      const codeVerifier = createPkceVerifier()
      const codeChallenge = await createPkceChallenge(codeVerifier)

      expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))

      // The user never submits it and the record goes stale. Re-issuing
      // against the same challenge must clear the leftover and succeed,
      // rather than being blocked by it forever.
      vi.advanceTimersByTime(60_001)

      expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
      expect(sendOtp).toHaveBeenCalledTimes(2)

      // And the OTP from the re-issue is the one that verifies.
      const { otp } = lastSent()
      expectSuccess(await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp, codeVerifier }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('allows distinct challenges for the same email', async () => {
    const otpAuth = build()
    const c1 = await createPkceChallenge(createPkceVerifier())
    const c2 = await createPkceChallenge(createPkceVerifier())

    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge: c1 }))
    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge: c2 }))
  })

  it('verifies a correct OTP and consumes the record', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    const { otp } = lastSent()

    const data = expectSuccess(await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp, codeVerifier }))
    expect(data).toEqual({ normalizedEmail: 'a@example.com' })

    // Consumed: a second verify with the same (now-deleted) record fails.
    const error = expectFailure(await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp, codeVerifier }))
    expect(error.code).toBe('not_found')
  })

  it('verifies an OTP that arrives with surrounding whitespace', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    const { otp } = lastSent()

    const data = expectSuccess(
      await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp: `  ${otp}\n`, codeVerifier }),
    )
    expect(data).toEqual({ normalizedEmail: 'a@example.com' })
  })

  it('rejects a wrong-length OTP without spending an attempt', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    const { otp } = lastSent()

    const error = expectFailure(
      await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp: 'SHORT', codeVerifier }),
    )
    expect(error.code).toBe('not_found')
    expect(error.attemptCount).toBeUndefined()

    // The malformed guess did not burn the legitimate session's budget.
    expectSuccess(await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp, codeVerifier }))
  })

  it('verifies a verifier at the RFC 7636 minimum length of 43', async () => {
    // createPkceVerifier mints 128, but createPkceChallenge hashes any string,
    // so a caller bringing a compliant 43-char verifier must be able to verify
    // the OTP it issued. A gate pinned to 128 issues an unverifiable OTP.
    const otpAuth = build()
    const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(codeVerifier).toHaveLength(43)
    const codeChallenge = await createPkceChallenge(codeVerifier)
    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    const { otp } = lastSent()

    const data = expectSuccess(await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp, codeVerifier }))
    expect(data).toEqual({ normalizedEmail: 'a@example.com' })
  })

  it('rejects a verifier below the RFC 7636 minimum', async () => {
    const otpAuth = build()
    const codeVerifier = 'a'.repeat(42)
    const codeChallenge = await createPkceChallenge(codeVerifier)
    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    const { otp } = lastSent()

    const error = expectFailure(await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp, codeVerifier }))
    expect(error.code).toBe('not_found')
  })

  it('expires an OTP at exactly the expiry instant', async () => {
    vi.useFakeTimers()
    try {
      const otpAuth = build({ otpExpirySeconds: 60 })
      const codeVerifier = createPkceVerifier()
      const codeChallenge = await createPkceChallenge(codeVerifier)
      expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
      const { otp } = lastSent()

      // Exactly at the TTL, not one tick past it.
      vi.advanceTimersByTime(60_000)

      const error = expectFailure(await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp, codeVerifier }))
      expect(error.code).toBe('expired')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a malformed codeVerifier without spending an attempt', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    const { otp } = lastSent()

    const error = expectFailure(
      await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp, codeVerifier: 'not-a-verifier' }),
    )
    expect(error.code).toBe('not_found')

    expectSuccess(await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp, codeVerifier }))
  })

  it('rejects a wrong OTP', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))

    const error = expectFailure(
      await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp: 'WRONGWRO', codeVerifier }),
    )
    expect(error.code).toBe('invalid')
    expect(error.attemptCount).toBe(1)
  })

  it('rejects a mismatched verifier (wrong session), with no attemptCount', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    const { otp } = lastSent()

    const error = expectFailure(
      await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp, codeVerifier: createPkceVerifier() }),
    )
    expect(error.code).toBe('not_found')
    expect(error.attemptCount).toBeUndefined()
  })

  it('treats a differently-cased email as a different identifier', async () => {
    // The package uses normalizedEmail verbatim; normalization is the
    // caller's job, and getting it wrong must fail closed rather than
    // silently matching.
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    const { otp } = lastSent()

    const error = expectFailure(await otpAuth.verifyOtp({ normalizedEmail: 'A@example.com', otp, codeVerifier }))
    expect(error.code).toBe('not_found')
  })

  it('rejects an expired OTP', async () => {
    vi.useFakeTimers()
    try {
      const otpAuth = build({ otpExpirySeconds: 60 })
      const codeVerifier = createPkceVerifier()
      const codeChallenge = await createPkceChallenge(codeVerifier)
      expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
      const { otp } = lastSent()

      vi.advanceTimersByTime(60_001)

      const error = expectFailure(await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp, codeVerifier }))
      expect(error.code).toBe('expired')
      expect(error.attemptCount).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('locks out after exceeding maxAttempts, then reports not_found', async () => {
    const otpAuth = build({ maxAttempts: 1 })
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    const { otp } = lastSent()

    // First attempt (attempts becomes 1, within the cap of 1), wrong OTP.
    const first = expectFailure(
      await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp: 'WRONGWRO', codeVerifier }),
    )
    expect(first.code).toBe('invalid')
    expect(first.attemptCount).toBe(1)

    // Second attempt (attempts becomes 2, exceeds the cap): even the correct OTP is locked out.
    const second = expectFailure(await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp, codeVerifier }))
    expect(second.code).toBe('too_many_attempts')
    expect(second.attemptCount).toBe(2)

    // The cap consumes the record, so it fires exactly once. A third
    // attempt finds nothing rather than reporting the lockout again.
    const third = expectFailure(await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp, codeVerifier }))
    expect(third.code).toBe('not_found')

    // And because the record is gone, the same challenge can be re-issued
    // immediately rather than being blocked by the locked-out leftover.
    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
  })

  it('maps a losing race on consume to otp_reused', async () => {
    const record = { hashedOtp: '', attempts: 0, issuedAt: new Date() }
    const raceLostStore: OtpVerificationStore = {
      create(rec) {
        record.hashedOtp = rec.hashedOtp
        record.issuedAt = rec.issuedAt
        return Promise.resolve({ status: 'created' as const })
      },
      incrementAttempts() {
        record.attempts += 1
        return Promise.resolve({ ...record })
      },
      // Simulates a concurrent verifier having already consumed the record.
      consume() {
        return Promise.resolve(false)
      },
    }
    const otpAuth = build({ store: raceLostStore })
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    const { otp } = lastSent()

    const error = expectFailure(await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp, codeVerifier }))
    expect(error.code).toBe('otp_reused')
    expect(error.attemptCount).toBe(1)
  })

  it('does not let a stale consume delete a record recreated under the same identifier', async () => {
    // Regression test for the store contract: consume() must be a
    // conditional delete keyed on the hash it validated, not just the
    // identifier. Otherwise a consume() call holding a stale hash (from a
    // record that was already cleaned up) can delete an unrelated, newer
    // record created under the same identifier in the meantime.
    const store = createInMemoryStore()
    const identifier = 'a-shared-identifier'
    await store.create({ identifier, hashedOtp: 'hash-1', issuedAt: new Date() })

    // The hash-1 record is cleaned up (e.g. expiry), and a new OTP is
    // issued and stored under the exact same identifier.
    expect(await store.consume(identifier, 'hash-1')).toBe(true)
    await store.create({ identifier, hashedOtp: 'hash-2', issuedAt: new Date() })

    // A stale caller still holding hash-1 tries to consume. It must not
    // touch hash-2's record.
    expect(await store.consume(identifier, 'hash-1')).toBe(false)
    const record = await store.incrementAttempts(identifier)
    expect(record?.hashedOtp).toBe('hash-2')
  })

  it('rejects issuing an OTP for a malformed codeChallenge', async () => {
    const otpAuth = build()

    const error = expectFailure(
      await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge: 'too-short' }),
    )

    expect(error.code).toBe('challenge_invalid')
    expect(error.attemptCount).toBeUndefined()
    expect(sendOtp).not.toHaveBeenCalled()
  })

  it('surfaces an adapter returning a non-Date issuedAt as unexpected, with a helpful cause', async () => {
    const badStore: OtpVerificationStore = {
      create() {
        return Promise.resolve({ status: 'created' as const })
      },
      incrementAttempts() {
        // An ORM that hands back the raw timestamp column as a string.
        return Promise.resolve({
          hashedOtp: 'irrelevant',
          attempts: 1,
          issuedAt: '2026-01-01T00:00:00Z' as unknown as Date,
        })
      },
      consume() {
        return Promise.resolve(true)
      },
    }
    const otpAuth = build({ store: badStore })
    const codeVerifier = createPkceVerifier()

    const error = expectFailure(
      await otpAuth.verifyOtp({ normalizedEmail: 'a@example.com', otp: 'ABCDEFGH', codeVerifier }),
    )
    expect(error.code).toBe('unexpected')
    expect(error.cause).toBeInstanceOf(TypeError)
    expect((error.cause as Error).message).toContain('issuedAt')
  })

  it('catches an unexpected store failure instead of throwing', async () => {
    const brokenStore: OtpVerificationStore = {
      create() {
        return Promise.reject(new Error('connection refused'))
      },
      incrementAttempts() {
        return Promise.reject(new Error('connection refused'))
      },
      consume() {
        return Promise.reject(new Error('connection refused'))
      },
    }
    const otpAuth = build({ store: brokenStore })
    const codeChallenge = await createPkceChallenge(createPkceVerifier())

    const result = await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge })

    expect(result.success).toBe(false)
    const error = expectFailure(result)
    expect(error.code).toBe('unexpected')
    expect(error.message).toBe('Invalid or expired authentication session')
    expect(error.cause).toBeInstanceOf(Error)
    expect((error.cause as Error).message).toBe('connection refused')
  })

  it('wraps even an OtpVerificationError thrown by the store as unexpected', async () => {
    // The contract is that ANY store/sendOtp failure becomes 'unexpected',
    // including the edge case of a store throwing an OtpVerificationError
    // itself, which must not be passed through with its original code.
    const throwingStore: OtpVerificationStore = {
      create() {
        return Promise.reject(new OtpVerificationError('invalid'))
      },
      incrementAttempts() {
        return Promise.reject(new OtpVerificationError('invalid'))
      },
      consume() {
        return Promise.resolve(false)
      },
    }
    const otpAuth = build({ store: throwingStore })
    const codeChallenge = await createPkceChallenge(createPkceVerifier())

    const error = expectFailure(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    expect(error.code).toBe('unexpected')
  })

  it('catches an unexpected sendOtp failure instead of throwing', async () => {
    const failingSendOtp: SendOtp = () => Promise.reject(new Error('SMTP down'))
    const otpAuth = createOtpAuth({ store: createInMemoryStore(), sendOtp: failingSendOtp })
    const codeChallenge = await createPkceChallenge(createPkceVerifier())

    const error = expectFailure(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    expect(error.code).toBe('unexpected')
  })

  it('rolls back the record when sendOtp fails, so a retry re-issues instead of conflicting', async () => {
    const store = createInMemoryStore()
    let shouldFail = true
    const flakySendOtp: SendOtp = () => (shouldFail ? Promise.reject(new Error('SMTP down')) : Promise.resolve())
    const otpAuth = createOtpAuth({ store, sendOtp: flakySendOtp })
    const codeChallenge = await createPkceChallenge(createPkceVerifier())

    const failed = expectFailure(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    expect(failed.code).toBe('unexpected')

    shouldFail = false
    expectSuccess(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
  })

  it('still reports unexpected when both sendOtp and the rollback fail', async () => {
    // The rollback is best-effort: a secondary failure must not mask the
    // original sendOtp error, and must not escape as a throw.
    const store = createInMemoryStore()
    const halfBrokenStore: OtpVerificationStore = {
      create: store.create.bind(store),
      incrementAttempts: store.incrementAttempts.bind(store),
      consume: () => Promise.reject(new Error('delete failed too')),
    }
    const failingSendOtp: SendOtp = () => Promise.reject(new Error('SMTP down'))
    const otpAuth = createOtpAuth({ store: halfBrokenStore, sendOtp: failingSendOtp })
    const codeChallenge = await createPkceChallenge(createPkceVerifier())

    const error = expectFailure(await otpAuth.issueOtp({ normalizedEmail: 'a@example.com', codeChallenge }))
    expect(error.code).toBe('unexpected')
    expect((error.cause as Error).message).toBe('SMTP down')
  })

  it('every verify-path error carries the same generic message', async () => {
    const otpAuth = build()
    const error = expectFailure(
      await otpAuth.verifyOtp({
        normalizedEmail: 'nobody@example.com',
        otp: 'XXXXXXXX',
        codeVerifier: createPkceVerifier(),
      }),
    )
    expect(error).toBeInstanceOf(OtpVerificationError)
    expect(error.message).toBe('Invalid or expired authentication session')
  })
})
