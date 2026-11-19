import type { Message, PushSettings } from '@zuvo/protocol';
import type { ChatRow } from '@/features/sync/local-db';
import { mentionsMe } from './alert-rules';
import type { SoundName } from './sounds/synth';

/** Many messages at once make one sound: nothing more for this long after one played. */
export const SOUND_GAP_MS = 1500;
/** The send "swoosh" at most this often (a burst of sends is one swoosh). */
export const SENT_GAP_MS = 400;

export interface SoundContext {
  me: string;
  chat: ChatRow | undefined;
  /** The chat on screen right now, if any. */
  openChatId: string | null;
  /** This tab is visible. A hidden one stays quiet: the server sends a push instead. */
  visible: boolean;
  settings: PushSettings;
  /** Quiet hours allow this message (quiet-hours/quiet.ts `shouldAlert`). */
  quietAllows: (message: { chatId: string; mentionsMe: boolean }) => boolean;
  now?: number;
}

const isMuted = (chat: ChatRow | undefined, now: number) =>
  Boolean(chat?.mutedUntil && Date.parse(chat.mutedUntil) > now);

/** Someone else's real message, in a chat that is not muted (nor Saved Messages). */
function worthASound(message: Message, ctx: SoundContext): boolean {
  if (message.senderId === null || message.senderId === ctx.me) return false;
  if (message.system || message.deletedForEveryoneAt) return false;
  return ctx.chat?.type !== 'self' && !isMuted(ctx.chat, ctx.now ?? Date.now());
}

/**
 * Which sound a new message makes while the app is open, if any:
 * - never for my own messages, system messages, deleted ones or Saved Messages
 * - never in a muted chat, nor while quiet hours / do not disturb hold it back
 * - the chat on screen: the quiet "tick"; an @mention: the mention sound; otherwise my tone
 * - each kind can be turned off, and "Sounds" off silences all of them
 */
export function incomingSound(message: Message, ctx: SoundContext): SoundName | null {
  const { settings } = ctx;
  if (!settings.sound || !ctx.visible || !worthASound(message, ctx)) return null;
  const mentioned = mentionsMe(message, ctx.me);
  if (!ctx.quietAllows({ chatId: message.chatId, mentionsMe: mentioned })) return null;
  if (message.chatId === ctx.openChatId) return settings.soundOpenChat ? 'tick' : null;
  if (mentioned) return settings.soundMentions ? 'mention' : null;
  return settings.soundMessages ? settings.tone : null;
}

/** The swoosh after I send, unless sounds or that kind are off, or quiet hours are on. */
export function sentSound(settings: PushSettings, quiet: boolean): SoundName | null {
  return settings.sound && settings.soundSent && !quiet ? 'sent' : null;
}

/**
 * Lets a sound through at most once per `gapMs`: a burst of messages (or sends) makes one sound.
 * A mention still gets through right after a plain message, so it is never lost in a burst.
 */
export function createSoundGate(gapMs: number) {
  let last = Number.NEGATIVE_INFINITY;
  let lastWasMention = false;
  return (sound: SoundName, now: number = Date.now()): boolean => {
    const mention = sound === 'mention';
    const open = now - last >= gapMs || (mention && !lastWasMention);
    if (!open) return false;
    last = now;
    lastWasMention = mention;
    return true;
  };
}
