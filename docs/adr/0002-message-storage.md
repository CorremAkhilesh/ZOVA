# ADR 0002: How messages are stored

- **Status:** accepted
- **Date:** 2026-11-04

## Context

Zuvo promises full history on every device: a new laptop or a phone that was offline for a week must
see the same conversation as everyone else. That requires the server to keep messages.

## Decision

1. **Messages are stored as readable text in MongoDB Atlas.** There is no application-level message
   encryption in v1.
2. **Protection comes from the platform:**
   - encryption at rest, provided by Atlas
   - TLS between the API and Atlas, and between browsers and the API
   - authorization on every route and socket event: only a chat's members can read it
3. **End-to-end encrypted "secret chats" are a v2 item** (CLAUDE.md §1). They would be a separate
   chat type, not a change to ordinary chats.

## Consequences

- **Good:** server-side search, full-history sync to new devices and multi-device all stay simple,
  and an account can be used from any browser without moving keys around.
- **Accepted risk:** anyone with database access can read messages, including Atlas administrators
  and whoever holds `MONGODB_URI`. Keep that credential in GitHub Secrets and `/srv/zuvo/*.env`
  only, and limit who can open the Atlas project.
- **Backups contain messages** and need the same care as the database.
- **Message ordering and catch-up** are described in [docs/protocol.md](../protocol.md).

## Alternatives considered

- **Application-level encryption with a server-held key:** protects only against a database-only
  leak, while adding key rotation and breaking search. Atlas encryption at rest covers most of the
  same risk with none of that work.
- **End-to-end encryption for all chats in v1:** conflicts with full history on new devices without
  key backup, a much larger project than v1 can carry.
