import { connect } from 'node:net'

import { describe, expect, it } from 'vitest'

import { getContainer, getMappedPort, TESTCONTAINERS_ENV_KEY } from '../handoff.js'
import { redis } from '../presets.js'
import { createGlobalSetup } from '../vitest/index.js'

/** Resolve once a TCP connection to host:port succeeds. */
const canConnect = (host: string, port: number) =>
  new Promise<boolean>(resolve => {
    const socket = connect({ host, port }, () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
  })

// Real Docker required; boots a single redis container via the globalSetup factory.
describe('createGlobalSetup against real Docker', () => {
  it('boots a container, publishes the handoff, and tears down', async () => {
    const teardown = await createGlobalSetup([redis()])()
    try {
      expect(process.env[TESTCONTAINERS_ENV_KEY]).toBeTypeOf('string')
      const info = getContainer('redis')
      expect(await canConnect(info.host, getMappedPort(info, 6379))).toBe(true)
    } finally {
      await teardown()
    }
    expect(process.env[TESTCONTAINERS_ENV_KEY]).toBeUndefined()
  }, 180_000)
})
