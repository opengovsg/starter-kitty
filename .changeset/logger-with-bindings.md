---
'@opengovsg/starter-kitty-logging': minor
---

Add `Logger.withBindings({ userId })` to bind the acting user at the root of an
existing logger - for identity learned mid-request (e.g. self-signup), so
actor-scoped audit events attribute the actor instead of warning.
