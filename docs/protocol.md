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

In a group, `lastMessage.senderName` is the sender's display name when the message was sent, so the
chat list reads "Asha: …" before any member profile has loaded. It is not updated on a rename: the old
name stays until that member's next message, unless the device already has their newer profile. It is
`null` for system messages and in direct chats, and missing from chats last written before it existed.

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
per 3 s, and the server allows 20 per 10 s per socket. The members are read again on every `typing:start`
(no cache), so someone removed from a group hears nothing more at once, on every instance, and someone
added hears it at once. "Stopped" goes only to those told "typing" who are still members.

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

| Event                 | When                                            | The app                               |
| --------------------- | ----------------------------------------------- | ------------------------------------- |
| `settings:updated`    | My chat settings changed (Keep chats archived)  | Stores the new settings               |
| `blocks:changed`      | I blocked or unblocked someone                  | Fetches `GET /v1/me/blocks` again     |
| `folders:updated`     | A folder was made, changed, moved or deleted    | Fetches `GET /v1/me/folders`          |
| `draft:updated`       | My draft of a chat changed on another device    | Keeps it if newer than its own        |
| `scheduled:updated`   | My scheduled messages changed (or one failed)   | Fetches them again; a toast if failed |
| `lock:updated`        | My PIN, app lock or biometric unlock changed    | Fetches `GET /v1/me/lock`             |
| `quiet-hours:updated` | My Do Not Disturb settings changed              | Stores them                           |
| `appearance:updated`  | My accent, default wallpaper or dimming changed | Applies them                          |

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

## Scheduled messages

`POST/GET /v1/me/scheduled`, `PATCH/DELETE /v1/me/scheduled/:id`, `POST …/:id/send-now`, mine alone.
At most 50 waiting per person (`409 SCHEDULED_LIMIT_REACHED`), up to a year ahead. Each item stores a
`clientMsgId` when it is made, and the send goes through the normal `sendMessage`, so it can never be sent
twice and every rule is checked again at the time (still a member, not blocked, announcement mode,
accounts active). If one fails, the item is marked `failed` with a reason, and `scheduled:updated` tells
my devices.

Sending runs in the **API process**, because only it can reach sockets. With Redis, each item has a
BullMQ delayed job (`sched-<id>-<sendAtMs>`; an edit replaces it). With or without Redis, a MongoDB sweep
runs at startup and every 15 s. It claims due items atomically, and it is the only path in development,
E2E and tests. A send stuck for 2 minutes is retried (safe through `clientMsgId`). Uploads waiting in a
scheduled message are never removed as orphans.

**Files and voice notes.** An item is text, or one finished upload (`mediaId`) with an optional caption in
`text` (photo, video, document, audio or voice note). The upload must be mine, complete, not in a message
yet and not waiting in another scheduled item (`409 MEDIA_NOT_ATTACHABLE`); `sendMessage` checks it again
at the time, and a file gone by then fails the item with `media_unavailable`. Scheduled files are never
view once. The app uploads first, in the foreground ("Uploading… n%"), when the time is picked from the
Send button's menu in the preview sheet or the voice recorder (right click or long press), then schedules
one item per file, all at that time: an album arrives as separate messages.

## Polls

A message of type `poll` carries `poll: {question, options:[{id, text, voterIds}], multiple, closedAt}`.
It is sent like text (`message:send` with `poll`), in groups and 1:1 chats, not in Saved Messages.
`PUT /v1/chats/:id/messages/:messageId/vote {optionIds}` replaces my whole choice (`[]` removes it). The
vote is open to members who may see the message (history limits apply), with at most one option unless
`multiple`. `POST …/close-poll` is for its sender (`409 POLL_CLOSED` afterwards). Both log a sync update and
send `message:updated`. Polls cannot be edited or forwarded. The chat list shows the question, and the
app adds "📊 Poll:".

## Disappearing messages and view once

See [ADR 0007](adr/0007-disappearing-and-view-once.md). `PUT /v1/chats/:id/disappearing {timer}` (`off`,
`24h`, `7d`, `90d`): either person in a 1:1 chat; in a group, as its **Disappearing messages** setting
says (admins by default). It adds a `disappearing_changed` system message. A new chat starts with its
creator's `privacy.defaultDisappearing` (a group says so in a notice; a 1:1 chat quietly). New messages
carry `expiresAt`. A sweep in the API (every 30 s) deletes expired messages with their stars, pins and
files (a file stays while a forwarded copy uses it), fixes the chat's last message, and sends
`messages:expired {chatId, seqs}`. The app also removes its own copies by `expiresAt` every 30 s and on
start, so a device that was offline forgets them too. E2E uses `POST /v1/test/expire-messages` (test
only).

**View once:** a photo or video sent with `viewOnce: true` never has a thumbnail or placeholder, and
`/link` refuses it for everyone. `POST /v1/chats/:id/messages/:messageId/view-once` gives a recipient one
short-lived link and records the open; a second try is `410 VIEW_ONCE_OPENED`. Once every recipient
opened it, or after 14 days, the file is deleted. A browser cannot block screenshots; the app says so.

## Chat lock and app lock

`GET /v1/me/lock`, `PUT/DELETE /v1/me/lock/pin`, `POST /v1/me/lock/verify`, `PATCH /v1/me/lock/settings`,
`PUT /v1/chats/:id/lock`. The PIN (4–6 digits) is stored only as an argon2id hash (19 MiB, t=2, p=1),
mixed with a secret derived from `AUTH_SECRET`. Rotating that secret means everyone resets their PIN by
email. After 5 wrong PINs it locks for 1 minute, then 2, 4… up to 1 hour (`429 PIN_LOCKED_OUT`). A correct
PIN, a fingerprint or an email reset clears it. **Forgot PIN:** `POST /v1/me/lock/reset/request` emails a
6-digit code (same limits as sign-in), and `…/reset/verify` removes the PIN. Chats stay, still flagged
locked, until a new PIN is set. **Biometric unlock** (WebAuthn, platform authenticators only): `rpID` is
`APP_URL`'s host, origins are `APP_URL` + `CORS_ORIGINS`. Browsers allow it only on https or
`http://localhost`, never on `http://127.0.0.1`.

Locked chats are flagged on my membership (`locked`). The app keeps them behind "Locked chats", opens
them for 5 minutes after the PIN (in memory and sessionStorage), and never shows their text in the list,
the palette or search. Server message search leaves them out. Until the PIN, Starred messages, the
forward picker and the chat's media gallery show one "hidden — unlock" line instead of locked chats.
`GET /v1/stars` leaves locked chats out (`lockedHidden: true`) unless `includeLocked=true`, which the
app sends only while its unlock lasts; the server does not know about that 5-minute unlock, so this
is a default, not a proof. The lock keeps other people's eyes off a shared screen; it does not
encrypt what this device stores.

## Quiet hours

`GET/PUT /v1/me/quiet-hours`: `mode` (off, on, scheduled), start/end (`HH:MM`, overnight allowed), days
and an IANA time zone (India by default), plus exceptions (mentions, up to 50 chats of mine). The
protocol's `isQuietAt()` decides when it is quiet; Step 18's push will use `quietHoursFor()` on the
server. The app shows a moon while it is quiet. It has no in-app sounds or toasts for incoming messages
yet, so `shouldAlert()` is ready for Step 18.

## Language

`language` (`en` | `hi`, English until chosen) is part of the profile: `PATCH /v1/me/profile { language }`,
returned by `GET /v1/me/profile` and in the session user (`GET /v1/auth/me`). The server writes in it:
push notifications, and the OTP, new-login and PIN-reset emails. An OTP for an address with no account
(or none chosen yet) follows the request's `Accept-Language` (the app sends its own language), else
English. In the app, the server's value wins at start-up, sign-in and every session refresh; a choice
made on the device is applied at once and kept as pending until saved, so an offline change is not undone.
A brand-new account (still naming itself) takes the device's language.

## Appearance

`GET/PATCH /v1/me/appearance`: one of six accents (each tested for AA contrast in light and dark, applied
through `<html data-accent>`), a default wallpaper (pattern, colour or one of my pictures) and dimming
for the dark theme. `PUT /v1/chats/:id/wallpaper` sets one chat's own wallpaper. Pictures:
`POST /v1/me/wallpapers` (≤ 10 MB, magic bytes, re-encoded to WebP ≤ 2560 px, through the StorageDriver,
10 per person), `GET` to list or fetch my own, `DELETE` (which also resets any wallpaper using it).

## Notifications

Web Push (Step 18, `docs/adr/0008-web-push.md`). Schemas: `shared/protocol/src/rest/push.ts`.

| Endpoint                          | Purpose                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| `GET /v1/me/push`                 | `{ publicKey, settings, devices }`; `publicKey` null: push is off here  |
| `PUT /v1/me/push/subscription`    | This device's `PushSubscription.toJSON()` (https only) → `{ device }`   |
| `DELETE /v1/me/push/subscription` | `{ endpoint }`, mine only → `{ removed }`                               |
| `DELETE /v1/me/push/devices/:id`  | One of my devices (someone else's is 404) → `{ removed }`               |
| `PUT /v1/me/push/settings`        | `{ showPreview?, sound? }`, only what is sent → `{ settings }`          |
| `POST /v1/me/push/test`           | A `test` push to this device's subscriptions → `{ sent }`               |
| `POST /v1/chats/:id/read`         | The notification's "Mark as read" (same as `read:update`), plus `badge` |
| `POST /v1/chats/:id/reply`        | Inline "Reply": `{ clientMsgId, text }`, every send rule → the send ack |

A subscription belongs to the **session** that registered it (one per device; a new endpoint replaces
the old one, and an endpoint signed in by someone else moves to them). It is deleted when the session
ends: sign-out, a revoke (one or all others), "This wasn't me", deactivation, expiry (a TTL index on the
session's absolute expiry, plus a check at send time), and when the push service answers 404/410. Keys
are checked: `p256dh` a P-256 point (65 bytes), `auth` 16 bytes, both base64url.

**Events.** `window:state` (client → server, `{ visible, focused }`): sent on every change and after
(re)connecting. A device is _attended_ while any of its sockets is visible and focused. It is kept in
Redis per session with a 45 s expiry refreshed every 15 s, so a crashed instance cannot silence anyone
(in memory without Redis); a disconnect clears it. `push:updated` (server → my devices, `{ settings }`):
settings or devices changed, fetch `GET /v1/me/push` again.

**When.** Every stored message (socket, scheduled, forward, polls, reply) schedules a job per other
member who has a device: one delayed job per person and chat (BullMQ `push` queue, deduplicated for
`PUSH_COALESCE_SECONDS`, processed by the worker; in-process timers without Redis, in tests and E2E).
The job re-reads everything at send time and runs `decidePush()` for each new message, then per device:

| Skip reason   | When                                                                              |
| ------------- | --------------------------------------------------------------------------------- |
| `own_message` | I sent it (another device of mine)                                                |
| `system`      | A system line (member added, …)                                                   |
| `deleted`     | Deleted for everyone                                                              |
| `expired`     | A disappearing message already due                                                |
| `not_visible` | Before I joined or cleared the chat, or after I left or was removed               |
| `hidden`      | Deleted for me                                                                    |
| `read`        | I have read up to it meanwhile (on any device)                                    |
| `blocked`     | 1:1, blocked either way                                                           |
| `muted`       | Chat muted, unless the message mentions me (`@everyone` counts)                   |
| `quiet_hours` | Quiet now, unless an exception: a mention (`allowMentions`) or an allowed chat    |
| `attended`    | Per device: one of its tabs is visible and focused; my other devices still get it |

The job also skips `not_member`, `deactivated`, `no_devices`, `already_notified` (each message is
notified at most once: `pushedSeq` on my membership, claimed atomically) and `rate_limited`
(`PUSH_USER_PER_MINUTE` per person; the rest join the next notification). If every device failed for a
passing reason, the claim is given back and the queue retries (3 attempts, exponential backoff).

**Payload** (`pushPayloadSchema`, well under 3 KB, no ids but `chatId`): 1:1 shows the sender's name and
the text; a group its name and "Riya: text"; media as "📷 Photo", "🎤 Voice message (0:12)", "📊 Poll: …"
(view once: its label only); cut at `PUSH_BODY_MAX` with "…", plus "(+N more)" for a coalesced burst.
With the preview off, a locked chat or app lock: title "New message", empty body, `hidden: true`.
`tag` is `chat:<id>` (one notification per chat), `seq` is what "Mark as read" reads up to, `badge` counts
chats with something unread or marked unread (as the app does), `silent` means sound off. A quiet-hours
exception sounds: that is why it was let through. The text is in the recipient's profile language when
one is set (English, Hindi). Logs say sent, skipped (reason) or failed (status, push service host), never
text or endpoints.

**Tests and E2E** (`NODE_ENV=test`): an in-memory sender records every push.
`GET /v1/test/push/outbox?email=…` returns
`{ pushes: [{ sessionId, endpoint, payload, urgency, ttlSeconds, at }] }` (oldest first);
`DELETE /v1/test/push/outbox` clears it. Any https endpoint can be registered with keys of the right
shape, e.g. `p256dh` = "B" followed by 86 "A", `auth` = 22 "A". The E2E server collects bursts for
`E2E_PUSH_COALESCE_MS` (default 500 ms).
