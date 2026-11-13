import { formatDuration, type MediaInfo } from '@zuvo/protocol';

/** The languages the app speaks. Anything else reads English. */
export type PushLanguage = 'en' | 'hi';

export const toPushLanguage = (value: unknown): PushLanguage => (value === 'hi' ? 'hi' : 'en');

interface Strings {
  newMessage: string;
  more: (count: number) => string;
  testTitle: string;
  testBody: string;
  photo: string;
  video: string;
  viewOncePhoto: string;
  viewOnceVideo: string;
  voice: string;
  audio: string;
  document: string;
  poll: string;
  message: string;
}

const STRINGS: Record<PushLanguage, Strings> = {
  en: {
    newMessage: 'New message',
    more: (count) => `(+${count} more)`,
    testTitle: 'Test notification',
    testBody: 'Notifications work on this device.',
    photo: 'Photo',
    video: 'Video',
    viewOncePhoto: 'View once photo',
    viewOnceVideo: 'View once video',
    voice: 'Voice message',
    audio: 'Audio',
    document: 'Document',
    poll: 'Poll',
    message: 'Message',
  },
  hi: {
    newMessage: 'नया संदेश',
    more: (count) => `(+${count} और)`,
    testTitle: 'टेस्ट सूचना',
    testBody: 'इस डिवाइस पर सूचनाएँ काम कर रही हैं।',
    photo: 'फ़ोटो',
    video: 'वीडियो',
    viewOncePhoto: 'एक बार देखी जाने वाली फ़ोटो',
    viewOnceVideo: 'एक बार देखा जाने वाला वीडियो',
    voice: 'वॉइस मैसेज',
    audio: 'ऑडियो',
    document: 'दस्तावेज़',
    poll: 'पोल',
    message: 'संदेश',
  },
};

export const stringsFor = (language: PushLanguage): Strings => STRINGS[language];

/** What a message shows in a notification, before the sender's name. */
export interface MessageForText {
  text: string | null;
  media: Pick<MediaInfo, 'kind' | 'name' | 'duration'> | null;
  poll: { question: string } | null;
  viewOnce: boolean;
}

/**
 * "📷 Photo", "📷 caption", "🎤 Voice message (0:12)", "📊 Poll: Lunch?". View once shows only its
 * label: there is nothing to see before opening it, not even the caption.
 */
export function describeMessage(message: MessageForText, language: PushLanguage): string {
  const s = stringsFor(language);
  const caption = message.text?.trim() ? message.text : null;
  if (message.poll) return `📊 ${s.poll}: ${message.poll.question}`;
  const media = message.media;
  if (!media) return caption ?? s.message;
  if (message.viewOnce) {
    return media.kind === 'video' ? `🎥 ${s.viewOnceVideo}` : `📷 ${s.viewOncePhoto}`;
  }
  return mediaLabel(media, caption, s);
}

function mediaLabel(
  media: NonNullable<MessageForText['media']>,
  caption: string | null,
  s: Strings,
) {
  switch (media.kind) {
    case 'image':
      return `📷 ${caption ?? s.photo}`;
    case 'video':
      return `🎥 ${caption ?? s.video}`;
    case 'voice':
      return `🎤 ${s.voice} (${formatDuration(media.duration ?? 0)})`;
    case 'audio':
      return `🎵 ${caption ?? (media.name || s.audio)}`;
    default:
      return `📄 ${media.name || s.document}${caption ? ` · ${caption}` : ''}`;
  }
}
