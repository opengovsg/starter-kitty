import { z } from 'zod'

/**
 * Wait strategy applied before a container is considered ready. Mirrors the
 * three `testcontainers` strategies confetti relied on; `timeout` is the
 * startup timeout in milliseconds (default 60000).
 *
 * @public
 */
export type WaitStrategy =
  | { type: 'PORT'; timeout?: number }
  | { type: 'LOG'; message: string; times?: number; timeout?: number }
  | { type: 'HEALTHCHECK'; timeout?: number }

/**
 * Declarative description of a single container. Ported from confetti's zod
 * schema minus `buildArgs` (it was declared but never applied).
 *
 * @public
 */
export interface ContainerConfiguration {
  /** Unique name; also used as the network alias when a network is passed. */
  name: string
  image: string
  /**
   * Ports to expose. A bare number requests a random host port; an object
   * pins a fixed host port (the e2e reuse pattern).
   */
  ports?: (number | { container: number; host: number })[]
  environment?: Record<string, string>
  command?: string[]
  extraHosts?: { host: string; ipAddress: string }[]
  /** `withReuse()` — e2e reruns share containers; Ryuk reaps them on exit. */
  reuse?: boolean
  wait?: WaitStrategy
}

const waitStrategySchema: z.ZodType<WaitStrategy> = z.union([
  z.object({ type: z.literal('PORT'), timeout: z.number().optional() }),
  z.object({
    type: z.literal('LOG'),
    message: z.string(),
    times: z.number().optional(),
    timeout: z.number().optional(),
  }),
  z.object({ type: z.literal('HEALTHCHECK'), timeout: z.number().optional() }),
])

/**
 * Zod schema validating a {@link ContainerConfiguration}. Unknown keys (such as
 * the removed `buildArgs`) are stripped.
 *
 * @public
 */
export const containerConfigurationSchema: z.ZodType<ContainerConfiguration> = z.object({
  name: z.string(),
  image: z.string(),
  ports: z.array(z.union([z.number(), z.object({ container: z.number(), host: z.number() })])).optional(),
  environment: z.record(z.string(), z.string()).optional(),
  command: z.array(z.string()).optional(),
  extraHosts: z.array(z.object({ host: z.string(), ipAddress: z.string() })).optional(),
  reuse: z.boolean().optional(),
  wait: waitStrategySchema.optional(),
})
