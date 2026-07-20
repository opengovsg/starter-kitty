import { describe, expect, it } from 'vitest'

import { containerConfigurationSchema } from '../config.js'

describe('containerConfigurationSchema', () => {
  it('parses a full configuration', () => {
    const config = {
      name: 'db',
      image: 'postgres:latest',
      ports: [5432, { container: 6379, host: 63799 }],
      environment: { FOO: 'bar' },
      command: ['redis-server'],
      extraHosts: [{ host: 'host.docker.internal', ipAddress: 'host-gateway' }],
      reuse: true,
      wait: { type: 'LOG', message: 'ready', times: 2 },
    }
    expect(containerConfigurationSchema.parse(config)).toEqual(config)
  })

  it('drops unknown keys such as the removed buildArgs', () => {
    const parsed = containerConfigurationSchema.parse({
      name: 'db',
      image: 'postgres',
      buildArgs: { NODE_ENV: 'test' },
    })
    expect(parsed).not.toHaveProperty('buildArgs')
  })

  it('rejects a config missing image', () => {
    expect(() => containerConfigurationSchema.parse({ name: 'db' })).toThrow()
  })

  it('rejects an unknown wait strategy', () => {
    expect(() =>
      containerConfigurationSchema.parse({
        name: 'db',
        image: 'postgres',
        wait: { type: 'SLEEP' },
      }),
    ).toThrow()
  })
})
