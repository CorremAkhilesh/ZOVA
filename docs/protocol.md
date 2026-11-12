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

## Message actions

Edits, deletes, reactions, stars and chat preferences go over REST (`/v1/chats/:id/messages/:messageId…`,
`/v1/forward`, `/v1/chats/:id/prefs`). Each one is checked against what the person can see (`canSeeSeq`), and
each is safe to repeat, so a lost answer can never do it twice.

They are logged in the per-user update log, so an offline device catches up:

| Log kind       | Live event        | In `GET /v1/sync`                           |
| -------------- | ----------------- | ------------------------------------------- |
| `updated`      | `message:updated` | `updated`: the message as it is now         |
| `hidden`       | `message:removed` | `removed`: deleted for me on another device |
| `cleared`      | `chat:cleared`    | `cleared`: everything up to `seq` goes      |
| `chat_removed` | `chat:cleared`    | `cleared` with `removeChat`: the chat goes  |
| `chat`         | `chat:updated`    | `chats`: pin, mute, archive, unread         |

`updated` is separate from `messages` for one reason: a device applies it only to a message it already has.
Storing an old message it never loaded would leave a hole in its history that paging back could not see.

`reaction:preview` carries no number. It only updates the "Riya reacted" line in the chat list, for the
message's author; the reaction itself comes through `message:updated`, and sync brings the line with the chat.
`starred` is known only for the person who starred: an event that leaves it out means "keep what you have".

On the device, actions go through a queue in Dexie (`actions`): shown at once, sent in order by one tab, kept
across a reload or going offline. If the server refuses one, the device asks how things really are and shows why.

Clearing a chat stores one position (`clearedSeq`), not a row per message. Seeing and quoting both start after
`max(joinSeq, clearedSeq)`.

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

A block (either way) also hides presence: the server makes both people's sockets leave each other's watch
room at once and sends both `presence:resubscribe`, and later subscriptions answer "hidden".

## Account events

Things about my account that are not chats or messages reach my other devices directly, and are fetched
again whenever a socket reconnects (they are not in the sync log):

| Event              | When                                           | The app                           |
| ------------------ | ---------------------------------------------- | --------------------------------- |
| `settings:updated` | My chat settings changed (Keep chats archived) | Stores the new settings           |
| `blocks:changed`   | I blocked or unblocked someone                 | Fetches `GET /v1/me/blocks` again |
| `folders:updated`  | A folder was made, changed, moved or deleted   | Fetches `GET /v1/me/folders`      |
| `draft:updated`    | My draft of a chat changed on another device   | Keeps it if newer than its own    |

**Keep chats archived** (`PATCH /v1/me/chat-settings`, on by default): on, an archived chat stays archived
when new messages arrive. Off, a message from someone else clears `archivedAt` for that member in the same
transaction as the message; their `chat:updated` carries `archived: false`, and sync returns the chat as
unarchived. Writing in an archived chat never brings it back for the writer.

## Blocking

`PUT/DELETE /v1/me/blocks/:userId`, mine alone; the other person is not told. While either person has
blocked the other, in their **direct** chat:

- sending is refused: `BLOCKED` for the one who blocked, `CANNOT_MESSAGE` for the other (forwarding and
  replying privately go through the same send);
- typing goes nowhere, and presence is hidden both ways.

Always, whatever the chat: someone I blocked sees neither my photo nor my about (profiles, chat summaries,
group member lists, message info, and the avatar route answers 404); people who blocked me do not show in
my people search; my message search leaves out what people I blocked sent. Groups otherwise work as before.

## Reports

`POST /v1/reports` reports a person, messages or a group, with a reason, an optional note and
`block: true` for "report and block". The server copies the evidence at that moment: the picked messages
and the person's last 5 messages in that chat, only ones the reporter may see (history limits,
delete-for-me and clears apply). Later edits or deletes do not change the copy; files are named, not
copied. At most 20 reports an hour per person. Admins list, open and resolve reports
(`/v1/admin/reports…`); opening one and resolving it are written to the audit log (`report.view`,
`report.resolve`), and "deactivate" goes through the same path as Admin → Users.

## Link previews and search

See [ADR 0006](adr/0006-link-previews.md) (previews: fetched once by our server, SSRF rules, cache) and
[ADR 0005](adr/0005-message-search.md) (search: text index, visibility rules, local results first).
A message with a link has `hasLink: true` (the Links tab in chat info) and may carry a `linkPreview` copy,
which goes with a delete for everyone and when an edit removes every link.

## Formatting

Formatting is not stored: the text keeps its markers (`*bold*`, `_italic_`, `~strike~`, `` `code` ``,
` ``` ` blocks, `> ` quotes, `- ` lists), and the app renders them as React elements, never HTML.
Links are only ever `http(s)`, `mailto` or `tel`. The chat list and search show plain text.

## Chat folders

`GET/POST /v1/me/folders`, `PATCH/DELETE /v1/me/folders/:id`, `PUT /v1/me/folders/order` (collection
`chat_folders`, mine alone). A folder has a name (≤ 24), an optional emoji, picked chats (≤ 200, only
chats I am in) and rules: all groups, all 1:1 chats, unread, leave out muted, leave out archived. Picked
chats are always in; the "leave out" rules only remove chats a rule brought in. At most 10 folders
(`409 FOLDER_LIMIT_REACHED`, checked again after the insert so two devices cannot pass it together).
The app works out each folder's chats and its unread count from its local chat list.

## Pinned messages

`PUT /v1/chats/:id/messages/:messageId/pin` with `{ duration: '24h' | '7d' | '30d' }`, and `DELETE` to
unpin. Anyone in a 1:1 chat; in a group, as its **Pin messages** setting says (`all` or `admins`). At most
3 per chat: a fourth replaces the oldest. Pinning adds a system message ("X pinned a message", kind
`pinned`, value = the seq). Pins live on the chat (`pins`, with `expiresAt`). Every summary and
`chat:updated` lists only the pins **this member** may see (history limits, clears) whose time is not
up, so the app also hides expired ones. The `pins-cleanup` job (every 5 minutes) removes expired pins and
logs a sync change; it cannot reach sockets, so open apps rely on `expiresAt`. A delete for everyone
also removes the message's pin.

## Mentions

A message may carry `mentions: [{ userId, offset, length }]` (≤ 50, ranges inside the text, not
overlapping) and `mentionsEveryone`. Groups only. Each `userId` must be a current member and not the
sender. `@everyone` needs the group's **Mention everyone** setting (`admins`, the default, or `off`) and an
admin. An edit sends the mentions again; the server replaces them and updates who is mentioned.

Each member keeps `mentionSeqs` (the newest 50 unread mentions of them, `@everyone` included). Reading up
to a seq removes the mentions at or before it, and clearing the chat removes them all. Summaries and
`chat:updated` carry it, and the app shows "@" in the list and a jump button in the chat. Push (Step 18)
will use it to reach me through a mute. The app shows a mention of someone no longer in the group as
plain text.

## Drafts

`PUT /v1/chats/:id/draft` with `{ text, replyTo, updatedAt }`, mine alone and never shown to others. The
newest `updatedAt` wins: an older write is ignored (`applied: false`), and a time more than 60 s ahead of
the server is clamped. A draft change logs a `chat` change for my devices and emits `draft:updated`.
Sending clears it with an empty text and a new time, so a clear also wins over older drafts. Summaries
carry `draft`, where `null` means there never was one. The app saves 300 ms after typing stops and pushes 1 s
later, retrying on reconnect. A newer draft from elsewhere replaces mine unless I am typing.
