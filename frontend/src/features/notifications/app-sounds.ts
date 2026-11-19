import { DEFAULT_PUSH_SETTINGS, type Message, type PushSettings } from '@zuvo/protocol';
import { isQuietNow, shouldAlert } from '@/features/quiet-hours/quiet';
import type { ChatRow } from '@/features/sync/local-db';
import { playSound } from './sound';
import {
  createSoundGate,
  incomingSound,
  SENT_GAP_MS,
  SOUND_GAP_MS,
  sentSound,
} from './sound-rules';

/**
 * The sounds while the app is open: a new message, an @mention, the quiet tick in the chat on screen,
 * and the swoosh when I send. The settings come from GET /v1/me/push (kept here by useAppSounds),
 * so code outside React (the outbox) can play the swoosh too.
 */
let settings: PushSettings = DEFAULT_PUSH_SETTINGS;
const incomingGate = createSoundGate(SOUND_GAP_MS);
const sentGate = createSoundGate(SENT_GAP_MS);

export function setSoundSettings(next: PushSettings | undefined) {
  settings = next ?? DEFAULT_PUSH_SETTINGS;
}

/** A new message arrived while the app is open: its sound, unless rules or the gate say no. */
export function soundForIncoming(
  message: Message,
  context: { me: string; chat: ChatRow | undefined; openChatId: string | null },
): void {
  const name = incomingSound(message, {
    ...context,
    visible: document.visibilityState === 'visible',
    settings,
    quietAllows: (candidate) => shouldAlert(candidate),
  });
  if (name && incomingGate(name)) playSound(name, settings.soundVolume);
}

/** I just sent something: the soft swoosh. */
export function soundForSent(): void {
  const name = sentSound(settings, isQuietNow());
  if (name && sentGate(name)) playSound(name, settings.soundVolume);
}
