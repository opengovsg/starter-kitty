---
'@opengovsg/starter-kitty-logging': patch
---

Merge the logger's scoped context into audit lines

`logger.scope({ context }).audit.*({ context })` now merges the scoped context
into the emitted audit line (low to high: scoped, event fields, per-call),
instead of dropping it. The merged context passes the same Context guard as a
routine line. See ADR-0008.
