import { defineConfig } from 'vitest/config'

import type { ProvidedContainers } from './src/vitest/index.js'

const testcontainers = {
  redis: {
    name: 'redis',
    host: '127.0.0.1',
    ports: new Map([[6379, 32768]]),
    configuration: {
      name: 'redis',
      image: 'redis',
      ports: [6379],
      wait: { type: 'PORT' },
    },
  },
} satisfies ProvidedContainers

export default defineConfig({
  test: {
    provide: { testcontainers },
  },
})
