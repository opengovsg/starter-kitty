---
'@opengovsg/starter-kitty-logging': minor
---

Add the fixed-shape **audit helper layer** — `logger.audit.<category>.<event>`
(ADR-0006) — with the first two categories, `authn` and `userManagement`. Each
event has a type-enforced shape, stamps the Controlled `audit`/`category`/`event`
wire fields, separates actor (scope `user_id`) from target
(`context.target_user_id`), fires at a per-event `notice`/`warn`, and performs no
value transformation (secrets are unrepresentable; PII is a sink concern). Each
event's default message can be overridden via `messageOverride`. `.audit` is on
the server `Logger` only (not `BasicLogger`), built lazily.
