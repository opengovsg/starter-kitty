/**
 * Vitest glue for `@opengovsg/starter-kitty-testcontainers`: a globalSetup
 * factory and per-worker Redis logical-DB isolation helper.
 *
 * @packageDocumentation
 */

import type { StartedNetwork } from 'testcontainers'

import type { ContainerConfiguration } from '../config.js'
import { serializeContainers, TESTCONTAINERS_ENV_KEY } from '../handoff.js'
import { setup, teardown } from '../setup.js'

/**
 * Build a vitest `globalSetup` default export. The returned function starts the
 * given containers, publishes their info to `process.env[TESTCONTAINERS_ENV_KEY]`
 * for test files to read back via `getContainer`, and returns a teardown
 * callback vitest runs after the suite.
 *
 * @example
 * ```ts
 * // tests/global-setup.ts
 * import { postgres, redis } from '@opengovsg/starter-kitty-testcontainers'
 * import { createGlobalSetup } from '@opengovsg/starter-kitty-testcontainers/vitest'
 *
 * export default createGlobalSetup([postgres(), redis({ databases: 256 })])
 * ```
 *
 * @public
 */
export const createGlobalSetup =
  (configurations: ContainerConfiguration[], options: { network?: StartedNetwork } = {}) =>
  async (): Promise<() => Promise<void>> => {
    const containers = await setup(configurations, options)
    process.env[TESTCONTAINERS_ENV_KEY] = serializeContainers(containers)
    return async () => {
      delete process.env[TESTCONTAINERS_ENV_KEY]
      await teardown(containers)
    }
  }

/**
 * Pick a Redis logical-DB index for the current vitest worker so parallel
 * workers never share state. Computed as `VITEST_POOL_ID % databases`;
 * `databases` defaults to Redis's built-in 16. Pair with a Redis started via
 * `redis({ databases })` and have the app call `client.select(index)` plus
 * `flushdb` itself (kept client-agnostic).
 *
 * @public
 */
export const getWorkerDatabaseIndex = (databases = 16): number => Number(process.env.VITEST_POOL_ID ?? 0) % databases
