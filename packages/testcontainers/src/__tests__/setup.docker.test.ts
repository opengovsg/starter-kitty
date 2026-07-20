import { connect } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getContainer, parseContainers, serializeContainers, TESTCONTAINERS_ENV_KEY } from '../handoff.js'
import { getPostgresConnectionString, getRedisUrl, postgres, redis } from '../presets.js'
import { setup, type StartedContainerInformation, teardown } from '../setup.js'

/** Resolve once a TCP connection to host:port succeeds. */
const canConnect = (host: string, port: number) =>
  new Promise<boolean>(resolve => {
    const socket = connect({ host, port }, () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
  })

// Real Docker required; pulls postgres + redis on first run.
describe('setup/teardown against real Docker', () => {
  let containers: StartedContainerInformation[]

  beforeAll(async () => {
    containers = await setup([postgres(), redis()])
    process.env[TESTCONTAINERS_ENV_KEY] = serializeContainers(containers)
  }, 180_000)

  afterAll(async () => {
    delete process.env[TESTCONTAINERS_ENV_KEY]
    await teardown(containers)
  })

  it('exposes reachable, port-mapped containers', async () => {
    for (const c of containers) {
      const containerPort = c.name === 'postgres' ? 5432 : 6379
      const hostPort = c.ports.get(containerPort)
      expect(hostPort).toBeTypeOf('number')
      expect(await canConnect(c.host, hostPort!)).toBe(true)
    }
  })

  it('round-trips real container info through the env handoff', () => {
    const parsed = parseContainers(process.env[TESTCONTAINERS_ENV_KEY]!)
    expect(parsed.map(c => c.name).sort()).toEqual(['postgres', 'redis'])
    expect(parsed[0]?.ports).toBeInstanceOf(Map)
  })

  it('builds connection strings pointing at the live containers', () => {
    const pgUrl = getPostgresConnectionString(getContainer('postgres'))
    expect(pgUrl).toMatch(/^postgresql:\/\/root:root@.+\/test\?sslmode=disable$/)
    expect(getRedisUrl(getContainer('redis'))).toMatch(/^redis:\/\/.+:\d+$/)
  })
})
