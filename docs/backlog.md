# Backlog

Known work that was decided on or deliberately left for later. Product scope lives in `CLAUDE.md`.

## Media

- **ffmpeg on the server, for video and voice together.** Added once, it covers both:
  - **Voice notes: Opus to AAC** (decided, [ADR 0004](adr/0004-voice-notes.md)). Fixes the one pair that
    cannot play: Opus recorded by Firefox, or by a Chrome with no AAC encoder, on an iPhone older than
    iOS 18.4. Convert in a background job after upload and keep the original until that succeeds.
  - **Video: posters, length and size from the file itself** ([ADR 0003](adr/0003-media-uploads.md)).
    They come from the browser today, and are only used for display. This also makes transcoding possible.
  - Voice note lengths can also then be checked by the server, not just taken from the browser.
- **HEIC on Chrome** goes as a document, since standard `sharp` builds cannot decode it.
- **Thumbnail cache** in the browser has no size limit.

## Voice notes

- **Group chats:** auto-next uses the previous note's sender name, and played status has only been
  designed for direct chats. Both need revisiting when groups are built.
- **Seeking in long WebM notes** has only been proven on short ones. MediaRecorder writes no seek index.

## Operations

- **Alert email at 80% disk use**, required by `CLAUDE.md`.
- **Deploy workflows and `infra/`** do not exist yet: see `docs/runbooks/vps-checklist.md`.
- **More than one API instance:** the upload guards against double-processing and overlapping chunk
  writes live in the API's memory, and would need to move to Redis.
