# Sounds

The app plays its own sounds while it is open: the new-message tone (a choice of four), the
@mention sound, a soft "swoosh" on send and a quiet "tick" for a message in the chat on screen.

## Where they come from

All seven files in `frontend/public/sounds/*.wav` are **original work, made by our own code**:
`frontend/src/features/notifications/sounds/synth.ts` adds up sine waves with a decaying envelope
(and, for the swoosh, filtered pseudo-random noise). No recording, sample pack or third-party
sound is used, so there is no outside license to follow. They belong to Correm Advisory India
Pvt. Ltd. like the rest of the code.

| File          | What it is                                   |
| ------------- | -------------------------------------------- |
| `chime.wav`   | The default new-message tone: a rising triad |
| `bubble.wav`  | Tone: two rising pops                        |
| `marimba.wav` | Tone: two warm wooden notes                  |
| `glass.wav`   | Tone: one clear, shimmering note             |
| `mention.wav` | Someone @mentioned me                        |
| `sent.wav`    | I sent a message                             |
| `tick.wav`    | A new message in the chat on screen          |

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
