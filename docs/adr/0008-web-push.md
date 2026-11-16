# ADR 0008: Web Push

**Status:** accepted

## Decision

Notifications use **standard Web Push** (RFC 8030) with **VAPID** (RFC 8292) and payload encryption
(RFC 8291), through the `web-push` library. No vendor SDK (Firebase, OneSignal): every browser that can
install the PWA speaks the standard, and the payload stays encrypted between the API and the browser.
One VAPID key pair per environment, in env (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`),
made with `pnpm vapid:gen`. Required in production; without keys push is off (`publicKey: null`) and
nothing is sent. Changing the pair makes every device subscribe again.

A subscription belongs to a **session** and goes with it (sign-out, revoke, "This wasn't me",
deactivation, expiry, 404/410). Settings (`showPreview`, `sound`) live on the user, so every device
follows them.

## Where the decision is made

The API process stores the message and knows the sockets; the worker sends. The API only schedules
"notify this person about this chat" (a delayed, deduplicated BullMQ job). The worker makes the whole
decision **at send time** with one pure function, `decidePush()`, from facts it reads then: reads that
happened in the last seconds, mute, quiet hours, blocks, deletions, sessions that ended. Which device is
being looked at comes from the `window:state` socket event: the API writes it to Redis per session with a
short expiry, so the worker and every API instance read the same answer, and a crashed instance can't
keep a device "attended". Without Redis (tests, E2E, development) the same code runs in the API process
with timers and an in-memory store.

Deciding when the message is stored would be simpler but wrong: a message read within 4 seconds would
still buzz the phone.

## Coalescing and limits

One job per person and chat per `PUSH_COALESCE_SECONDS` (4 s): a burst becomes one notification with
"(+N more)", and the per-chat `tag` makes the browser replace the previous one. Each message is notified
at most once (`pushedSeq`, claimed atomically). At most `PUSH_USER_PER_MINUTE` (30) per person; the rest
join the next notification. 3 attempts with backoff; a failed attempt gives its messages back.

## Privacy

- The payload holds no id but the chat id, no secrets and no URLs; it stays well under 3 KB.
- With the preview off, a locked chat or app lock: "New message" only, no sender, no text, no Reply.
- View once never shows more than its label.
- Logs never contain message text or full endpoints (they are capability URLs), only the push host.
- Inline Reply and Mark as read are ordinary REST calls with the session cookie (`SameSite=Lax`, same
  origin as the service worker), under the same rules as the socket.

## What only a phone can verify

Delivery through real push services (FCM, Mozilla autopush, Apple), the iOS requirement that the PWA is
on the Home Screen (iOS 16.4+) and that permission is asked from a tap, notification actions (Reply is
not supported everywhere), badges, sound and silence, and wake-up while the browser is closed. These need
an HTTPS deployment (staging) and real devices; automated tests use an in-memory sender.
