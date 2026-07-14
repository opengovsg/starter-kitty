import { describe, expect, it } from 'vitest'

import { constructRateLimitHeaders, RateLimitExceededError } from '../index.js'

const makeError = (msToNextWindow: number) =>
  new RateLimitExceededError({
    points: { remaining: 0, consumed: 3 },
    msToNextWindow,
    isFirstInWindow: false,
  })

describe('RateLimitExceededError', () => {
  it('carries the rate-limit info and a human-readable message', () => {
    const error = makeError(2500)

    expect(error.info.msToNextWindow).toBe(2500)
    expect(error.message).toBe('Rate limit exceeded. Try again in 3s.')
  })
})

describe('constructRateLimitHeaders', () => {
  it('rounds Retry-After up to whole seconds', () => {
    const headers = constructRateLimitHeaders(makeError(2500))

    expect(headers).toEqual({
      'Retry-After': '3',
    })
  })

  it('never reports a Retry-After below one second', () => {
    expect(constructRateLimitHeaders(makeError(0))).toEqual({ 'Retry-After': '1' })
    expect(constructRateLimitHeaders(makeError(1))).toEqual({ 'Retry-After': '1' })
  })
})
