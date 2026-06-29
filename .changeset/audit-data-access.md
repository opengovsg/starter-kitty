---
'@opengovsg/starter-kitty-logging': minor
---

Add the `dataAccess` audit category — `logger.audit.dataAccess.*`:
`dataAccessed`, `recordDownloaded`, and `bulkExported`. Downstream events — the
actor (`user_id`) and `client_ip` are read from scope. They log *what* was
accessed (resource type/id, classification, size, export destination/filters),
never the data itself; the data "action taken" is named `accessType` to avoid
clashing with the Controlled `action` field.
