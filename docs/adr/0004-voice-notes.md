# ADR 0004: Voice note formats

**Status:** accepted

## Decision

Voice notes are recorded with the browser's `MediaRecorder` and stored as recorded, with no transcoding.
The app picks the first format the browser can record, in this order:

1. `audio/mp4;codecs=mp4a.40.2` (AAC)
2. `audio/webm;codecs=opus`
3. `audio/ogg;codecs=opus`
4. `audio/mp4` (no codec named)

AAC in MP4 goes first because it is the one format every browser here can play. Plain `audio/mp4` goes
last because Chrome may put Opus inside it.

## What each browser does

| Browser                             | Records                                        | Plays AAC/MP4                   | Plays Opus/WebM |
| ----------------------------------- | ---------------------------------------------- | ------------------------------- | --------------- |
| Chrome, Edge (current, desktop)     | AAC where the system has an encoder, else Opus | Yes                             | Yes             |
| Chrome on Android                   | AAC where available, else Opus                 | Yes                             | Yes             |
| Firefox                             | Opus only                                      | Yes (uses the system's decoder) | Yes             |
| Safari on Mac, iPhone (18.4+)       | AAC                                            | Yes                             | Yes             |
| Safari on Mac, iPhone (14.5 – 18.3) | AAC                                            | Yes                             | iPhone: no      |

These come from published documentation and were **not all tested on real devices**. Which recorder
format a browser supports is always decided at runtime with `MediaRecorder.isTypeSupported`.

## The one pair that cannot play

**Opus, recorded by Firefox or by a Chrome with no AAC encoder, cannot play on an iPhone older than
iOS 18.4.** The app does not fail silently: the bubble says this device cannot play the recording.

The brief says every voice note must play everywhere. The owner chose between three options:

| Option                               | Fixes the gap | Cost                                                                                           |
| ------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------- |
| A. Accept it                         | No            | Nothing. Affects few people: an old iPhone and a Firefox sender                                |
| B. ffmpeg on the server, Opus to AAC | Yes           | A native binary in the image, and a job after each voice note. Also the backlog item for video |
| C. A WASM AAC encoder in the browser | Yes           | About 1 MB more on first record, and CPU on the sender's device                                |

**Decision: A for now.** B is planned together with ffmpeg for video, when it is almost free, and is in
`docs/backlog.md`. C was rejected: it costs every sender for a problem only a few receivers have.

## Why not decode to draw the waveform

The waveform comes from the levels heard while recording rather than from decoding the file afterwards:
`decodeAudioData` cannot read every format in every browser, and this works the same everywhere. Bars are
stored with the message, so the receiver needs no decoding either. The server checks the array's size and
range. Like a video's length, a voice note's length comes from the browser, because the server does not
decode audio. It is used only for display and the "played" threshold.

## Played status

Stored per person on the message (`plays`), only ever added to, with whether it was shareable at that
moment. Same rule as reads: a play made with read receipts off on either side stays hidden from the sender
even if receipts come back on, and one already shown stays shown. The person who played it always sees their
own dot cleared, on all their devices.
