/**
 * Best first. AAC in MP4 plays in every browser, so it goes first wherever it can be recorded. Opus
 * comes next, and then plain "audio/mp4", which only a browser that names no codec needs: Chrome may
 * put Opus in it. Why, and which pairs cannot play: docs/adr/0004-voice-notes.md.
 */
const CANDIDATES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

export function pickRecordingFormat(isSupported: (mime: string) => boolean): string | null {
  return CANDIDATES.find((mime) => isSupported(mime)) ?? null;
}

const EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
};

/** The type without its codec, and the file name a voice note goes by. */
export function describeRecording(mime: string) {
  const container = mime.split(';')[0]?.trim() ?? mime;
  return { mime: container, name: `voice-note.${EXTENSIONS[container] ?? 'webm'}` };
}
