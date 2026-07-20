import { describe, expect, it } from 'vitest'

import { getPostgresConnectionString, getRedisUrl, postgres, redis } from '../presets.js'
import type { ContainerInformation } from '../setup.js'

describe('postgres preset', () => {
  it('has sensible defaults', () => {
    expect(postgres()).toEqual({
      name: 'postgres',
      image: 'postgres:latest',
      ports: [5432],
      environment: {
        POSTGRES_DB: 'test',
        POSTGRES_USER: 'root',
        POSTGRES_PASSWORD: 'root',
      },
      wait: { type: 'PORT' },
    })
  })

  it('shallow-merges overrides but merges environment per-key', () => {
    const config = postgres({
      ports: [{ container: 5432, host: 64322 }],
      reuse: true,
      environment: { POSTGRES_DB: 'custom' },
    })
    expect(config.ports).toEqual([{ container: 5432, host: 64322 }])
    expect(config.reuse).toBe(true)
    expect(config.environment).toEqual({
      POSTGRES_DB: 'custom',
      POSTGRES_USER: 'root',
      POSTGRES_PASSWORD: 'root',
    })
  })
})

describe('redis preset', () => {
  it('has sensible defaults and no command', () => {
    expect(redis()).toEqual({
      name: 'redis',
      image: 'redis',
      ports: [6379],
      wait: { type: 'PORT' },
    })
  })

  it('adds a --databases command when databases is set', () => {
    expect(redis({ databases: 256 }).command).toEqual(['redis-server', '--databases', '256'])
  })

  it('applies overrides without leaking the databases key', () => {
    const config = redis({ databases: 16, reuse: true })
    expect(config.reuse).toBe(true)
    expect(config).not.toHaveProperty('databases')
  })
})

const pgInfo: ContainerInformation = {
  name: 'postgres',
  host: 'localhost',
  ports: new Map([[5432, 54321]]),
  configuration: postgres(),
}

describe('connection string builders', () => {
  it('builds a Postgres connection string from env creds', () => {
    expect(getPostgresConnectionString(pgInfo)).toBe('postgresql://root:root@localhost:54321/test?sslmode=disable')
  })

  it('overrides the database name', () => {
    expect(getPostgresConnectionString(pgInfo, { database: 'run-123' })).toBe(
      'postgresql://root:root@localhost:54321/run-123?sslmode=disable',
    )
  })

  it('builds a redis url', () => {
    expect(
      getRedisUrl({
        name: 'redis',
        host: 'localhost',
        ports: new Map([[6379, 63790]]),
        configuration: redis(),
      }),
    ).toBe('redis://localhost:63790')
  })
})
