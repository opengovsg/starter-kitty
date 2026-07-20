# @opengovsg/starter-kitty-testcontainers

## 0.1.0

### Minor Changes

- [#86](https://github.com/opengovsg/starter-kitty/pull/86) [`dd190bd`](https://github.com/opengovsg/starter-kitty/commit/dd190bd78e564e389c4a7aec50fd17d478f49679) Thanks [@karrui](https://github.com/karrui)! - Initial release: a declarative wrapper over `testcontainers` for integration and e2e test setups. Ships a zod-validated container config schema, `setup`/`teardown` over `GenericContainer`, an env-based handoff from global setup to test files, Postgres and Redis presets, connection-string builders (`getPostgresConnectionString` / `getRedisUrl`, with an `internal: true` option for commands run inside the container), and vitest glue (`createGlobalSetup`, `getWorkerDatabaseIndex`) at the `/vitest` subpath.
