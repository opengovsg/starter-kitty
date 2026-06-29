---
'@opengovsg/starter-kitty-logging': minor
---

Add the `apiUsage` audit category — `logger.audit.apiUsage.*`: `tokenIssued`,
`tokenRefreshed`, `tokenInvalidated`, and `sensitiveEndpointAccessed`. Token
identifiers are references, never the token value. Anomaly/abuse detection is
deliberately excluded — that is a sink/SIEM concern over these lines, not
something the app knows at log time.
