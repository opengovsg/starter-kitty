---
'@opengovsg/starter-kitty-logging': minor
---

Add the `resource` audit category — `logger.audit.resource.*`: `created`,
`updated`, `deleted`, and `ownershipTransferred`. This is the **mutation** side
of generic business entities (forms, projects, documents, …), complementing
`dataAccess` (read/export) and `userManagement` (accounts). Downstream actions:
the actor (`user_id`) and `client_ip` are scope-read; `ownershipTransferred`
records the previous/new owner as `context.from_owner_id`/`to_owner_id` (owners
are generic — user, team, org — not necessarily users) while the top-level
`user_id` stays the actor who performed it. Logs field names on update, never
values.
