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

## Backlog

- **No ffmpeg on the server yet.** A video's poster, duration and dimensions come from the browser. The
  poster is validated and re-encoded as an image; the numbers are only used for display. Server-side
  extraction would make them trustworthy and allow transcoding.
- HEIC needs the browser to convert it: standard `sharp` builds cannot decode it. A browser that cannot
  either (Chrome on desktop) sends it as a document.
