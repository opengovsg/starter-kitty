---
'@opengovsg/starter-kitty-logging': minor
---

Promote `userId` to the canonical `user_id` facet on `sessionCreated` and
`sessionTerminated`, aligning them with their sibling `sessionTimedOut`. These
session events establish or operate on the bound identity, so `user_id` cannot
be assumed present in request scope: `sessionCreated` is the very call that
binds it, and termination may run outside a request (admin revoke, sweep).
Identity is therefore payload-borne - `userId` is now a required input field,
promoted to `user_id`, and only `client_ip` is required in scope.

Breaking for existing callers: `sessionCreated` and `sessionTerminated` now
require a `userId` argument.
