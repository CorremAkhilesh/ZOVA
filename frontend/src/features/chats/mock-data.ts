/**
 * ⚠️ MOCK DATA — for judging the design only. Not real people, chats or messages.
 * Replaced by the API in the chat feature steps. Times are relative to "now" so the
 * preview always looks current.
 */
import { type ChatMessage, type ChatSummary, ME, type MessageAuthor } from './types';

const minutesAgo = (minutes: number, now = Date.now()) => new Date(now - minutes * 60_000);
const HOUR = 60;
const DAY = 24 * HOUR;

/** Sample people (ids are stable so sender colors stay the same). */
const P = {
  me: { authorId: ME, authorName: 'You' },
  asha: { authorId: 'u-asha', authorName: 'Asha Verma' },
  rahul: { authorId: 'u-rahul', authorName: 'Rahul Mehta' },
  riya: { authorId: 'u-riya', authorName: 'Riya Sen' },
  vikram: { authorId: 'u-vikram', authorName: 'Vikram Rao' },
  karan: { authorId: 'u-karan', authorName: 'Karan Shah' },
  priya: { authorId: 'u-priya', authorName: 'Priya Nair' },
  neha: { authorId: 'u-neha', authorName: 'Neha Iyer' },
  arjun: { authorId: 'u-arjun', authorName: 'Arjun Nair' },
  meera: { authorId: 'u-meera', authorName: 'Meera Kapoor' },
} satisfies Record<string, MessageAuthor>;

export const MOCK_CHATS: ChatSummary[] = [
  {
    id: 'design-team',
    name: 'Product & Design',
    kind: 'group',
    memberCount: 8,
    pinned: true,
    muted: false,
    unread: 3,
    about: 'Weekly design reviews and launch planning.',
    lastMessage: {
      ...P.riya,
      text: 'New onboarding screens are up for review 🎨',
      at: minutesAgo(4),
    },
  },
  {
    id: 'asha',
    name: 'Asha Verma',
    kind: 'personal',
    online: true,
    pinned: true,
    muted: false,
    unread: 0,
    about: 'Engagement manager · Mumbai',
    lastMessage: {
      ...P.me,
      text: 'Sounds good, see you at 4!',
      at: minutesAgo(18),
      status: 'read',
    },
  },
  {
    id: 'rahul',
    name: 'Rahul Mehta',
    kind: 'personal',
    online: false,
    lastSeenAt: minutesAgo(52),
    pinned: false,
    muted: false,
    unread: 2,
    lastMessage: {
      ...P.rahul,
      text: 'Can you share the Q3 deck before the call?',
      at: minutesAgo(35),
    },
  },
  {
    id: 'audit',
    name: 'Audit — FY26',
    kind: 'group',
    memberCount: 14,
    pinned: false,
    muted: true,
    unread: 12,
    lastMessage: {
      ...P.karan,
      text: 'Uploaded the reconciliation sheet.',
      at: minutesAgo(2 * HOUR),
    },
  },
  {
    id: 'neha',
    name: 'Neha Iyer',
    kind: 'personal',
    online: true,
    pinned: false,
    muted: false,
    unread: 0,
    lastMessage: {
      ...P.me,
      text: 'Sent you the contract draft.',
      at: minutesAgo(5 * HOUR),
      status: 'delivered',
    },
  },
  {
    id: 'leadership',
    name: 'Leadership Sync',
    kind: 'group',
    memberCount: 6,
    pinned: false,
    muted: false,
    unread: 0,
    lastMessage: {
      ...P.vikram,
      text: 'Agenda for Monday is in the doc.',
      at: minutesAgo(DAY + 3 * HOUR),
    },
  },
  {
    id: 'arjun',
    name: 'Arjun Nair',
    kind: 'personal',
    online: false,
    lastSeenAt: minutesAgo(DAY + 6 * HOUR),
    pinned: false,
    muted: false,
    unread: 0,
    lastMessage: {
      ...P.me,
      text: 'Thanks, that helps a lot 🙏',
      at: minutesAgo(DAY + 7 * HOUR),
      status: 'sent',
    },
  },
  {
    id: 'hr',
    name: 'HR Announcements',
    kind: 'group',
    memberCount: 120,
    pinned: false,
    muted: true,
    unread: 0,
    lastMessage: { ...P.priya, text: 'Diwali holiday calendar is out ✨', at: minutesAgo(3 * DAY) },
  },
  {
    id: 'meera',
    name: 'Meera Kapoor',
    kind: 'personal',
    online: false,
    lastSeenAt: minutesAgo(9 * DAY),
    pinned: false,
    muted: false,
    unread: 0,
    lastMessage: { ...P.meera, text: 'Let’s catch up after the audit.', at: minutesAgo(9 * DAY) },
  },
];

function thread(chatId: string, entries: Array<Omit<ChatMessage, 'id' | 'chatId'>>): ChatMessage[] {
  return entries.map((entry, index) => ({ ...entry, id: `${chatId}-${index}`, chatId }));
}

export const MOCK_MESSAGES: Record<string, ChatMessage[]> = {
  asha: thread('asha', [
    {
      ...P.asha,
      text: 'Morning! Did the client sign off on the scope?',
      at: minutesAgo(DAY + 2 * HOUR),
    },
    {
      ...P.me,
      text: 'Not yet — they want one more pass on the timeline.',
      at: minutesAgo(DAY + 110),
      status: 'read',
    },
    {
      ...P.me,
      text: 'I’ll send the revised plan tonight.',
      at: minutesAgo(DAY + 109),
      status: 'read',
    },
    { ...P.asha, text: 'Perfect, thank you 🙌', at: minutesAgo(DAY + 100) },
    { ...P.asha, text: 'Are we still on for the review today?', at: minutesAgo(40) },
    { ...P.asha, text: 'I booked the small conference room.', at: minutesAgo(39) },
    {
      ...P.me,
      text: 'Yes! I’ll bring the updated numbers.',
      at: minutesAgo(25),
      status: 'read',
      replyTo: { ...P.asha, text: 'Are we still on for the review today?' },
    },
    { ...P.asha, text: 'Great. 4 pm works?', at: minutesAgo(20) },
    { ...P.me, text: 'Sounds good, see you at 4!', at: minutesAgo(18), status: 'read' },
  ]),
  'design-team': thread('design-team', [
    { ...P.vikram, text: 'Reminder: design review at 3 today.', at: minutesAgo(3 * HOUR) },
    {
      ...P.vikram,
      text: 'Please add your topics to the agenda doc.',
      at: minutesAgo(3 * HOUR - 1),
    },
    { ...P.me, text: 'I’ll present the new chat list.', at: minutesAgo(170), status: 'read' },
    { ...P.karan, text: 'I can cover the audit dashboard.', at: minutesAgo(165) },
    { ...P.riya, text: 'Dark mode looks so much calmer now.', at: minutesAgo(34) },
    { ...P.riya, text: 'The teal read ticks are a nice touch.', at: minutesAgo(33) },
    { ...P.riya, text: 'One question: should muted chats sink to the bottom?', at: minutesAgo(32) },
    {
      ...P.me,
      text: 'Pinned first, then newest — muted just stays quiet.',
      at: minutesAgo(28),
      status: 'read',
      replyTo: { ...P.riya, text: 'One question: should muted chats sink to the bottom?' },
    },
    { ...P.priya, text: 'Makes sense 👍', at: minutesAgo(20) },
    { ...P.karan, text: 'Agreed. Ship it.', at: minutesAgo(12) },
    { ...P.riya, text: 'New onboarding screens are up for review 🎨', at: minutesAgo(4) },
  ]),
  rahul: thread('rahul', [
    {
      ...P.me,
      text: 'Hi Rahul, the deck is almost ready.',
      at: minutesAgo(2 * HOUR),
      status: 'delivered',
    },
    { ...P.rahul, text: 'Thanks!', at: minutesAgo(40) },
    { ...P.rahul, text: 'Can you share the Q3 deck before the call?', at: minutesAgo(35) },
  ]),
};

export function findMockChat(id: string): ChatSummary | undefined {
  return MOCK_CHATS.find((chat) => chat.id === id);
}

export function mockMessagesFor(id: string): ChatMessage[] {
  const existing = MOCK_MESSAGES[id];
  if (existing) return existing;
  const chat = findMockChat(id);
  if (!chat) return [];
  return [{ id: `${id}-last`, chatId: id, ...chat.lastMessage }];
}
