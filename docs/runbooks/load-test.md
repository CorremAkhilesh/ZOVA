# Load test runbook

How to load-test the backend: now, locally against an in-memory stack, and later on the server.
Numbers and the configuration review: `docs/runbooks/backend-performance.md`.

## Local (now)

```sh
pnpm --filter @zuvo/backend load:local                 # 200 users, 180 s, a message every ~3 s each
pnpm --filter @zuvo/backend load:local -- --users 200 --duration 150 --interval 3000 --api-seconds 15
```

What it does (`backend/load/local.ts`, `backend/load/server.ts`):

1. Refuses to run if port **4397** is taken (`--port` to change it). It never talks to a server it
   did not start.
2. Starts the API in a child process: the real `buildApp`, `NODE_ENV=test`, an in-memory MongoDB
   replica set (`mongodb-memory-server`, so transactions work), **no Redis** (one instance, in-memory
   rate limits and presence). It never touches Atlas, `zuvo_dev*`, `zuvo_prod`, Memurai or SMTP.
   Collections and indexes are created one at a time before the app starts (on the shared Windows
   server a new collection or index file can take seconds).
3. Seeds `--users` users and sessions straight into that throwaway database, and for each user: a
   1:1 partner (0↔1, 2↔3, …), a second 1:1 seven seats away, and one group of `--group-size` (25).
4. Connects one Socket.IO client per user (WebSocket, the session cookie, the app's Origin).
5. Chat scenario for `--duration` seconds: every user sends a text to one of their chats every
   `--interval` ms (±50%), and acknowledges what arrives with `delivered:update` (coalesced per
   chat, like the app). Measured: **send → ack** (the server stored it) and **send → receive** at
   every other member's socket (1 per 1:1 message, 24 per group message).
6. After 20 s of chatting, autocannon (`--api-connections` 10, `--api-seconds` each) runs
   `GET /v1/chats`, `GET /v1/sync?since=…` and `GET /v1/chats/:id/messages?limit=50` with 20
   users' cookies. The same three run again at the end with nobody chatting ("idle").
7. Samples the API process's CPU, RSS and heap every second, and counts failed MongoDB commands by
   code (`WriteConflict` = a transaction that collided and was retried); reports the driver's own
   event-loop delay (if it is high, the driver, not the API, was the bottleneck).
   `LOAD_CPU_PROF=<dir>` also writes a V8 CPU profile of the API (open it in Chrome DevTools).
   The in-memory replica set does not wait for the journal's fsync on writes
   (`writeConcernMajorityJournalDefault: false`): on the shared server's disk one fsync took seconds.
8. Stops the API and its MongoDB, and writes the report to `backend/load/reports/` (gitignored).

**Shared machine.** The dev server is shared and often heavily loaded (other developers' tests and
E2E runs, each with its own `mongod`). Run it when the machine is quiet, run it at least twice, and
compare runs, not single numbers. In-memory MongoDB on a local disk is not Atlas: absolute numbers
are a floor for the code path and say nothing about network round trips to Atlas.

## On the server (later, Steps 22–25)

Plan for the real test, once staging runs on the VPS:

- **Target:** staging only (`dev-app.zuvo.corremadvisory.com`, database `zuvo_dev` would be polluted:
  use a dedicated `zuvo_load_<date>` database on the cluster or a staging copy, then drop it). Never
  production, never `zuvo_prod`.
- **Where the driver runs:** a separate machine (not the VPS), so the driver's CPU does not compete
  with the API. Same scripts: `local.ts` needs a `--target` mode that skips starting its own API and
  reads seeded seats from a file (to be added with the deploy steps); seeding then goes through a
  one-off script against that database, never through OTP emails.
- **What changes from local:** real Nginx (HTTP/2, TLS, gzip/br), real Redis (Socket.IO adapter,
  rate limits, presence, BullMQ), Atlas round trips, the worker running.
- **Scenario:** 200 users as here, then step up (400, 800) until p95 send → receive passes 500 ms
  or errors appear; one run of 30 minutes at 200 users to watch memory (RSS should flatten).
- **Watch on the server:** API/worker CPU and RSS (`docker stats`), Redis `INFO clients` and
  `INFO memory`, Atlas metrics (connections, op latency, slow query log), the API's
  `slow mongodb query` warnings, Nginx error log.
- **Pass criteria (proposal):** p95 send → receive < 300 ms and p99 < 1 s at 200 users; REST p95
  < 200 ms; 0 errors; RSS flat over 30 minutes.
