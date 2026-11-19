# Sounds

The app plays its own sounds while it is open: the new-message tone, the @mention sound, a soft
"droplet" on send and a quiet "tick" for a message in the chat on screen. Each kind has a choice in
Settings → Notifications → Sounds, with a preview.

## Where they come from

All files in `frontend/public/sounds/*.wav` are **original work, made by our own code**:
`frontend/src/features/notifications/sounds/` (`synth.ts`, recipes in `tone-recipes.ts` and
`soft-recipes.ts`) adds up sine waves with a decaying envelope, sometimes a gentle low-pass filter and
three short, quiet reflections (a small room), and for the swoosh filtered pseudo-random noise. No
recording, sample pack or third-party sound is used, so there is no outside license to follow. They
belong to Correm Advisory India Pvt. Ltd. like the rest of the code.

| Kind           | Choices (the first is the default)                   |
| -------------- | ---------------------------------------------------- |
| New message    | `chime`, `chime-soft`, `bubble`, `marimba`, `glass`  |
| @mention       | `mention`, `mention-soft`                            |
| Sent message   | `droplet-c`, `droplet-a`, `droplet-b`, `swoosh`, Off |
| Chat on screen | `tick`, `tick-soft`                                  |

- The droplets: a short sine rising in pitch (A: 500 → 1300 Hz; B: the same with a much quieter
  second drop; C: lower, 330 → 820 Hz, and rounder). All under 250 ms and the quietest sounds.
- The `-soft` versions are lower, with harmonic overtones only and a low-pass filter: for people who
  find the originals too bright. They are choices; the originals stay the default.
- Choices already made are kept. Before these choices the send sound was only on or off: someone
  who turned it off keeps "Off"; everyone else gets Droplet C (`toPushSettings` in the backend).

To change one, edit its recipe in `synth.ts` and run `pnpm --filter @zuvo/frontend sounds`. A unit
test (`sounds/synth.test.ts`) fails while the files and the code disagree.

## When they play

`frontend/src/features/notifications/sound-rules.ts` decides; settings are in Settings →
Notifications → Sounds (on/off, volume, tone with preview, and each kind on its own).

- Never for muted chats or while quiet hours / do not disturb hold a message back.
- A burst of messages makes one sound (at most one every 1.5 s; a mention still gets through).
- Browsers allow audio only after a click or key press: the first one unlocks audio and loads the
  sounds (Web Audio), so they play at once afterwards.

With the app closed, a Web Push notification plays the **operating system's** sound: browsers do not
let a website choose it. Help → "Notifications on every device" explains how Android users can pick
our chime (downloaded as `zuvo-chime.wav`) for the app's notifications.
