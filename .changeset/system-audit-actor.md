---
"@opengovsg/logging": minor
---

Audit events on a `.system(...)` logger no longer require `client_ip` or `user_agent`, which a request-less logger cannot have. They still require `user_id`: bind the system actor with `withBindings({ userId })`. Request loggers are unchanged. See ADR-0011.
