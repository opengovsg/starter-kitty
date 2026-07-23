# @opengovsg/testcontainers

A declarative wrapper over [testcontainers](https://node.testcontainers.org/) for integration and e2e test setups.
It provides a zod-validated container config schema, `setup`/`teardown` over `GenericContainer`, a typed Vitest context handoff, Postgres and Redis presets, and Vitest glue helpers.

A running Docker daemon is required wherever the tests run (locally and in CI).

## Installation

```bash
npm i --save-dev @opengovsg/testcontainers testcontainers
```

`testcontainers` and `zod` are peer dependencies. Vitest is an optional peer dependency.
The Vitest glue lives at the `/vitest` subpath.

## Quickstart with presets

```ts
import {
  getPostgresConnectionString,
  getRedisUrl,
  postgres,
  redis,
  setup,
  teardown,
} from '@opengovsg/testcontainers'

const containers = await setup([postgres(), redis()])
const [pg, cache] = containers

const databaseUrl = getPostgresConnectionString(pg) // postgresql://root:root@host:port/test?sslmode=disable
const redisUrl = getRedisUrl(cache) // redis://host:port

await teardown(containers)
```

By default each container gets a random host port; the connection-string builders read the mapped port back for you.
Presets take overrides, and `environment` merges per-key: `postgres({ image: 'postgres:16-alpine', environment: { POSTGRES_DB: 'app' } })`.

## Vitest globalSetup

Boot the containers once per run, and read their connection information back through Vitest's typed provided context.

```ts
// tests/global-setup.ts
import { postgres, redis } from '@opengovsg/testcontainers'
import { createGlobalSetup } from '@opengovsg/testcontainers/vitest'

export default createGlobalSetup([postgres(), redis()])
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { globalSetup: ['./tests/global-setup.ts'] },
})
```

```ts
// tests/db.test.ts
import { getPostgresConnectionString } from '@opengovsg/testcontainers'
import { inject } from 'vitest'

const { postgres } = inject('testcontainers')
const databaseUrl = getPostgresConnectionString(postgres)
```

`createGlobalSetup` publishes a name-keyed record with `project.provide('testcontainers', ...)`; `inject('testcontainers')` returns that handle-less container info, which is all you need to connect.
Wiring the actual Prisma / Redis client stays in your app.

## Redis worker isolation

Give each parallel vitest worker its own Redis logical database.

```ts
// tests/global-setup.ts
export default createGlobalSetup([redis({ databases: 256 })])
```

```ts
import { getRedisUrl } from '@opengovsg/testcontainers'
import { getWorkerDatabaseIndex } from '@opengovsg/testcontainers/vitest'
import { createClient } from 'redis'
import { inject } from 'vitest'

const { redis } = inject('testcontainers')
const client = createClient({ url: getRedisUrl(redis) })
await client.connect()
await client.select(getWorkerDatabaseIndex(256)) // VITEST_POOL_ID % 256
```

`getWorkerDatabaseIndex` is client-agnostic: it hands you the index, and the `select` / `flushdb` calls stay in your app.
Keep its argument and `redis({ databases })` as one shared constant.

## E2E fixed-port pattern

Playwright e2e suites need a known URL, so pin fixed host ports and set `reuse: true`.

```ts
import { postgres, redis, setup } from '@opengovsg/testcontainers'

export const startContainers = () =>
  setup([
    postgres({ ports: [{ container: 5432, host: 64322 }], reuse: true }),
    redis({ ports: [{ container: 6379, host: 63800 }], reuse: true }),
  ])
```

Hold the `setup()` return for teardown and for commands run inside a container (e.g. `pg_dump` via the live `.container` handle).
For an in-container command, build the URL with `getPostgresConnectionString(pg, { internal: true })` so it targets the container-internal port.
With `reuse: true`, Ryuk stops the containers when the process exits, so do not call `teardown`.

For the full API and all patterns, see the [package README](https://github.com/opengovsg/starter-kitty/tree/develop/packages/testcontainers#readme), which also links to the generated API reference.
