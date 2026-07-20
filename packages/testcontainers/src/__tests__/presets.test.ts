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

  it('targets the internal port for in-container commands', () => {
    const remoteHost: ContainerInformation = { ...pgInfo, host: '172.17.0.2' }
    expect(getPostgresConnectionString(remoteHost, { internal: true })).toBe(
      'postgresql://root:root@localhost:5432/test?sslmode=disable',
    )
    // internal still honours the database override
    expect(getPostgresConnectionString(remoteHost, { internal: true, database: 'run-123' })).toBe(
      'postgresql://root:root@localhost:5432/run-123?sslmode=disable',
    )
  })

  const redisInfo: ContainerInformation = {
    name: 'redis',
    host: '172.17.0.3',
    ports: new Map([[6379, 63790]]),
    configuration: redis(),
  }

  it('builds a redis url', () => {
    expect(getRedisUrl({ ...redisInfo, host: 'localhost' })).toBe('redis://localhost:63790')
  })

  it('targets the internal redis port for in-container commands', () => {
    expect(getRedisUrl(redisInfo, { internal: true })).toBe('redis://localhost:6379')
  })
})
