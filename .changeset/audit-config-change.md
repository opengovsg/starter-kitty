---
'@opengovsg/starter-kitty-logging': minor
---

Add the `configChange` audit category — `logger.audit.configChange.*`:
`securityConfigChanged` and `policyChanged` (the org-level policy changes —
ACLs, retention, logging, password/access policy — deferred from
`userManagement`). Admin actions: the actor (`user_id`) and `client_ip` are
read from scope; events log the setting/policy and non-sensitive old/new values.
