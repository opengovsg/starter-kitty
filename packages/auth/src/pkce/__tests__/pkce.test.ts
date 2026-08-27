import { describe, expect, it } from 'vitest'

import { PKCE_VERIFIER_ALPHABET, PKCE_VERIFIER_LENGTH } from '../constants.js'
import { createPkceChallenge, createPkceVerifier, isValidCodeChallenge } from '../index.js'

describe('createPkceVerifier', () => {
  it('generates a verifier of the RFC 7636 maximum length', () => {
    expect(createPkceVerifier()).toHaveLength(PKCE_VERIFIER_LENGTH)
  })

  it('only uses characters from the unreserved alphabet', () => {
    const verifier = createPkceVerifier()
    for (const char of verifier) {
      expect(PKCE_VERIFIER_ALPHABET).toContain(char)
    }
  })

  it('generates distinct verifiers across calls', () => {
    const verifiers = new Set(Array.from({ length: 50 }, () => createPkceVerifier()))
    expect(verifiers.size).toBe(50)
  })
})

describe('createPkceChallenge', () => {
  it('matches the RFC 7636 appendix B known-answer vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = await createPkceChallenge(verifier)
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('is deterministic for the same verifier', async () => {
    const verifier = createPkceVerifier()
    expect(await createPkceChallenge(verifier)).toBe(await createPkceChallenge(verifier))
  })

  it('produces different challenges for different verifiers', async () => {
    const [a, b] = await Promise.all([
      createPkceChallenge(createPkceVerifier()),
      createPkceChallenge(createPkceVerifier()),
    ])
    expect(a).not.toBe(b)
  })

  it('produces a base64url string with no padding', async () => {
    const challenge = await createPkceChallenge(createPkceVerifier())
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).not.toContain('=')
  })
})

describe('isValidCodeChallenge', () => {
  it('accepts a real challenge', async () => {
    const challenge = await createPkceChallenge(createPkceVerifier())
    expect(isValidCodeChallenge(challenge)).toBe(true)
  })

  it('rejects the wrong length', () => {
    expect(isValidCodeChallenge('too-short')).toBe(false)
  })

  it('rejects characters outside the base64url set', () => {
    expect(isValidCodeChallenge('!'.repeat(43))).toBe(false)
  })

  it('rejects a value with base64 padding characters', () => {
    expect(isValidCodeChallenge(`${'A'.repeat(42)}=`)).toBe(false)
  })

  it('rejects a non-canonical encoding that decodes to the right byte length', async () => {
    // A 43-char base64url string encodes 258 bits for a 256-bit (32-byte)
    // value, so the last symbol's low 2 bits are unused and must be zero in
    // a canonical encoding. Find a sibling of a real challenge that differs
    // only in those unused bits: it decodes to the exact same 32 bytes, but
    // createPkceChallenge itself could never produce it.
    const challenge = await createPkceChallenge(createPkceVerifier())
    const targetBytes = Buffer.from(challenge, 'base64url')
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

    const nonCanonical = alphabet
      .split('')
      .filter(char => char !== challenge.at(-1))
      .map(char => challenge.slice(0, -1) + char)
      .find(candidate => Buffer.from(candidate, 'base64url').equals(targetBytes))

    expect(nonCanonical).toBeDefined()
    expect(isValidCodeChallenge(nonCanonical!)).toBe(false)
  })
})
