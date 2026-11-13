# ADR 0007: Disappearing messages and view once

**Status:** accepted

## Decision

**Disappearing messages.** A chat has one timer (`off`, `24h`, `7d`, `90d`) for every member. A message
sent while it is on gets `expiresAt = sent + timer`; changing the timer never changes messages already
sent. A job in the **API process** deletes due messages every 30 seconds (and once at startup), using
the partial index on `expiresAt`. For each message it deletes the document, its stars, "deleted for me"
rows, pins, mentions and preview lines, moves the chat list back to the newest message left, flags the
file, and tells members (`messages:expired`, plus `chat:updated` when the last message changed).

**View once.** A photo or video in a 1:1 chat or group (never in Saved Messages, and it can't be
forwarded). It is sent with no thumbnail or blurred preview. `POST …/view-once` counts as opened at once,
with a conditional update so two tabs can't both open it, and returns the only link that serves the file
(a signed link with a `once` purpose). `/media/:id/link` and the content routes refuse view-once media to
everyone, the sender included: the sender's device keeps its own copy. When every member who could see
it has opened it, or after 14 days, it is marked done, the sender sees "Opened", and the file is
deleted once the last link handed out has expired (15 minutes).

## Why a sweep job and not a MongoDB TTL index

- **A TTL index deletes only the document.** The file on disk, stars, pins, the chat list line and reply
  quotes would stay, and nobody would be told. The sweep does all of that in one transaction per chat,
  then runs the normal media cleanup, which keeps a file a forwarded copy still uses.
- **TTL deletes can't emit socket events.** Open apps are told straight away by the sweep.
- **The dev database is shared** by local machines and staging, which don't share a media folder. TTL
  would delete documents in every environment whatever its disk holds. The sweep removes a file only where
  it exists, and a missing file is never an error.
- **It runs in the API, not the worker,** because only the API process can emit to sockets. Passes never
  overlap in one process. With several API processes a pass may meet one already deleted. It reads the
  messages again inside its transaction and skips them.

Under `NODE_ENV=test` the job doesn't start itself. Tests run a pass directly, and E2E calls
`POST /v1/test/expire-messages`.

## How offline devices catch up

- Every message carries `expiresAt`, so each app removes due messages from its own cache by the clock,
  even offline.
- The sweep also writes a `hidden` row to each member's update log for every expired message. On its next
  `GET /v1/sync`, a device that was away gets them in `removed` and the chat's new summary (last message).
- History, sync and the update log already allow gaps in `seq` (as with "delete for me"). A row whose
  message no longer exists is skipped.

## What view once can't promise

**A web app can't block screenshots or screen recording.** Browsers give a page no way to detect or
prevent them, nor a photo of the screen taken with another phone. While the photo or video is on screen
it can be copied, and its link works for 15 minutes for whoever has it. View once guarantees only that
the app shows it once, that the server hands out its file once per recipient, and that the file is
deleted. The UI says so in plain words. It must never suggest the photo can't be saved.
