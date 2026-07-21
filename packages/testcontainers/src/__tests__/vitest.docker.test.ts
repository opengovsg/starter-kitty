import { connect } from 'node:net'

import { describe, expect, it } from 'vitest'
import type { TestProject } from 'vitest/node'

import { redis } from '../presets.js'
import { getMappedPort } from '../setup.js'
import { createGlobalSetup, type ProvidedContainers, TESTCONTAINERS_CONTEXT_KEY } from '../vitest/index.js'

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
  it('boots a container, provides its information, and tears down', async () => {
    let provided: ProvidedContainers | undefined
    const project = {
      provide: (key: string, value: ProvidedContainers) => {
        expect(key).toBe(TESTCONTAINERS_CONTEXT_KEY)
        provided = value
      },
    } as unknown as TestProject

    const teardown = await createGlobalSetup([redis()])(project)
    try {
      expect(provided?.redis).toBeDefined()
      expect(provided?.redis).not.toHaveProperty('container')
      const info = provided!.redis!
      expect(await canConnect(info.host, getMappedPort(info, 6379))).toBe(true)
    } finally {
      await teardown()
    }
  }, 180_000)
})
