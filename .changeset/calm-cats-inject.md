---
"@opengovsg/starter-kitty-testcontainers": minor
---

Replace the environment-variable Vitest handoff with typed `provide` and `inject` context. Container information is now available from `inject('testcontainers')`, keyed by container name; `getContainer`, the serialization helpers, and `TESTCONTAINERS_ENV_KEY` have been removed.
