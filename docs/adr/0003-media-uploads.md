# ADR 0003: Chunked media uploads, without tus

**Status:** accepted

## Decision

Files reach the server through a small chunked protocol of our own, modelled on tus:

```
POST   /v1/uploads                  { kind, name, mime, size, … } → { uploadId, offset: 0, … }
PATCH  /v1/uploads/:id              upload-offset: N, a chunk of bytes → { offset }
GET    /v1/uploads/:id              → { offset }   (where to resume)
PUT    /v1/uploads/:id/poster       a video's poster image
POST   /v1/uploads/:id/complete     → { media }    (checks and processes the file)
DELETE /v1/uploads/:id              cancels
```

A chunk with the wrong offset gets `409 UPLOAD_OFFSET_MISMATCH` with the server's offset, so a client
can never leave a hole or write a byte twice.

## Why not @tus/server

- **The outbox already owns the hard part.** The file waits in IndexedDB, and the outbox decides when
  to send, retries and cancels. `tus-js-client` would duplicate that, and keeps its own resume state in
  `localStorage`, which sign-out would also have to wipe.
- **Fastify stays in charge.** Each chunk is an ordinary short request, so session checks, rate limits,
  logging and Zod validation apply as everywhere else. `@tus/server` handles raw requests outside them.
- **It is small:** about 150 lines, using `StorageDriver` and a temp folder.

The cost is no interoperability with other tus clients, which nothing here needs. If that changes, the
endpoints map closely onto tus and can be replaced without touching the message flow.

## One file per message

An album is several messages sharing an `albumId`, not one message with many files. Each item gets its
own caption, ticks, position and gallery row, and sending one is the same as sending any other message.
`message:send` takes `mediaIds` with exactly one id for now.

The 20 messages per 5 seconds limit also applies to album items. The outbox waits out `RATE_LIMITED`
without counting it as a failure, so a 30-photo album takes a few seconds longer.

## Files up to 1 GB

The limit is `MEDIA_MAX_FILE_MB` (default 1024), served by `GET /v1/config` so the app and server agree.
The server decides: if the app cannot ask (offline), it refuses nothing, and the message later says why
it failed. Pictures stay at 100 MB, since both sides decode them; a larger one goes as a document.

- **Chunks:** 4 MB, or the 8 MB maximum above 100 MB, which keeps a 1 GB file to about 128 requests.
  Chunks have their own rate limit (1200 a minute), since a whole office can share one address.
- **Disk:** an upload is refused if it would take the disk above 90%. Each chunk checks again with the
  bytes still to come, because uploads running side by side can all pass at the start. The partial file
  stays, so a later retry continues from it.
- **Finishing:** `complete` hashes and copies the file as streams, which can take minutes on a slow disk.
  A client that lost the answer and asks again joins the same work instead of storing a second copy.
- **Cleanup:** an unattached upload older than 24 hours is removed, unless bytes arrived in the last hour.
- **Browser storage:** before keeping a file in IndexedDB, the app compares it with
  `navigator.storage.estimate()`. If it does not fit, or the write fails on quota, the file stays only
  as a handle in the tab (`held-files.ts`): it still uploads, the message says "Keep this tab open until
  the upload finishes", and leaving the page asks first. Resuming after a reload is then not possible.
  A Web Lock tells other tabs that the holder is alive. Once it is gone, the message says the file was
  lost and can be removed, since a retry could never work.
- **Limits of this:** one `complete` guard and one chunk writer per upload live in the API process. A
  second API instance would need them moved to Redis.

## What the browser is trusted with

A video's poster, duration and dimensions come from the browser. The poster is validated and re-encoded
as an image; the numbers are only used for display. HEIC needs the browser to convert it, because standard
`sharp` builds cannot decode it, and a browser that cannot (Chrome on desktop) sends it as a document. Later
work on both is in `docs/backlog.md`.
