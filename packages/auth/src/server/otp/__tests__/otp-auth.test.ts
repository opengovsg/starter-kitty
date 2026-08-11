import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OtpVerificationError } from '../../../otp/errors.js'
import { createPkceChallenge, createPkceVerifier } from '../../../pkce/index.js'
import { createOtpAuth } from '../index.js'
import type { SendOtp, VerificationTokenStore } from '../types.js'
import { createInMemoryStore } from './in-memory-store.js'

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

    const result = await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge })

    expect(Object.keys(result)).toEqual(['otpPrefix'])
    expect(sendOtp).toHaveBeenCalledTimes(1)
    const call = lastSent()
    expect(call.email).toBe('a@example.com')
    expect(call.otp).toHaveLength(8)
    expect(call.otpPrefix).toBe(result.otpPrefix)
  })

  it('rejects re-issuing for the same email + codeChallenge', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)

    await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge })
    await expect(otpAuth.issueOtp({ email: 'a@example.com', codeChallenge })).rejects.toMatchObject({
      code: 'invalid',
    })
  })

  it('allows distinct challenges for the same email', async () => {
    const otpAuth = build()
    const c1 = await createPkceChallenge(createPkceVerifier())
    const c2 = await createPkceChallenge(createPkceVerifier())

    await expect(otpAuth.issueOtp({ email: 'a@example.com', codeChallenge: c1 })).resolves.toBeDefined()
    await expect(otpAuth.issueOtp({ email: 'a@example.com', codeChallenge: c2 })).resolves.toBeDefined()
  })

  it('verifies a correct token and consumes the record', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge })
    const { otp } = lastSent()

    const result = await otpAuth.verifyOtp({ email: 'a@example.com', token: otp, codeVerifier })
    expect(result).toEqual({ email: 'a@example.com' })

    // Consumed: a second verify with the same (now-deleted) record fails.
    await expect(otpAuth.verifyOtp({ email: 'a@example.com', token: otp, codeVerifier })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('rejects a wrong token', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge })

    await expect(otpAuth.verifyOtp({ email: 'a@example.com', token: 'WRONGWR', codeVerifier })).rejects.toMatchObject({
      code: 'invalid',
    })
  })

  it('rejects a mismatched verifier (wrong session)', async () => {
    const otpAuth = build()
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge })
    const { otp } = lastSent()

    await expect(
      otpAuth.verifyOtp({ email: 'a@example.com', token: otp, codeVerifier: createPkceVerifier() }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects an expired OTP and clamps expiry to the minimum', async () => {
    vi.useFakeTimers()
    try {
      const otpAuth = build({ otpExpirySeconds: 1 }) // clamped up to the 60s minimum
      const codeVerifier = createPkceVerifier()
      const codeChallenge = await createPkceChallenge(codeVerifier)
      await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge })
      const { otp } = lastSent()

      vi.advanceTimersByTime(61_000)

      await expect(otpAuth.verifyOtp({ email: 'a@example.com', token: otp, codeVerifier })).rejects.toMatchObject({
        code: 'expired',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('locks out after exceeding maxAttempts (clamped to the minimum of 1)', async () => {
    const otpAuth = build({ maxAttempts: 0 }) // clamped up to 1
    const codeVerifier = createPkceVerifier()
    const codeChallenge = await createPkceChallenge(codeVerifier)
    await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge })
    const { otp } = lastSent()

    // First attempt (attempts becomes 1, within the clamped cap of 1) — wrong token.
    await expect(otpAuth.verifyOtp({ email: 'a@example.com', token: 'WRONGWR', codeVerifier })).rejects.toMatchObject({
      code: 'invalid',
    })

    // Second attempt (attempts becomes 2, exceeds the cap) — even the correct token is locked out.
    await expect(otpAuth.verifyOtp({ email: 'a@example.com', token: otp, codeVerifier })).rejects.toMatchObject({
      code: 'too_many_attempts',
    })
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
    await otpAuth.issueOtp({ email: 'a@example.com', codeChallenge })
    const { otp } = lastSent()

    await expect(otpAuth.verifyOtp({ email: 'a@example.com', token: otp, codeVerifier })).rejects.toMatchObject({
      code: 'token_reused',
    })
  })

  it('every error carries the same generic message', async () => {
    const otpAuth = build()
    try {
      await otpAuth.verifyOtp({ email: 'nobody@example.com', token: 'XXXXXXXX', codeVerifier: createPkceVerifier() })
      expect.fail('expected verifyOtp to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(OtpVerificationError)
      expect((error as OtpVerificationError).message).toBe('Invalid or expired authentication session')
    }
  })
})
