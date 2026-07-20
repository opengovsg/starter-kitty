---
"@opengovsg/starter-kitty-testcontainers": minor
---

Initial release: a declarative wrapper over `testcontainers` for integration and e2e test setups. Ships a zod-validated container config schema, `setup`/`teardown` over `GenericContainer`, an env-based handoff from global setup to test files, Postgres and Redis presets, connection-string builders (`getPostgresConnectionString` / `getRedisUrl`, with an `internal: true` option for commands run inside the container), and vitest glue (`createGlobalSetup`, `getWorkerDatabaseIndex`) at the `/vitest` subpath.
