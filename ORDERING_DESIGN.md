# Session ordering primitive

The self-host runtime has one ordering rule: accepted turn inputs are persisted in a durable
pending queue, then promoted FIFO into the processed Session event log.

```text
POST user.message
  -> pending_events (pending_seq)
  -> Session FIFO executor
  -> session_events (seq)
  -> SSE/REST/model history
```

The queue and event log are user/session scoped. A process restart recovers pending and promoted
rows; duplicate event IDs are ignored. `user.interrupt` cancels queued inputs and interrupts the
active subprocess. This is intentionally the only scheduling contract in self-host.

Do not reintroduce scheduler, distributed queue, fanout, memory retention, or provider-specific
ordering layers without a new user requirement and an isolated regression test.
