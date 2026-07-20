import { afterEach, describe, expect, inject, it } from 'vitest'

import { getWorkerDatabaseIndex, TESTCONTAINERS_CONTEXT_KEY } from '../vitest/index.js'

describe('provided container context', () => {
  it('injects container information provided by Vitest', () => {
    const containers = inject(TESTCONTAINERS_CONTEXT_KEY)

    expect(containers.redis).toEqual({
      name: 'redis',
      host: '127.0.0.1',
      ports: new Map([[6379, 32768]]),
      configuration: {
        name: 'redis',
        image: 'redis',
        ports: [6379],
        wait: { type: 'PORT' },
      },
    })
  })
})

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
