import { afterEach, describe, expect, it } from 'vitest'

import { getWorkerDatabaseIndex } from '../vitest/index.js'

describe('getWorkerDatabaseIndex', () => {
  const original = process.env.VITEST_POOL_ID
  afterEach(() => {
    if (original === undefined) delete process.env.VITEST_POOL_ID
    else process.env.VITEST_POOL_ID = original
  })

  it('maps the worker pool id into the database range', () => {
    process.env.VITEST_POOL_ID = '3'
    expect(getWorkerDatabaseIndex(256)).toBe(3)
  })

  it('wraps when the pool id exceeds the database count', () => {
    process.env.VITEST_POOL_ID = '18'
    expect(getWorkerDatabaseIndex(16)).toBe(2)
  })

  it("defaults to Redis's 16 databases", () => {
    process.env.VITEST_POOL_ID = '20'
    expect(getWorkerDatabaseIndex()).toBe(4)
  })

  it('falls back to index 0 when no worker id is set', () => {
    delete process.env.VITEST_POOL_ID
    expect(getWorkerDatabaseIndex(256)).toBe(0)
  })
})
