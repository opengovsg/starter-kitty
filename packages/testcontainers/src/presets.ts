import type { ContainerConfiguration } from './config.js'
import { getMappedPort } from './handoff.js'
import type { ContainerInformation } from './setup.js'

/**
 * Merge overrides onto a base config: shallow for all keys, but `environment`
 * merges per-key so overriding one var keeps the preset's others.
 */
const withOverrides = (
  base: ContainerConfiguration,
  overrides: Partial<ContainerConfiguration>,
): ContainerConfiguration => {
  const environment =
    base.environment || overrides.environment ? { ...base.environment, ...overrides.environment } : undefined
  const merged = { ...base, ...overrides }
  if (environment) {
    merged.environment = environment
  }
  return merged
}

/**
 * Postgres preset: `postgres:latest` on port 5432 with
 * `POSTGRES_DB=test`/`POSTGRES_USER=root`/`POSTGRES_PASSWORD=root`, waiting on
 * the port. Overrides shallow-merge; `environment` merges per-key.
 *
 * @public
 */
export const postgres = (overrides: Partial<ContainerConfiguration> = {}): ContainerConfiguration =>
  withOverrides(
    {
      name: 'postgres',
      image: 'postgres:latest',
      ports: [5432],
      environment: {
        POSTGRES_DB: 'test',
        POSTGRES_USER: 'root',
        POSTGRES_PASSWORD: 'root',
      },
      wait: { type: 'PORT' },
    },
    overrides,
  )

/**
 * Redis preset: `redis` on port 6379, waiting on the port. `databases` starts
 * the server with `--databases n` for per-worker logical-DB isolation
 * (confetti uses 256).
 *
 * @public
 */
export const redis = (
  overrides: Partial<ContainerConfiguration> & { databases?: number } = {},
): ContainerConfiguration => {
  const { databases, ...rest } = overrides
  const base: ContainerConfiguration = {
    name: 'redis',
    image: 'redis',
    ports: [6379],
    wait: { type: 'PORT' },
  }
  if (databases !== undefined) {
    base.command = ['redis-server', '--databases', String(databases)]
  }
  return withOverrides(base, rest)
}

/**
 * Build a Postgres connection string from container info. Credentials are read
 * back from `configuration.environment`; `database` overrides the DB name (the
 * confetti per-run `randomUUID()` pattern).
 *
 * By default the URL targets the mapped **host** port, for connecting from the
 * test process. Pass `internal: true` for the container-internal address
 * (`localhost:5432`) needed by commands run *inside* the container, e.g.
 * `pg_dump`/`pg_restore` via `StartedTestContainer.exec`.
 *
 * @public
 */
export const getPostgresConnectionString = (
  container: ContainerInformation,
  options: { database?: string; internal?: boolean } = {},
): string => {
  const env = container.configuration.environment ?? {}
  const user = env.POSTGRES_USER ?? 'root'
  const password = env.POSTGRES_PASSWORD ?? 'root'
  const database = options.database ?? env.POSTGRES_DB ?? 'test'
  const host = options.internal ? 'localhost' : container.host
  const port = options.internal ? 5432 : getMappedPort(container, 5432)
  return `postgresql://${user}:${password}@${host}:${port}/${database}?sslmode=disable`
}

/**
 * Build a `redis://host:port` URL from container info. Defaults to the mapped
 * host port; pass `internal: true` for the container-internal address
 * (`localhost:6379`) used by commands run inside the container.
 *
 * @public
 */
export const getRedisUrl = (container: ContainerInformation, options: { internal?: boolean } = {}): string => {
  const host = options.internal ? 'localhost' : container.host
  const port = options.internal ? 6379 : getMappedPort(container, 6379)
  return `redis://${host}:${port}`
}
