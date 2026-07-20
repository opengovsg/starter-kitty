import { afterEach, describe, expect, it } from 'vitest'

import type { ContainerConfiguration } from '../config.js'
import {
  getContainer,
  getMappedPort,
  parseContainers,
  serializeContainers,
  TESTCONTAINERS_ENV_KEY,
} from '../handoff.js'
import type { StartedContainerInformation } from '../setup.js'

const configuration: ContainerConfiguration = {
  name: 'redis',
  image: 'redis',
  ports: [6379],
  wait: { type: 'PORT' },
}

const started = {
  name: 'redis',
  host: '127.0.0.1',
  ports: new Map([[6379, 32768]]),
  configuration,
  // Not serialized, so a stub is enough.
  container: {} as StartedContainerInformation['container'],
} satisfies StartedContainerInformation

describe('serialize/parse handoff', () => {
  it('round-trips container info, rebuilding the ports Map', () => {
    const [parsed] = parseContainers(serializeContainers([started]))
    expect(parsed).toBeDefined()
    expect(parsed?.ports).toBeInstanceOf(Map)
    expect(parsed?.ports.get(6379)).toBe(32768)
    expect(parsed).toEqual({
      name: 'redis',
      host: '127.0.0.1',
      ports: new Map([[6379, 32768]]),
      configuration,
    })
  })

  it('never serializes the live container handle', () => {
    expect(serializeContainers([started])).not.toContain('container')
  })
})

describe('getContainer', () => {
  afterEach(() => {
    delete process.env[TESTCONTAINERS_ENV_KEY]
  })

  it('finds a container by name from the env', () => {
    process.env[TESTCONTAINERS_ENV_KEY] = serializeContainers([started])
    expect(getContainer('redis').host).toBe('127.0.0.1')
  })

  it('throws when the env var is absent', () => {
    expect(() => getContainer('redis')).toThrow(/is not set/)
  })

  it('throws when no container matches the name', () => {
    process.env[TESTCONTAINERS_ENV_KEY] = serializeContainers([started])
    expect(() => getContainer('postgres')).toThrow(/No container named/)
  })
})

describe('getMappedPort', () => {
  it('returns the mapped host port', () => {
    expect(getMappedPort(started, 6379)).toBe(32768)
  })

  it('throws for an unmapped port', () => {
    expect(() => getMappedPort(started, 5432)).toThrow(/no mapped port/)
  })
})
