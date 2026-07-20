import { connect } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
  }, 180_000)

  afterAll(async () => {
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

  it('builds connection strings pointing at the live containers', () => {
    const postgresContainer = containers.find(container => container.name === 'postgres')!
    const redisContainer = containers.find(container => container.name === 'redis')!
    const pgUrl = getPostgresConnectionString(postgresContainer)
    expect(pgUrl).toMatch(/^postgresql:\/\/root:root@.+\/test\?sslmode=disable$/)
    expect(getRedisUrl(redisContainer)).toMatch(/^redis:\/\/.+:\d+$/)
  })
})
