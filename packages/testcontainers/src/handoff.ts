import { z } from 'zod'

import { containerConfigurationSchema } from './config.js'
import type { ContainerInformation, StartedContainerInformation } from './setup.js'

/**
 * The `process.env` key the global setup writes serialized container info to,
 * and test files read it back from.
 *
 * @public
 */
export const TESTCONTAINERS_ENV_KEY = 'testcontainers'

/**
 * Wire schema for the env handoff. Plain JSON (no superjson): the `ports` Map
 * travels as an array of `[containerPort, hostPort]` entries and is rebuilt
 * into a Map on parse.
 */
const containersWireSchema: z.ZodType<ContainerInformation[]> = z.array(
  z
    .object({
      name: z.string(),
      host: z.string(),
      ports: z.array(z.tuple([z.number(), z.number()])),
      configuration: containerConfigurationSchema,
    })
    .transform(c => ({ ...c, ports: new Map<number, number>(c.ports) })),
)

/**
 * Serialize started containers to a JSON string for the env handoff.
 *
 * @public
 */
export const serializeContainers = (containers: StartedContainerInformation[]): string =>
  JSON.stringify(
    containers.map(({ name, host, ports, configuration }) => ({
      name,
      host,
      ports: [...ports.entries()],
      configuration,
    })),
  )

/**
 * Parse a serialized handoff string back into container info.
 *
 * @public
 */
export const parseContainers = (serialized: string): ContainerInformation[] =>
  containersWireSchema.parse(JSON.parse(serialized))

/**
 * Read `process.env[TESTCONTAINERS_ENV_KEY]` and return the container with the
 * given name. Throws if the env var is absent or no container matches.
 *
 * @public
 */
export const getContainer = (name: string): ContainerInformation => {
  const serialized = process.env[TESTCONTAINERS_ENV_KEY]
  if (!serialized) {
    throw new Error(`process.env.${TESTCONTAINERS_ENV_KEY} is not set; did the global setup run?`)
  }
  const container = parseContainers(serialized).find(c => c.name === name)
  if (!container) {
    throw new Error(`No container named "${name}" in the env handoff`)
  }
  return container
}

/**
 * Return the mapped host port for a container port. Throws if unmapped.
 *
 * @public
 */
export const getMappedPort = (container: ContainerInformation, containerPort: number): number => {
  const mapped = container.ports.get(containerPort)
  if (mapped === undefined) {
    throw new Error(`Container "${container.name}" has no mapped port for ${containerPort}`)
  }
  return mapped
}
