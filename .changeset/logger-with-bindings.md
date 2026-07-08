---
'@opengovsg/starter-kitty-logging': minor
---

Add `Logger.withBindings({ userId })` and `Logger.setBindings({ userId })` to
bind the acting user at the root of an existing logger - for identity learned
mid-request (e.g. self-signup), so actor-scoped audit events attribute the
actor instead of warning. `withBindings` returns a new logger; `setBindings`
mutates in place, so the actor persists for the rest of the logger's lifecycle.
