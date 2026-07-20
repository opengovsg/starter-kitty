/**
 * A declarative wrapper over {@link https://node.testcontainers.org/ | testcontainers}
 * for integration and e2e test setups: a zod-validated container config schema,
 * `setup`/`teardown` over `GenericContainer`, env-based handoff from global setup
 * to test files, and Postgres/Redis presets.
 *
 * @packageDocumentation
 */

export * from './config.js'
export * from './handoff.js'
export * from './presets.js'
export * from './setup.js'
