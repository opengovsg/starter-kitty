# `@opengovsg/starter-kitty-testcontainers`

A declarative wrapper over [testcontainers](https://node.testcontainers.org/) for integration and e2e test setups.
It provides a zod-validated container config schema, `setup`/`teardown` over `GenericContainer`, a typed Vitest context handoff, Postgres and Redis presets, and Vitest glue helpers.

The package boots real containers, so a running Docker daemon is required wherever the tests run (locally and in CI).
If your Docker socket is in a non-standard location, set `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE` (and any other testcontainers daemon env) **before** the containers boot - e.g. at the top of your `globalSetup` module. testcontainers reads it when its Docker client first initialises.

## Install

```sh
pnpm add -D @opengovsg/starter-kitty-testcontainers testcontainers
```

`testcontainers` and `zod` are peer dependencies - you supply the versions your app already uses.
Vitest is an optional peer dependency; the Vitest glue lives at the `/vitest` subpath and is only needed if you use it.
This package is ESM-only (`"type": "module"`); import it from ESM or an ESM-aware bundler / test runner (vitest, Next). There is no CommonJS build.

### Snapshot builds

Prereleases are published under the `snapshot` dist-tag as `0.0.0-snapshot-<timestamp>` versions, for validating changes before a real release:

```sh
pnpm add -D @opengovsg/starter-kitty-testcontainers@snapshot
```

If your repo enforces a pnpm `minimumReleaseAge` install gate, exclude `@opengovsg/*` from it (`minimumReleaseAgeExclude`) - a freshly published snapshot is younger than any age threshold and will otherwise fail to resolve.

## Quickstart with presets

Start Postgres and Redis, then build connection strings from the started containers.

```ts
import {
  getPostgresConnectionString,
  getRedisUrl,
  postgres,
  redis,
  setup,
  teardown,
} from '@opengovsg/starter-kitty-testcontainers'

const containers = await setup([postgres(), redis()])
const [pg, cache] = containers

const databaseUrl = getPostgresConnectionString(pg) // postgresql://root:root@host:port/test?sslmode=disable
const redisUrl = getRedisUrl(cache) // redis://host:port

// ... run your tests against those URLs ...

await teardown(containers)
```

The `postgres()` preset is `postgres:latest` on container port 5432 with `POSTGRES_DB=test` / `POSTGRES_USER=root` / `POSTGRES_PASSWORD=root`.
The `redis()` preset is `redis` on container port 6379.
Both wait on their port before `setup` resolves.
By default each container gets a **random** host port; read the mapped port back with `getMappedPort(container, 5432)` or use the connection-string builders, which do that for you.

Presets take overrides.
`environment` merges per-key (so overriding one variable keeps the preset's others); every other key is replaced.

```ts
postgres({ image: 'postgres:16-alpine', environment: { POSTGRES_DB: 'app' } })
```

## Custom image config

Anything the presets do, you can spell out yourself with a plain `ContainerConfiguration`.
Use this for images that have no preset.

```ts
import { setup, type ContainerConfiguration } from '@opengovsg/starter-kitty-testcontainers'

const mockpass: ContainerConfiguration = {
  name: 'mockpass',
  image: 'opengovsg/mockpass:4.6.8',
  ports: [5156],
  environment: { SHOW_LOGIN_PAGE: 'true', MOCKPASS_NRIC: 'S8979373D' },
  wait: { type: 'LOG', message: 'MockPass listening on' },
}

await setup([mockpass])
```

Supported keys: `name` (also the network alias when a network is passed), `image`, `ports`, `environment`, `command`, `extraHosts`, `reuse`, and `wait`.
`wait` is one of three strategies:

- `{ type: 'PORT', timeout? }` - wait until the exposed ports listen.
- `{ type: 'LOG', message, times?, timeout? }` - wait until a log line appears.
- `{ type: 'HEALTHCHECK', timeout? }` - wait until the image's healthcheck passes.

`timeout` is the startup timeout in milliseconds (default 60000).
Validate untrusted config against the exported `containerConfigurationSchema` if you build it dynamically.
The schema strips unknown keys, so stray config (e.g. testcontainers options this wrapper does not model) is silently dropped rather than erroring.

## Vitest globalSetup wiring

Boot the containers once per run in a `globalSetup` file. The helper publishes their connection information through Vitest's typed provided context.

```ts
// tests/global-setup.ts
import { postgres, redis } from '@opengovsg/starter-kitty-testcontainers'
import { createGlobalSetup } from '@opengovsg/starter-kitty-testcontainers/vitest'

export default createGlobalSetup([postgres(), redis()])
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./tests/global-setup.ts'],
  },
})
```

`createGlobalSetup` starts the containers, calls `project.provide('testcontainers', ...)`, and returns the teardown callback Vitest runs after the suite.
Inside any test file, read the name-keyed container information with Vitest's `inject`:

```ts
// tests/db.test.ts
import { getPostgresConnectionString } from '@opengovsg/starter-kitty-testcontainers'
import { inject } from 'vitest'

const { postgres } = inject('testcontainers')
const databaseUrl = getPostgresConnectionString(postgres)
```

The `/vitest` import in the global setup registers the `testcontainers` key with Vitest's `ProvidedContext`, so `inject('testcontainers')` is fully typed.
The provided value contains container **info** (host, mapped ports, config) - not the live `StartedTestContainer` handle.
That is all you need to connect; wiring the actual Prisma / Redis client stays in your app.

## Redis worker isolation

Vitest runs test files across parallel workers.
To stop workers from clobbering each other's Redis state, give each worker its own Redis logical database.
Start Redis with enough databases, then have each worker `select` its own index.

```ts
// tests/global-setup.ts
export default createGlobalSetup([redis({ databases: 256 })])
```

```ts
// tests/setup.ts (per-file setup, e.g. via test.setupFiles)
import { getRedisUrl } from '@opengovsg/starter-kitty-testcontainers'
import { getWorkerDatabaseIndex } from '@opengovsg/starter-kitty-testcontainers/vitest'
import { createClient } from 'redis'
import { inject } from 'vitest'

const { redis } = inject('testcontainers')
const client = createClient({ url: getRedisUrl(redis) })
await client.connect()
await client.select(getWorkerDatabaseIndex(256)) // VITEST_POOL_ID % 256

beforeEach(() => client.flushDb()) // clean slate per test, scoped to this worker's DB
```

`getWorkerDatabaseIndex(databases = 16)` is a pure `VITEST_POOL_ID % databases`.
It is deliberately client-agnostic: it hands you the index, and the `select` / `flushDb` calls stay in your app so any Redis client works.
Keep the `databases` argument in sync with the `redis({ databases })` you started - there is no runtime guard that the two match, so define them as one shared constant.

## E2E fixed-port pattern

Playwright e2e suites need the app under test to reach the containers at a **known** URL, so random host ports do not work.
Pin fixed host ports and set `reuse: true` so reruns share the same containers instead of racing to re-bind the port.

```ts
// tests/e2e/setup/containers.ts
import { postgres, redis, setup } from '@opengovsg/starter-kitty-testcontainers'

const PG_HOST_PORT = 64322
const REDIS_HOST_PORT = 63800

export const startContainers = () =>
  setup([
    postgres({ ports: [{ container: 5432, host: PG_HOST_PORT }], reuse: true }),
    redis({ ports: [{ container: 6379, host: REDIS_HOST_PORT }], reuse: true }),
  ])
```

Point the app's `DATABASE_URL` / cache config at those fixed ports.
Do not call `teardown` here: with `reuse: true`, Ryuk (testcontainers' reaper) stops the containers when the process exits.
Give each concurrent suite its own host ports so they never collide.

### Holding the container handle for in-container commands

`setup()` returns the started containers, each carrying the live `.container` handle (`StartedTestContainer`).
Hold onto that return: e2e teardown and any command run **inside** a container - `pg_dump` / `pg_restore` for DB snapshotting, for instance, via the handle's `exec` method - need the live handle.
`inject('testcontainers')` deliberately returns handle-less info, so it is for the Vitest handoff, not for driving in-container commands.

A command running inside the container must reach Postgres/Redis at the container-internal port, not the mapped host port.
Pass `internal: true` to the connection-string builders for that address:

```ts
import { getPostgresConnectionString } from '@opengovsg/starter-kitty-testcontainers'

const [pg] = await startContainers()
const internalUrl = getPostgresConnectionString(pg, { internal: true }) // postgresql://root:root@localhost:5432/test?sslmode=disable
// then run pg_dump inside the container via pg.container's argv-array exec, e.g. ['pg_dump', internalUrl, '-f', '/tmp/snapshot.sql']
```

`getRedisUrl(container, { internal: true })` does the same for Redis (`redis://localhost:6379`).

## Extending `createGlobalSetup` with your own global setup

Most suites need setup of their own alongside the container boot - running migrations, seeding, or providing more test context.
There are three ways to do it, and none require changes to this package.
The one rule to remember: **anything that reads the provided context must run after the containers are up.**

### 1. Separate globalSetup entry (recommended)

Vitest composes an array of `globalSetup` files natively.
Keep ours as one entry and add yours _after_ it.
Setup runs in array order and teardown runs in reverse, so the containers come up first and go down last.

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    globalSetup: [
      './tests/global-setup.ts', // ours - boots containers
      './tests/migrate.ts', // yours - reads the provided context, runs migrations
    ],
  },
})
```

Later global setup entries receive the same project, so they can read the context directly:

```ts
// tests/migrate.ts
import type {} from '@opengovsg/starter-kitty-testcontainers/vitest'
import type { TestProject } from 'vitest/node'

export default async (project: TestProject) => {
  const { postgres } = project.getProvidedContext().testcontainers
  await runMigrations(postgres)
}
```

### 2. Wrap it

`createGlobalSetup(...)` returns a plain setup function.
Compose it in one file and chain your teardown before ours.

```ts
// tests/global-setup.ts
import { postgres } from '@opengovsg/starter-kitty-testcontainers'
import { createGlobalSetup } from '@opengovsg/starter-kitty-testcontainers/vitest'
import type { TestProject } from 'vitest/node'

const setupContainers = createGlobalSetup([postgres()])

export default async (project: TestProject) => {
  const stopContainers = await setupContainers(project) // containers up first
  const { postgres } = project.getProvidedContext().testcontainers
  await runMigrations(postgres)
  return async () => {
    await stopContainers() // reverse order on the way down
  }
}
```

### 3. Primitives

`createGlobalSetup` is just a convenience wrapper over the public primitives and Vitest's `provide` API.
Use `setup`, `project.provide`, and `teardown` directly to own the whole function.

```ts
import { postgres, setup, teardown } from '@opengovsg/starter-kitty-testcontainers'
import type { ProvidedContainers } from '@opengovsg/starter-kitty-testcontainers/vitest'
import type { TestProject } from 'vitest/node'

export default async (project: TestProject) => {
  const containers = await setup([postgres()])
  const [{ container: _handle, ...postgresInfo }] = containers
  project.provide('testcontainers', { postgres: postgresInfo } satisfies ProvidedContainers)
  // ... your own setup here ...
  return () => teardown(containers)
}
```

## API reference

The full generated API reference is published to the [starter-kitty docsite](https://opengovsg.github.io/starter-kitty/api/).
It covers the main entry only; the `/vitest` glue (`createGlobalSetup`, `ProvidedContainers`, `TESTCONTAINERS_CONTEXT_KEY`, and `getWorkerDatabaseIndex`) is documented here and in its source doc comments.
