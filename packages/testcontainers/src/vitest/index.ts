/**
 * Vitest glue for `@opengovsg/starter-kitty-testcontainers`: a globalSetup
 * factory, typed provided context, and per-worker Redis logical-DB isolation
 * helper.
 *
 * @packageDocumentation
 */

import type { StartedNetwork } from 'testcontainers'
import type {} from 'vitest'
import type { TestProject } from 'vitest/node'

import type { ContainerConfiguration } from '../config.js'
import { type ContainerInformation, setup, type StartedContainerInformation, teardown } from '../setup.js'

/**
 * The Vitest provided-context key containing started container information.
 *
 * @public
 */
export const TESTCONTAINERS_CONTEXT_KEY = 'testcontainers'

/**
 * Handle-less container information keyed by configuration name.
 *
 * @public
 */
export type ProvidedContainers = Record<string, ContainerInformation>

declare module 'vitest' {
  export interface ProvidedContext {
    [TESTCONTAINERS_CONTEXT_KEY]: ProvidedContainers
  }
}

const toProvidedContainers = (containers: StartedContainerInformation[]): ProvidedContainers =>
  Object.fromEntries(
    containers.map(({ name, host, ports, configuration }) => [name, { name, host, ports, configuration }]),
  )

/**
 * Build a vitest `globalSetup` default export. The returned function starts the
 * given containers, publishes their handle-less info with Vitest's `provide`,
 * and returns a teardown callback Vitest runs after the suite. Test files can
 * read the information with `inject('testcontainers')`.
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
  async (project: TestProject): Promise<() => Promise<void>> => {
    const containers = await setup(configurations, options)
    project.provide(TESTCONTAINERS_CONTEXT_KEY, toProvidedContainers(containers))
    return () => teardown(containers)
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
