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

## Groups

- **Search** does not exist yet. When it is built, it must apply `visibleSeqs` like history does.
- **Rejoining** a group resets what the server will send to what comes after: older messages stay only on
  devices that already have them.
- **Unread counts** include system messages.

## Message actions

- **Quotes** of a message are refreshed for its latest 100 replies only when it is edited or deleted.
- **Reply privately** quotes a group message in a 1:1 chat. If the other person cannot open its picture, the
  quote shows without it.
- **A deleted file** stays reachable by its uploader until the hourly job removes it, up to an hour.
- **Starred messages for one chat** open from the chat's menu in the list, not yet from chat info.
- **Refused actions** show the server's English message rather than a translated one.

## Operations

- **Alert email at 80% disk use**, required by `CLAUDE.md`.
- **Deploy workflows and `infra/`** do not exist yet: see `docs/runbooks/vps-checklist.md`.
- **More than one API instance:** the upload guards against double-processing and overlapping chunk
  writes live in the API's memory, and would need to move to Redis.
