---
'@opengovsg/starter-kitty-logging': minor
---

Add the `failures` audit category — `logger.audit.failures.*`: `accessDenied`,
`privilegeEscalationDenied`, and `sensitiveActionBlocked`. These are *handled*,
security-relevant denials and fire at `warn` (the control worked).
`accessDenied` may be unauthenticated, so its actor is optional. Application
*errors* still go through the base `error()`, and anomaly detection remains a
sink concern.
