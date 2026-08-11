import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OtpVerificationError } from '../../../otp/errors.js'
import { createPkceChallenge, createPkceVerifier } from '../../../pkce/index.js'
import type { OtpResult, SendOtp, VerificationTokenStore } from '../index.js'
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
  let sent: { email: string; otp: string; otpPrefix: string }[]

  beforeEach(() => {
    sent = []
    sendOtp = vi.fn((args: { email: string; otp: string; otpPrefix: string }) => {
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

  it('issueOtp never returns the plain OTP, only the prefix', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)

    const data = expectSuccess(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge }))

    expect(Object.keys(data)).toEqual(['otpPrefix'])
    expect(sendOtp).toHaveBeenCalledTimes(1)
    const call = lastSent()
    expect(call.email).toBe('a@example.com')
    expect(call.otp).toHaveLength(8)
    expect(call.otpPrefix).toBe(data.otpPrefix)
  })

  it('rejects re-issuing for the same email + codeChallenge', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)

    expectSuccess(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge }))
    const error = expectFailure(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge }))
    expect(error.code).toBe('invalid')
  })

  it('allows distinct challenges for the same email', async () => {
    const otpAuth = build()
    const c1 = await createPkceChallenge(createPkceVerifier())
    const c2 = await createPkceChallenge(createPkceVerifier())

    expectSuccess(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge: c1 }))
    expectSuccess(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge: c2 }))
  })

  it('verifies a correct token and consumes the record', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    expectSuccess(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge }))
    const { otp } = lastSent()

    const data = expectSuccess(await otpAuth.verifyOtp({ email: 'a@example.com', token: otp, codeVerifier }))
    expect(data).toEqual({ email: 'a@example.com' })

    // Consumed: a second verify with the same (now-deleted) record fails.
    const error = expectFailure(await otpAuth.verifyOtp({ email: 'a@example.com', token: otp, codeVerifier }))
    expect(error.code).toBe('not_found')
  })

  it('rejects a wrong token', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    expectSuccess(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge }))

    const error = expectFailure(await otpAuth.verifyOtp({ email: 'a@example.com', token: 'WRONGWRO', codeVerifier }))
    expect(error.code).toBe('invalid')
    expect(error.attemptCount).toBe(1)
  })

  it('rejects a mismatched verifier (wrong session), with no attemptCount', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    expectSuccess(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge }))
    const { otp } = lastSent()

    const error = expectFailure(
      await otpAuth.verifyOtp({ email: 'a@example.com', token: otp, codeVerifier: createPkceVerifier() }),
    )
    expect(error.code).toBe('not_found')
    expect(error.attemptCount).toBeUndefined()
  })

  it('rejects an expired OTP (otpExpirySeconds is unclamped)', async () => {
    vi.useFakeTimers()
    try {
      const otpAuth = build({ otpExpirySeconds: 1 })
      const codeVerifier = createPkceVerifier()
      const codeChallenge = await createPkceChallenge(codeVerifier)
      expectSuccess(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge }))
      const { otp } = lastSent()

      vi.advanceTimersByTime(1_001)

      const error = expectFailure(await otpAuth.verifyOtp({ email: 'a@example.com', token: otp, codeVerifier }))
      expect(error.code).toBe('expired')
      expect(error.attemptCount).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('locks out after exceeding maxAttempts (clamped to the minimum of 1)', async () => {
    const otpAuth = build({ maxAttempts: 0 }) // clamped up to 1
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    expectSuccess(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge }))
    const { otp } = lastSent()

    // First attempt (attempts becomes 1, within the clamped cap of 1) — wrong token.
    const first = expectFailure(await otpAuth.verifyOtp({ email: 'a@example.com', token: 'WRONGWRO', codeVerifier }))
    expect(first.code).toBe('invalid')
    expect(first.attemptCount).toBe(1)

    // Second attempt (attempts becomes 2, exceeds the cap) — even the correct token is locked out.
    const second = expectFailure(await otpAuth.verifyOtp({ email: 'a@example.com', token: otp, codeVerifier }))
    expect(second.code).toBe('too_many_attempts')
    expect(second.attemptCount).toBe(2)
  })

  it('maps a losing race on consume to token_reused', async () => {
    const record = { hashedToken: '', attempts: 0, issuedAt: new Date() }
    const raceLostStore: VerificationTokenStore = {
      create(rec) {
        record.hashedToken = rec.hashedToken
        record.issuedAt = rec.issuedAt
        return Promise.resolve('created')
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
    expectSuccess(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge }))
    const { otp } = lastSent()

    const error = expectFailure(await otpAuth.verifyOtp({ email: 'a@example.com', token: otp, codeVerifier }))
    expect(error.code).toBe('token_reused')
    expect(error.attemptCount).toBe(1)
  })

  it('does not let a stale consume delete a record recreated under the same identifier', async () => {
    // Regression test for the store contract: consume() must be a
    // conditional delete keyed on the hash it validated, not just the
    // identifier — otherwise a consume() call holding a stale hash (from a
    // record that was already cleaned up) can delete an unrelated, newer
    // record created under the same identifier in the meantime.
    const store = createInMemoryStore()
    const identifier = 'a-shared-identifier'
    await store.create({ identifier, hashedToken: 'hash-1', issuedAt: new Date() })

    // The hash-1 record is cleaned up (e.g. expiry), and a new OTP is
    // issued and stored under the exact same identifier.
    expect(await store.consume(identifier, 'hash-1')).toBe(true)
    await store.create({ identifier, hashedToken: 'hash-2', issuedAt: new Date() })

    // A stale caller still holding hash-1 tries to consume — it must not
    // touch hash-2's record.
    expect(await store.consume(identifier, 'hash-1')).toBe(false)
    const record = await store.incrementAttempts(identifier)
    expect(record?.hashedToken).toBe('hash-2')
  })

  it('rejects issuing an OTP for a malformed codeChallenge, with no attemptCount', async () => {
    const otpAuth = build()

    const error = expectFailure(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge: 'too-short' }))

    expect(error.code).toBe('invalid')
    expect(error.attemptCount).toBeUndefined()
    expect(sendOtp).not.toHaveBeenCalled()
  })

  it('catches an unexpected store failure instead of throwing', async () => {
    const brokenStore: VerificationTokenStore = {
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

    const result = await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge })

    expect(result.success).toBe(false)
    const error = expectFailure(result)
    expect(error.code).toBe('unexpected')
    expect(error.message).toBe('Invalid or expired authentication session')
    expect(error.cause).toBeInstanceOf(Error)
    expect((error.cause as Error).message).toBe('connection refused')
  })

  it('wraps even an OtpVerificationError thrown by the store as unexpected', async () => {
    // The contract is that ANY store/sendOtp failure becomes 'unexpected' —
    // including the edge case of a store throwing an OtpVerificationError
    // itself, which must not be passed through with its original code.
    const throwingStore: VerificationTokenStore = {
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

    const error = expectFailure(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge }))
    expect(error.code).toBe('unexpected')
  })

  it('catches an unexpected sendOtp failure instead of throwing', async () => {
    const failingSendOtp: SendOtp = () => Promise.reject(new Error('SMTP down'))
    const otpAuth = createOtpAuth({ store: createInMemoryStore(), sendOtp: failingSendOtp })
    const codeChallenge = await createPkceChallenge(createPkceVerifier())

    const error = expectFailure(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge }))
    expect(error.code).toBe('unexpected')
  })

  it('rolls back the record when sendOtp fails, so a retry re-issues instead of conflicting', async () => {
    const store = createInMemoryStore()
    let shouldFail = true
    const flakySendOtp: SendOtp = () => (shouldFail ? Promise.reject(new Error('SMTP down')) : Promise.resolve())
    const otpAuth = createOtpAuth({ store, sendOtp: flakySendOtp })
    const codeChallenge = await createPkceChallenge(createPkceVerifier())

    const failed = expectFailure(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge }))
    expect(failed.code).toBe('unexpected')

    shouldFail = false
    expectSuccess(await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge }))
  })

  it('every error carries the same generic message', async () => {
    const otpAuth = build()
    const error = expectFailure(
      await otpAuth.verifyOtp({ email: 'nobody@example.com', token: 'XXXXXXXX', codeVerifier: createPkceVerifier() }),
    )
    expect(error).toBeInstanceOf(OtpVerificationError)
    expect(error.message).toBe('Invalid or expired authentication session')
  })
})
