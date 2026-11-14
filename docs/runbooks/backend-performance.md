# Backend performance (Step 20, Part D)

The review of the backend's connection and transport settings, the index coverage check, and the
local load test. How to run the load test: `docs/runbooks/load-test.md`. The real load test runs
on the server in a later step.

## 1. Index coverage (CLAUDE.md §8)

`pnpm --filter @zuvo/backend index:coverage` scans every Mongoose query call site in `backend/src`
(find, findOne, findById, update*, delete*, findOneAnd*, countDocuments, distinct, exists,
aggregate, bulkWrite, and driver calls on `Model.collection`) and matches each to an
`expectIndexedQuery()` test of the same model and filter fields. The report is
`docs/runbooks/index-coverage.md` (generated; `--check` exits 1 on a gap, ready for CI).

|                                                                   | Before | After                               |
| ----------------------------------------------------------------- | ------ | ----------------------------------- |
| Query call sites                                                  | 342    | 343 (one added meanwhile by Part 0) |
| Covered by a test of the same shape                               | 157    | 166                                 |
| Covered by the `_id` index (equality / `$in` on `_id`)            | 175    | 176                                 |
| Reviewed by hand (sync's `$or` built with `.map()`, see the note) | 1      | 1                                   |
| **Gaps**                                                          | **9**  | **0**                               |

The 9 gaps all had a suitable index already (no index change needed); they lacked a test:
`SecurityToken` by `tokenHash` (claim and lookup), `LinkPreview` by `key`, `PushSubscription` by
`sessionId`, `MessageHidden` by `userId` (search), and by `chatId + messageId` (view once, expiry).
New tests: `src/db/token-preview-indexes.test.ts`, plus cases in
`src/chats/message-action-indexes.test.ts` and `src/push/push-indexes.test.ts`.

The scanner is text-based (no compiler API in TypeScript 7): it follows filter variables, `...spread`
of local objects, filter-building helpers, `cond ? {…} : {…}` (each branch must be covered) and
`filter.x = …` assignments (optional fields). It matches shapes, not operators, so a partial index
still needs a test with the same `$type`/`$exists`; the tests run `explain()` and are the real check.

**Slow query log:** exists for the API (`src/db/slow-query.ts`, ≥ 100 ms, collection + redacted
shape, never values). The **worker had none**: it now has one too (see 2).

## 2. MongoDB client (`src/db/mongo-options.ts`)

| Setting                                         | API     | Worker  | Why                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxPoolSize`                                   | 20      | 5       | A send is one transaction of ~12 round trips. At in-region Atlas round trips (1–5 ms) one connection carries 15–80 sends/s, so 20 covers several hundred sends/s with headroom. The worker runs a few jobs at a time. More is not better: Atlas limits connections per tier (M0/M2/M5: 500; M10: 1500). |
| `minPoolSize`                                   | 2       | 0       | Two warm connections avoid TLS handshakes to Atlas on the first requests after idle.                                                                                                                                                                                                                    |
| `maxIdleTimeMS`                                 | 5 min   | 5 min   | Closes pooled connections nobody used, before Atlas/NAT drops them silently.                                                                                                                                                                                                                            |
| `waitQueueTimeoutMS`                            | not set | not set | Tried 15 s: outside production every model builds its indexes at start and holds connections for seconds on a slow disk; the API failed to start. Requests are still bounded by the socket and server-selection timeouts.                                                                               |
| `serverSelectionTimeoutMS` / `connectTimeoutMS` | 10 s    | 10 s    | Fail fast when Atlas is unreachable (unchanged).                                                                                                                                                                                                                                                        |
| `socketTimeoutMS`                               | 45 s    | 45 s    | Unchanged; no query should run that long (slow log at 100 ms).                                                                                                                                                                                                                                          |
| `compressors`                                   | `zlib`  | `zlib`  | **New.** Built into Node (snappy/zstd need native packages with install scripts). Atlas supports it; history/sync pages and chat lists shrink several times on the wire, which cuts Atlas egress and transfer time; small commands cost microseconds.                                                   |
| `monitorCommands`                               | on      | on      | Feeds the slow query log.                                                                                                                                                                                                                                                                               |

**Worker: one client instead of three.** The media-cleanup, expired-pins and Web Push jobs each opened
their own Mongoose connection (default pool 100 each, and every client keeps 2 monitoring sockets
per replica-set member: 18 idle sockets to a 3-node Atlas cluster before any query). They now share
one (`src/jobs/worker-mongo.ts`), with the slow query log attached.

## 3. Redis connections (per process)

| Process | Connection                                                       | Purpose                                                                                                  |
| ------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| API     | `zuvo-api` (1)                                                   | Rate limits (`@fastify/rate-limit`), Better Auth secondary storage, counters, presence store, attendance |
| API     | adapter pub + sub (2)                                            | Socket.IO Redis adapter (duplicates of the app connection)                                               |
| API     | `zuvo-api-queue` (1)                                             | BullMQ `email` queue (add only)                                                                          |
| API     | `zuvo-api-push` (1, lazy)                                        | BullMQ `push` queue, opened on the first push                                                            |
| API     | `zuvo-api-scheduled` (1) + BullMQ's blocking duplicate (1)       | Scheduled-messages queue + its worker (runs in the API: it needs Socket.IO)                              |
| Worker  | `zuvo-worker` (1) + one blocking duplicate per BullMQ worker (4) | email, media cleanup, pins cleanup, push                                                                 |

About 7 per API instance and 5 for the worker: far below Redis' default `maxclients` (10 000).
The pub/sub and blocking connections cannot be shared (a subscribed or blocked connection can do
nothing else). The three add-only queue connections in the API could share one, saving 2; not worth
the coupling now. Presence already shares the app connection. **No change.**

## 4. Socket.IO

| Setting                        | Value                                                                                                 | Notes                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client transports              | **`['websocket', 'polling']` + `tryAllTransports`** (changed, `frontend/src/features/sync/client.ts`) | WebSocket first: no long-polling handshake (2–3 extra HTTP round trips per connect) and no sticky sessions once there are several API instances. Polling stays as the fallback for networks that block WebSockets. Nginx must keep the `Upgrade`/`Connection` headers on `/socket.io/` (it does, `infra/nginx/README.md`). |
| `pingInterval` / `pingTimeout` | 25 s / 20 s                                                                                           | Unchanged. Below typical 60 s proxy idle timeouts; a dead tab is noticed within ~45 s.                                                                                                                                                                                                                                     |
| `maxHttpBufferSize`            | 64 KB                                                                                                 | Unchanged. A message is ≤ 4096 characters; files go over HTTP.                                                                                                                                                                                                                                                             |
| `perMessageDeflate`            | off (default)                                                                                         | Keep off: it costs CPU and ~300 KB of zlib memory per socket for payloads of a few hundred bytes.                                                                                                                                                                                                                          |
| `httpCompression`              | default (polling only, ≥ 1 KB)                                                                        | Only the polling fallback.                                                                                                                                                                                                                                                                                                 |
| Connection state recovery      | off                                                                                                   | Catch-up is `GET /v1/sync` (cursor-based, survives restarts and instance changes); the Redis adapter does not support recovery anyway.                                                                                                                                                                                     |
| `serveClient`                  | false                                                                                                 | Unchanged.                                                                                                                                                                                                                                                                                                                 |

## 5. HTTP response compression

**Decision: Nginx compresses, the API does not** (no `@fastify/compress`). Compressing twice wastes
CPU; Nginx does it in C, off the Node event loop, and already terminates TLS/HTTP/2. To add on the
server (with the deploy steps, `infra/nginx`):

```nginx
gzip on;
gzip_proxied any;              # responses from the API come through proxy_pass
gzip_comp_level 5;
gzip_min_length 1024;
gzip_types application/json text/plain text/css application/javascript image/svg+xml;
# brotli (if the module is installed): brotli on; brotli_types <same>;
```

Media (`/v1/media/*`: images, video, audio, documents) is already compressed or must keep byte
ranges: its content types are not in `gzip_types`, so Nginx leaves them and `Range` responses alone.
WebSocket frames are never compressed by Nginx.

## 6. Payload sizes

Measured in the load test (average body, uncompressed, 200-user data): `GET /v1/chats` 3–4 KB
(3 chats), a history page 2–5 KB, `GET /v1/sync` 5–65 KB (up to 200 updates with their messages).
Page sizes:
chat list 30 (max `CHAT_PAGE_MAX`), history 50 (max 100), sync 200 updates (max 500). Message
objects carry only fields the client renders or syncs; nothing obviously unused was found that could
be dropped without changing the `@zuvo/protocol` contract, so **no trimming**. With gzip at the edge
JSON shrinks ~5–8×, which matters more than any field.

## 7. Load test results (local, in-memory, 200 users)

Setup: `docs/runbooks/load-test.md`. 200 users, each in a 1:1 pair, a second 1:1 and a 25-member
group; every user sends to a random one of their chats every 3 s (±50%), i.e. ~67 msg/s offered,
~10 deliveries per message on average; receivers report `delivered:update` like the app. Senders wait
for their ack before the next message (closed loop), so when the server falls behind, the offered
rate drops and latency grows. 8-core Windows server shared with other developers' test runs;
mongod on the same box.

### The machine first

- **Disk.** On this server one journaled write (fsync) took seconds: `mongod` needed 70 s to start,
  a first insert 9 s, each new index 4–8 s, and seeding 200 users 90 s. With that, every number
  measured the disk. The load test's replica set is now initiated with
  `writeConcernMajorityJournalDefault: false` (writes don't wait for the journal fsync; Atlas journals
  on SSDs): seeding went from 90 s to 6–12 s. Creating the collections and ~80 indexes still takes
  1–4 minutes, done one at a time before the API starts (`buildApp`'s parallel index builds hit the
  45 s socket timeout here).
- **CPU.** The API's main thread was ~58% idle in a CPU profile (V8 `--cpu-prof`, run with
  `LOAD_CPU_PROF=<dir>`); Mongoose/driver/BSON were the largest JS cost. The API is not CPU-bound.

### The bottleneck found: receipt-mark transactions colliding

Counting failed MongoDB commands showed **45,556 `WriteConflict`s (each a transaction retried) for
~1,500 messages in 90 s**. Cause: every member's `delivered:update` (and read) in a group ran
`refreshGroupMarks`, a transaction that updates the chat and bumps **every member's sync counter**.
24 reports per group message → up to 24 concurrent transactions on the same 25 counters, retried
again and again, holding up sends that touch the same counters.

**Fix:** `refreshGroupMarks` now runs once at a time per chat; reports arriving meanwhile share one
follow-up run (`src/lib/coalescing-queue.ts`, used in `src/chats/group-receipts.service.ts`). Each
caller still waits for a recount that started after its call, so the ticks are never stale. Tests:
`src/lib/coalescing-queue.test.ts`, and "reports arriving together share one recount" in
`src/modules/chats/group-receipts.test.ts` (10 concurrent calls → at most 4 recounts; was 10).

### Before → after (150 s runs, same settings)

|                                          | Before (run 2)             | After                               |
| ---------------------------------------- | -------------------------- | ----------------------------------- |
| Messages sent (closed loop)              | 1,704 (9.2/s)              | 3,331 (19.7/s)                      |
| Sends without an ack in 30 s             | 714 (42%)                  | 48 (1.4%; 46 during the REST burst) |
| Delivered to the other members           | 3,278 of 12,031 (27%)      | 23,203 of 23,203 (100%)             |
| `WriteConflict`s (90 s run)              | 45,556                     | 6,612 (150 s run: 11,438)           |
| send → ack p50 / p95 / p99               | 3.3 s / 18.6 s / 27.9 s    | 1.7 s / 23.4 s / 28.1 s             |
| send → receive p50 / p95 / p99           | 55 s / 163 s / 174 s       | 19 s / 30 s / 35 s                  |
| `GET /v1/chats` p50 / p97.5, idle        | 894 / 1,482 ms (8 req/s)   | 56 / 92 ms (170 req/s)              |
| `GET /v1/sync` p50 / p97.5, idle         | 1,333 / 2,446 ms (7 req/s) | 128 / 182 ms (74 req/s)             |
| history page p50 / p97.5, idle           | 578 / 878 ms (17 req/s)    | 41 / 65 ms (232 req/s)              |
| `GET /v1/chats` p50 / p97.5, during chat | 801 / 1,207 ms             | 390 / 889 ms                        |
| `GET /v1/sync` p50 / p97.5, during chat  | 1,058 / 1,641 ms           | 597 / 1,265 ms                      |
| history page p50 / p97.5, during chat    | 741 / 944 ms               | 307 / 601 ms                        |
| API CPU avg / max (of one core)          | 118% / 161%                | 115% / 155%                         |
| API RSS / heap max                       | 486 / 222 MB               | 558 / 290 MB                        |
| REST errors / non-2xx                    | 0 / 0                      | 0 / 0                               |

(autocannon reports p97.5, not p95. "Idle" = after the chat, sockets still open.)

### Still saturated at one message every 3 s per user

Even after the fix the server keeps up with ~20 msg/s, not the ~67 offered, on this machine. What
limits it: a send is one transaction of ~12 round trips, and sends to the **same chat** run one at a
time (`sendQueue`, on purpose: concurrent sends to one chat would only abort each other). A 25-member
group with every member sending every 3 s needs ~3 sends/s in that chat; on this mongod a group send
takes longer than 1/3 s, so the group's queue grows, and so do its 24 receivers' latencies (the
receive percentiles are dominated by group deliveries). The rest of the write conflicts come from
transactions in different chats bumping the same people's sync counters. On Atlas (in-region round
trips of 1–5 ms, SSD) a group send should take tens of milliseconds, i.e. 20+ msg/s per chat: the
server test (later step) has to confirm it. If it doesn't, the next steps are: fewer round trips in
the send transaction (the two `Chat` writes can become one), and coalescing direct-chat receipt
updates the same way.

### At a realistic rate: one message every 10 s per user (after the fix)

200 users, ~20 msg/s offered (16/s achieved, ~7 deliveries per message), 120 s:

| Window                                      | Sent         | Ack errors | Delivered       | send → ack p50 / p95 / p99 | send → receive p50 / p95 / p99 |
| ------------------------------------------- | ------------ | ---------- | --------------- | -------------------------- | ------------------------------ |
| Chat only                                   | 1,339 (15/s) | 0          | 9,182 / 9,182   | 62 / 782 / 1,920 ms        | 56 / 1,011 / 2,939 ms          |
| Chat + REST burst (10 connections flat out) | 514 (17/s)   | 0          | 3,619 / 3,619   | 1,130 / 9,691 / 11,405 ms  | 4,066 / 11,330 / 12,658 ms     |
| Whole run                                   | 2,227 (16/s) | 0          | 15,498 / 15,498 | 162 / 3,096 / 9,986 ms     | 162 / 8,618 / 11,352 ms        |

REST during the chat: `GET /v1/chats` p50 213 ms / p97.5 570 ms (39 req/s), `GET /v1/sync` 785 /
1,058 ms (13 req/s), history 316 / 549 ms (30 req/s); idle: 53 / 83 ms (179 req/s), 122 / 168 ms
(78 req/s), 42 / 74 ms (220 req/s). 0 REST errors. API CPU avg 91% / max 164% of one core, RSS max
527 MB, heap max 247 MB. 2,533 write conflicts (transactions retried, none failed).

Reading it: with the chat alone, a message reaches the other members in ~60 ms (p50) and ~1 s
(p95) on this overloaded shared machine with mongod on the same disk. The REST burst (autocannon
with 10 connections and no pause, ~80 requests/s of the heaviest reads, far above what 200 people
generate) competes for the same mongod and pushes chat latency to seconds: on the server, the API
and MongoDB no longer share a machine. These are local floors and trends, not server numbers.

Reports of every run: `backend/load/reports/` (gitignored).
