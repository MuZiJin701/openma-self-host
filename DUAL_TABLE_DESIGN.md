# Event log ordering

This document records the retained core event contract. It is not a roadmap for
additional queue systems.

## Contract

- `pending_events` stores accepted user turn inputs until the Session executor promotes them.
- `session_events` stores processed events in promotion order.
- A Session is FIFO: one turn executes at a time; different Sessions may execute concurrently.
- Every processed event has a stable id and sequence; SSE and REST expose the same order.
- Cancellation marks queued input and never replays it as a new turn.
- Recovery scans durable pending/promoted rows and re-arms the Session without duplicating an event.

The model history is built only from processed events. A pending user message must never appear in
the assistant history before its turn begins. `system.user_message_pending`, promotion, and
cancellation events are UI/transport notifications, not extra model messages.

## Migration rule

The existing migration files and legacy tables stay in place. New code must use the current
tenant-scoped event and pending repositories. Do not clear data, rewrite historical migrations,
or add a second ordering primitive without a concrete failing test.
