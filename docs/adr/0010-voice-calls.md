# ADR 0010: Voice calls (WebRTC)

**Status:** accepted (Part 1: 1:1 voice; TURN in Part 2)

## Decision

Calls use the browser's own **WebRTC** (no SDK, no media server). Audio goes **peer to peer**, or
through a **TURN relay** when the two networks cannot reach each other. The API never receives or stores
call audio: it keeps a small record of each call (`calls` collection: who, when, how it ended) and passes
the signaling (offer, answer, ICE candidates) over the existing Socket.IO connection.

- **Codec and processing:** Opus first (`setCodecPreferences`), with the browser's echo cancellation,
  noise suppression and automatic gain on the microphone.
- **Ringing:** `call:start` rings every device of the person called (`call:incoming`) and sends a
  high-priority Web Push ("Incoming voice call", tag `call:<id>`, 45 s TTL) to devices that are not
  looking at the app. The first device to `call:accept` gets the call; the others stop (`call:update`).
  Signals go only between the caller's session and the answering session (`session:<id>` rooms), and
  only while the call is active.
- **Endings:** declined, cancelled, missed after 45 s (a timer on the API instance, and a stale ringing
  call is treated as missed whenever anyone looks), busy (the person is already ringing or talking), or
  hung up. Each ending writes one system message (`kind: 'call'`) in the chat, and a missed call sends a
  "Missed voice call" push with the same tag.
- **Network changes:** the caller restarts ICE (`iceRestart`) when the path drops or the device goes back
  online; the callee asks for it with a `restart` signal. After 30 s without audio the call ends.
- **ICE servers:** `GET /v1/calls/ice` returns STUN from `CALLS_STUN_URLS` and, when configured, TURN
  with **TURN REST API** credentials (username `<expiry>:<userId>`, password HMAC-SHA1 of it with the
  shared `CALLS_TURN_SECRET`, valid for `CALLS_TURN_TTL_SECONDS`). The secret never leaves the server.
- **Rules:** both people must have calls (`CALLS_ENABLED_FOR` = `admins` with `CALLS_TEST_EMAILS`, or
  `all`); 1:1 chats only; no call across a block; a normal user cannot call a hidden admin; quiet hours
  make the call ring silently. Calls are not audited (privacy); call starts are rate limited.

## Why not a media server (SFU) now

1:1 voice needs none, and peer to peer keeps audio off our servers. Group calls and video (v2) will need
an SFU; the protocol already carries `kind` and a callee list can grow into members.

## Limits of a web app

iOS pauses web apps in the background and gives them no ringtone or full-screen call screen; Android
shows a notification, not a lock-screen dialer. Help → FAQ → Voice calls says so.
