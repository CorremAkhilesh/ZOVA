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

## The client

Screens read only from a per-user Dexie database (`features/sync/local-db.ts`); network results are
written into it, so the app works the same offline.

- **Applying changes** is safe to repeat. A message's key is `senderId:clientMsgId` (or its server id),
  so the ack, the `message:new` echo, sync and history all land on one row. Chat positions only move
  forward. A live event that skips a number, or names an unknown chat, is not applied: it triggers sync.
- **Sending:** the message and its outbox row are written first, so a reload or going offline loses
  nothing. Normally one tab sends (a Web Lock), strictly in order, one message at a time. If a message
  stays unsent for 5 seconds any connected tab sends it, because the holder may be stuck; the server's
  clientMsgId check makes that safe. An unanswered send (10 s, and the socket is replaced) or a server
  error is retried, 3 tries in all, then the message shows "Not sent — tap to retry". An error that
  cannot succeed fails at once. Being offline never counts as a failure.
- **Settling:** acks and live events are only the fast path. Every 30 s, a client with unsent messages
  wakes its outbox and uploader and reads the newest page of those chats from the server, whose rows
  replace local ones by `senderId:clientMsgId`. Upload requests have deadlines, so a lost answer cannot
  block the queue. Screens re-read local data every 20 s while visible, on focus, and after a failed
  read (logged as `[live]`, and shown in the diagnostics panel).
- **Groups:** `joinSeq` and `leftSeq` on the membership decide which positions someone may see, in history,
  sync, the gallery and media downloads. A member who left sees the group as it was then. Ticks use one
  delivered and one read mark per group (the lowest across members), which only move forward and are
  announced once per move rather than once per person. Someone with read receipts off counts for the read
  mark once their device has the message. Chat-list order for a group is written at most once a second.
- **Other tabs** see every change through Dexie, and hear about new outbox rows and ended sessions on a
  BroadcastChannel.
- **Wiping:** whenever a session ends (sign-out, revoked, expired, deactivated, or found to be gone on
  opening the app), every local database and the recent-people list are deleted.

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

## Receipts

Each member of a chat has two positions, which only move forward: `lastDeliveredSeq` (some device of
theirs stored the message) and `lastReadSeq`. A device sends `delivered:update { chatId, seq }`, batched,
for whatever it stores by any route. A second device reporting the same position changes nothing.
Reading also counts as delivered, and sending counts as both.

The sender's devices get `receipt:update { chatId, userId, lastDeliveredSeq, lastReadSeq, cursor }`. It
has a number in the sender's diary, so a sender who was offline catches up through sync, which returns
the chat with `peerDeliveredSeq` and `peerReadSeq`.

**Read receipts are reciprocal and enforced here, as on WhatsApp:** each member also has `sharedReadSeq`,
what others may know they have read. It follows `lastReadSeq` while both people have receipts on, and
stays put while either has them off, so what was already shown as read stays read and nothing newer
ever leaves the server. Reading then sends nothing unless delivered moved too.

## Typing

`typing:start` and `typing:stop` reach only the other members' sockets, and are never stored. The server
ends "typing" 6 s after the last `typing:start`, and when the socket goes away. Clients send at most one
per 3 s, and the server allows 20 per 10 s per socket.

## Presence

Someone is **online** while any of their sockets is active. Each socket has an entry in Redis that a
heartbeat renews (15 s) and that expires (45 s), so a crashed API instance's sockets go offline: another
instance's sweep notices and reports each once. Without Redis, one instance keeps this in memory.

**Away:** a tab hidden for over 60 s reports `presence:active { active: false }` and counts as offline for
others until it is visible again. We chose this so "online" means someone is probably there; the socket
stays connected, and messages and receipts keep flowing, so such a device still shows as delivered.

A client sends `presence:subscribe { userIds }` with everyone it wants to know about: the open chat and
the visible chat list rows, at most 100. Each list replaces the last. There is no global broadcast.

**Privacy is reciprocal and enforced here:** if either person hides last seen & online, or they share no
chat, the answer is `{ online: false, lastSeenAt: null }` and no events are sent. A hidden person looks
the same as one who never appeared. Changing the setting takes effect immediately on the server, and
`presence:resubscribe` asks the clients involved for a fresh answer.

`lastSeenAt` is stored on the user when the last socket goes, at most once per 30 s per API instance, so
a flapping connection does not hammer MongoDB.
