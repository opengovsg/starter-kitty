# `@opengovsg/starter-kitty-testcontainers`

A declarative wrapper over [testcontainers](https://node.testcontainers.org/) for integration and e2e test setups.
It provides a zod-validated container config schema, `setup`/`teardown` over `GenericContainer`, an env-based handoff from global setup to test files, Postgres and Redis presets, and vitest glue helpers.

The package boots real containers, so a running Docker daemon is required wherever the tests run (locally and in CI).

## Install

```sh
pnpm add -D @opengovsg/starter-kitty-testcontainers testcontainers
```

`testcontainers` and `zod` are peer dependencies - you supply the versions your app already uses.
The vitest glue lives at the `/vitest` subpath and is only needed if you use it.

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

## Vitest globalSetup wiring

Boot the containers once per run in a `globalSetup` file, and read them back inside test files through the env handoff.

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

`createGlobalSetup` starts the containers, publishes their info to `process.env.testcontainers`, and returns the teardown callback vitest runs after the suite.
Inside any test file, `getContainer(name)` reads that info back:

```ts
// tests/db.test.ts
import { getContainer, getPostgresConnectionString } from '@opengovsg/starter-kitty-testcontainers'

const databaseUrl = getPostgresConnectionString(getContainer('postgres'))
```

The handoff crosses a process boundary as JSON, so `getContainer` returns container **info** (host, mapped ports, config) - not the live `StartedTestContainer` handle.
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
import { getContainer, getRedisUrl } from '@opengovsg/starter-kitty-testcontainers'
import { getWorkerDatabaseIndex } from '@opengovsg/starter-kitty-testcontainers/vitest'
import { createClient } from 'redis'

const client = createClient({ url: getRedisUrl(getContainer('redis')) })
await client.connect()
await client.select(getWorkerDatabaseIndex(256)) // VITEST_POOL_ID % 256

beforeEach(() => client.flushDb()) // clean slate per test, scoped to this worker's DB
```

`getWorkerDatabaseIndex(databases = 16)` is a pure `VITEST_POOL_ID % databases`.
It is deliberately client-agnostic: it hands you the index, and the `select` / `flushDb` calls stay in your app so any Redis client works.
Keep the `databases` argument in sync with the `redis({ databases })` you started.

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

## Extending `createGlobalSetup` with your own global setup

Most suites need setup of their own alongside the container boot - running migrations, seeding, injecting extra env, or `ctx.provide`.
There are three ways to do it, and none require changes to this package.
The one rule to remember: **anything that reads the handoff (`getContainer`) must run after the containers are up.**

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
      './tests/migrate.ts', // yours - reads getContainer, runs migrations
    ],
  },
})
```

### 2. Wrap it

`createGlobalSetup(...)` returns a plain setup function.
Compose it in one file and chain your teardown before ours.

```ts
// tests/global-setup.ts
import { getContainer, postgres } from '@opengovsg/starter-kitty-testcontainers'
import { createGlobalSetup } from '@opengovsg/starter-kitty-testcontainers/vitest'

const setupContainers = createGlobalSetup([postgres()])

export default async () => {
  const stopContainers = await setupContainers() // containers up first
  await runMigrations(getContainer('postgres')) // now safe to read the handoff
  return async () => {
    await stopContainers() // reverse order on the way down
  }
}
```

### 3. Primitives

`createGlobalSetup` is just a convenience wrapper over the public primitives.
Use `setup`, `serializeContainers` / `TESTCONTAINERS_ENV_KEY`, and `teardown` directly to own the whole function.

```ts
import {
  postgres,
  serializeContainers,
  setup,
  teardown,
  TESTCONTAINERS_ENV_KEY,
} from '@opengovsg/starter-kitty-testcontainers'

export default async () => {
  const containers = await setup([postgres()])
  process.env[TESTCONTAINERS_ENV_KEY] = serializeContainers(containers)
  // ... your own setup here ...
  return async () => {
    delete process.env[TESTCONTAINERS_ENV_KEY]
    await teardown(containers)
  }
}
```

## API reference

The full generated API reference is published to the [starter-kitty docsite](https://opengovsg.github.io/starter-kitty/api/).
It covers the main entry only; the `/vitest` glue (`createGlobalSetup`, `getWorkerDatabaseIndex`) is documented here and in its source doc comments.
