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

- **Group chats:** played status has only been designed for direct chats. (Auto-next now names each
  note's own sender.)
- **Seeking in long WebM notes** has only been proven on short ones. MediaRecorder writes no seek index.

## Groups

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
- **Back gesture** (phones and touch screens, `frontend/src/lib/back-stack.ts`): overlays close in the
  order they opened, which matches Esc in practice. A menu choice that opens another page leaves its
  overlay's history entry behind, so going back over it takes one extra press.

## Search

- **Whole words only** on the server (MongoDB text index, [ADR 0005](adr/0005-message-search.md)): no
  prefix or typo matching, and Hindi words are not stemmed. The app's local search matches parts of words,
  but only for what the device has. Atlas Search would fix both; switching needs the owner's go-ahead.
- **Local search** scans the device's whole message cache; fine at today's sizes, worth an index if
  caches grow large.
- **Message search hides people I blocked in groups too**, a stricter rule than history, which still
  shows their group messages.

## Link previews

- **Preview pictures are never deleted.** A daily job should remove `link_preview_images` no message
  points at (and the cache's older copy when a link is fetched again after a day).
- **Forwarding** copies the text; the preview is fetched again only if the forwarder's app asks.
- **Only the first link** in a message gets a preview.

## Blocking and reports

- **The blocked person** learns only from a refused send (`CANNOT_MESSAGE`, "Not sent"); the app could
  say so in the chat instead.
- **Report evidence** names files but does not copy them, so an admin cannot open a reported picture.
- **Reports** can be resolved but not reopened.

## Folders, pins, mentions and drafts (Step 16)

- **Mentions through a mute:** `mentionSeqs` is stored and kept up to date; push notifications use it in
  Step 18.
- **Expired pins** leave open apps when their time is up (the app checks every minute), not through a
  socket event, because the cleanup job runs in the worker.
- **Drafts** are text and the reply only; a file picked but not sent is not a draft.
- **Folder chip counts** use the chats on this device, which can be behind until sync finishes.

## Step 17 follow-ups

- **Poll labels:** the pinned bar and the Starred list show a poll's question without "📊 Poll:".
- **The disappearing badge** in the chat header is a label only: tapping it does not open the timer.
- **Scheduled list** returns up to 200 items without pagination (the limit is 50 waiting, so failed
  ones are what could pile up).
- **PIN secret:** PIN hashes depend on `AUTH_SECRET`; rotating it forces everyone to reset their PIN.
- **E2E cold start:** the E2E server signs in once before listening, because the first sign-in
  compiles the email templates under tsx and could take longer than a test waits.

## Operations

- **Weekly backup copy off the server**: options in `docs/runbooks/backups.md`, not built yet
  (restic to R2 or B2 recommended).
- **Disk space on the shared server:** the disk was 74% used at the first deploy, and other apps share
  it. The daily backup already emails the admins from 80% (`disk-alert`); add a check that runs more
  often than once a day and warns at 85%, so a fast-filling disk is caught before the next backup.
- **Rotate the GitHub Actions deploy key.** Its private key was once pasted into a chat. It is
  `restrict`ed to the deploy command, but should still be replaced: new key on the server, then the
  `VPS_SSH_KEY` secret.
- **Tell the server admin:** reloading Nginx prints a "Too many open files" inotify warning. It is
  harmless for Zuvo, but the server's inotify limits may be worth raising.

## Performance

- **Measure mobile Lighthouse on `/chats` again on the live server**; the earlier figures came from
  local builds.
- **CI E2E is getting slower.** Run 38 (71edc1f, 2026-11-07) took 19:40 for the E2E job, against 13–16
  minutes for the runs just before it. Look at it in the performance step: the slowest specs per browser,
  the worker count, and whether the dev-server pass repeats flows the production pass already covers.
  Not optimised yet, on purpose.
- **More than one API instance:** the upload guards against double-processing and overlapping chunk
  writes live in the API's memory, and would need to move to Redis.

## Audit 2026-11-20: left for later

Low findings from `docs/audit/2026-11-20-audit.md` that the owner chose not to fix now. IDs match the
report.

- **L2: sign-in lockout by a third party.** The 5 codes an hour cap is per email only, so anyone who
  knows an address can block its sign-in for an hour. Key the cap on email and IP, with a larger cap
  per email, and stop a request from a new IP replacing a live code.
- **L3: deactivated accounts answer differently.** A code request for a deactivated account gets 403
  `ACCOUNT_DEACTIVATED`; other allowed emails get "sent". Either answer "sent" and send nothing (verify
  already refuses), or record it as a product decision.
- **L4: "last active admin" race.** Two admins demoting or deactivating each other at the same moment
  can both pass the count. Do the check and the update in one guarded write or a transaction.
- **L6: the 256-member cap under parallel adds.** The cap is read before the transaction, and two joins
  by the same person can count twice. Use a conditional `$inc` inside the transaction.
- **L11: moderate advisories in dev and build tools** (uuid via autocannon, glob and minimatch via
  rimraf and workbox-build). Not in the production runtime; update when upstream releases fixes.
- **L12: one non-documentation IPv4 address in git history** (a test from 2026-11-04 to 2026-11-16).
  Not a secret. The owner checks that it is not an office or server address; history stays as it is.
- **L14: accessible names that differ from visible text** ("View once", the reply quote). Start each
  `aria-label` with the visible words.
- **L16: Admin → Users at phone width.** The action buttons squeeze the name and email; stack them
  under the person below `sm`, or move them into a ⋯ menu.
- **L19: brand name in locale strings, and the default About text.** `auth.errors.domain` and
  `voice.permissionBody` hard-code the name instead of `{{brand}}`; the default About in
  `shared/config/src/brand.ts` mirrors a well-known messenger's default.
- **L20: Hindi gaps.** "Unknown browser on Unknown OS" from the server shows in English on Admin →
  Notifications; a few terms ("PIN", "@mention") are left in English for the owner to decide.
- **L21: phone landscape** (800×360) gets the two-pane layout with a ~230 px message area. Use the
  single pane when the height is under ~480 px.
