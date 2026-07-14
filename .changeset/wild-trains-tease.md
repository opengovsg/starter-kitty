---
"@opengovsg/starter-kitty-logging": minor
---

`traceId` is now optional on request loggers (`LoggerOptions`).
Trace correlation should come from dd-trace log injection (`DD_LOGS_INJECTION`, on by default), which stamps `dd.trace_id` from the active span onto every line - resolved per line, so it also works across jobs, queues, and cron, where no request headers exist.
Passing `traceId` still binds a root `trace_id` for non-APM sinks; existing callers are unaffected.
