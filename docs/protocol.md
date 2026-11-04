# Messaging protocol

How messages are ordered, delivered and caught up. All payloads are Zod schemas in
`shared/protocol/src` (`rest/chats.ts`, `realtime/chat.ts`, `realtime/events.ts`).

## Two numbers

| Number | Scope    | Meaning                                                   |
| ------ | -------- | --------------------------------------------------------- |
| `seq`  | one chat | A message's position in its chat: 1, 2, 3… with no gaps   |
| cursor | one user | How many changes this user has had: 1, 2, 3… with no gaps |

`seq` orders a conversation and drives unread counts (`chat.seq − my lastReadSeq`). The cursor answers
a different question: "what did this device miss?"

## Sending

Client → server over the socket:

```
message:send { chatId, clientMsgId, text }
  ack { ok: true, data: { messageId, seq, createdAt, duplicate } }
    | { ok: false, error: { code, message, requestId } }
```

- **`clientMsgId`** is a UUIDv7 the client creates before sending, and reuses when it retries. It is
  unique per sender, so a retry after a lost ack returns the original message (`duplicate: true`) and
  nothing is delivered twice.
- **Limit:** 20 messages per 5 seconds per user, across all devices (`RATE_LIMITED`, with
  `details.retryAfterSeconds`).
- **One transaction:** the chat's `seq`, the message, every member's activity and every member's
  update log commit together. An aborted send leaves no gap in `seq`.

Every member's devices then get `message:new { message, cursor }` and
`chat:updated { chatId, seq, lastMessage, lastReadSeq, unreadCount, … , cursor }`, including the
sender's other devices. The sender's own device gets them too, so match on `clientMsgId`.

Read state: `read:update { chatId, seq }` (or `POST /v1/chats/:id/read`) moves my position forward,
never back. My devices get `read:update { chatId, lastReadSeq, unreadCount, cursor }`.

## The sync cursor

**In simple words:** the server keeps a numbered diary of changes for each user. Every new message in
one of your chats, every time you read further and every chat you open gets the next number in _your_
diary. A device remembers the last number it saw. When it comes back, it asks "what comes after
number 41?" and gets exactly the entries 42, 43, 44…

**How it is stored:**

- `user_sync` holds one counter per user.
- `user_updates` holds one row per change per user: `{ userId, pts, kind, chatId, seq? }`.
- Both are written in the same transaction as the change itself.

**Why there are no gaps:** incrementing a user's counter locks that counter until the transaction
commits. A second change for the same user waits for (or retries after) the first, so numbers become
visible strictly in order. Nobody can read number 6 while number 5 is still uncommitted. A plain
timestamp cannot promise this, because transactions can commit in a different order from their clocks.

**Why there are no duplicates:** each number is one change, used once (unique index on
`{ userId, pts }`), and sync returns only numbers above the cursor you pass.

### Using it

```
GET /v1/sync?since=<cursor>&limit=200
  { cursor, reset, hasMore, chats: ChatSummary[], messages: Message[] }
```

- **First start on a device:** call `GET /v1/sync` with no `since`. It answers `reset: true` and the
  current cursor. Save the cursor, **then** load `GET /v1/chats` and history. Anything arriving between
  the two steps is picked up by the next sync, and `seq` lets you ignore what you already have.
- **Going live:** every `message:new`, `chat:updated` and `read:update` carries `cursor`, this user's
  number after that change.
  - If it equals your cursor + 1, apply it and save the new cursor.
  - If it is higher, you missed something: call sync with your saved cursor.
  - If it is not higher, you already have it (`message:new` and `chat:updated` share one number).
- **On every reconnect:** call sync with your saved cursor. Repeat while `hasMore` is true.
- **`reset: true`** means the cursor cannot be caught up from: it is missing, from the future, or older
  than the log keeps (30 days). Replace your cursor with the returned one and reload the chat list.

The cursor is opaque: store it and send it back, and never do arithmetic on it other than the
comparison above.

## Sessions on the socket

The handshake uses the same session cookie as REST. It is refused without a valid session
(`connect_error` with `data.code`: `UNAUTHENTICATED`, `SESSION_EXPIRED` or `ACCOUNT_DEACTIVATED`), and
when the `Origin` is not ours.

The server sends `session:revoked { reason }` and closes the socket:

- **`revoked`:** the session was deleted, by logout, Devices or "This wasn't me".
- **`deactivated`:** an admin deactivated the account.
- **`expired`:** the session's 7 days are up (a timer per socket).

Do not reconnect after `session:revoked`. Every event also re-checks that the session still exists, in
case a push between API instances was lost.

## Scaling

Rooms are `user:<userId>` and `session:<sessionId>`. The Redis adapter carries events and revocations
between API instances. Without `REDIS_URL` (development only), events reach one instance.

## Reserved for later steps

`typing:start`, `typing:stop`, `typing:update`, `presence:update` and `receipt:update` have schemas but
no behaviour yet: the client events are answered with `BAD_REQUEST`.
