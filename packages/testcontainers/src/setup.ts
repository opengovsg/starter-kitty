import type { StartedNetwork, StartedTestContainer } from 'testcontainers'
import { GenericContainer, Wait } from 'testcontainers'

import type { ContainerConfiguration } from './config.js'

/**
 * The serializable slice of a started container — what test files see after
 * the env handoff. `ports` maps each exposed container port to its mapped host
 * port.
 *
 * @public
 */
export interface ContainerInformation {
  name: string
  host: string
  ports: Map<number, number>
  configuration: ContainerConfiguration
}

/**
 * A {@link ContainerInformation} plus the live, non-serializable handle.
 *
 * @public
 */
export interface StartedContainerInformation extends ContainerInformation {
  container: StartedTestContainer
}

const DEFAULT_STARTUP_TIMEOUT_MS = 60 * 1000

/**
 * Start the given containers concurrently and return their connection info.
 * Faithful port of confetti's `common.ts` setup, with the optional network
 * moved into an options object.
 *
 * @public
 */
export const setup = async (
  configurations: ContainerConfiguration[],
  options: { network?: StartedNetwork } = {},
): Promise<StartedContainerInformation[]> => {
  const { network } = options

  const templates = configurations.map(configuration => {
    const { name, image, extraHosts, ports = [], environment, command, wait, reuse } = configuration

    let container = new GenericContainer(image)

    if (ports.length) {
      container = container.withExposedPorts(...ports)
    }
    if (extraHosts) {
      container = container.withExtraHosts(extraHosts)
    }
    if (environment) {
      container = container.withEnvironment(environment)
    }
    if (command) {
      container = container.withCommand(command)
    }
    if (network) {
      container = container.withNetwork(network).withNetworkAliases(name)
    }
    if (reuse) {
      container = container.withReuse()
    }
    if (wait) {
      const { timeout = DEFAULT_STARTUP_TIMEOUT_MS } = wait
      container = container.withStartupTimeout(timeout)
      switch (wait.type) {
        case 'PORT':
          container = container.withWaitStrategy(Wait.forListeningPorts())
          break
        case 'LOG':
          container = container.withWaitStrategy(Wait.forLogMessage(wait.message, wait.times ?? 1))
          break
        case 'HEALTHCHECK':
          container = container.withWaitStrategy(Wait.forHealthCheck())
          break
      }
    }

    return {
      name,
      container,
      configuration,
      containerPorts: ports.map(port => (typeof port === 'number' ? port : port.container)),
    }
  })

  return Promise.all(
    templates.map(async ({ name, container, configuration, containerPorts }) => {
      const started = await container.start()
      const ports = new Map<number, number>()
      for (const port of containerPorts) {
        ports.set(port, started.getMappedPort(port))
      }
      return {
        name,
        host: started.getHost(),
        ports,
        configuration,
        container: started,
      }
    }),
  )
}

/**
 * Stop and remove the given containers concurrently.
 *
 * @public
 */
export const teardown = async (containers: { container: StartedTestContainer }[]): Promise<void> => {
  await Promise.all(containers.map(({ container }) => container.stop({ remove: true })))
}
