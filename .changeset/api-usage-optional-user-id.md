---
'@opengovsg/starter-kitty-logging': minor
---

Make `userId` optional across the `apiUsage` audit group. These events run on
machine/bearer-token requests that often have no authenticated user, so
requiring `user_id` in scope emitted a spurious "missing required scope field"
diagnostic. `user_id` is now optional throughout - dropped from `requiredScope`
and promoted from the payload only when supplied (for a user-bound key).

Each event still carries a required non-user principal so no API-usage line is
anonymous: `tokenId` on the token lifecycle events, and a new required `keyId`
(the API credential id, emitted as `context.key_id`) on
`sensitiveEndpointAccessed`.

Breaking for existing callers: `sensitiveEndpointAccessed` now requires a
`keyId` argument. `tokenIssued`'s `userId` changes from required to optional
(a safe widening).
