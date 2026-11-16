/**
 * The service worker's few words. Not from src/locales: those would add every app string to the
 * worker. The app stores its language for the worker (see language.ts); English is the fallback.
 */
const STRINGS = {
  en: {
    markRead: 'Mark as read',
    reply: 'Reply',
    replyPlaceholder: 'Write a reply…',
    newMessage: 'New message',
    replyFailed: 'Your reply wasn’t sent',
    replyFailedBody: 'Open the chat to try again.',
  },
  hi: {
    markRead: 'पढ़ा हुआ मार्क करें',
    reply: 'जवाब दें',
    replyPlaceholder: 'जवाब लिखें…',
    newMessage: 'नया मैसेज',
    replyFailed: 'आपका जवाब नहीं भेजा गया',
    replyFailedBody: 'दोबारा कोशिश करने के लिए चैट खोलें।',
  },
} as const;

export type SwLanguage = keyof typeof STRINGS;
export type SwStrings = (typeof STRINGS)[SwLanguage];

export function swStrings(language: string | null | undefined): SwStrings {
  return language?.toLowerCase().startsWith('hi') ? STRINGS.hi : STRINGS.en;
}
