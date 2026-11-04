/**
 * ⚠️ MOCK DATA — for judging the design only. Not real people, chats or messages.
 * Replaced by the API in the chat feature steps. Times are relative to "now" so the
 * preview always looks current.
 */
import { type ChatMessage, type ChatSummary, ME } from './types';

const minutesAgo = (minutes: number, now = Date.now()) => new Date(now - minutes * 60_000);
const HOUR = 60;
const DAY = 24 * HOUR;

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
      author: 'Riya',
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
      author: ME,
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
      author: 'Rahul Mehta',
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
      author: 'Karan',
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
      author: ME,
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
      author: 'Vikram',
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
      author: ME,
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
    lastMessage: {
      author: 'Priya',
      text: 'Diwali holiday calendar is out ✨',
      at: minutesAgo(3 * DAY),
    },
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
    lastMessage: {
      author: 'Meera Kapoor',
      text: 'Let’s catch up after the audit.',
      at: minutesAgo(9 * DAY),
    },
  },
];

function thread(chatId: string, entries: Array<Omit<ChatMessage, 'id' | 'chatId'>>): ChatMessage[] {
  return entries.map((entry, index) => ({ ...entry, id: `${chatId}-${index}`, chatId }));
}

export const MOCK_MESSAGES: Record<string, ChatMessage[]> = {
  asha: thread('asha', [
    {
      author: 'Asha Verma',
      text: 'Morning! Did the client sign off on the scope?',
      at: minutesAgo(DAY + 2 * HOUR),
    },
    {
      author: ME,
      text: 'Not yet — they want one more pass on the timeline.',
      at: minutesAgo(DAY + 110),
      status: 'read',
    },
    {
      author: ME,
      text: 'I’ll send the revised plan tonight.',
      at: minutesAgo(DAY + 109),
      status: 'read',
    },
    { author: 'Asha Verma', text: 'Perfect, thank you 🙌', at: minutesAgo(DAY + 100) },
    { author: 'Asha Verma', text: 'Are we still on for the review today?', at: minutesAgo(40) },
    { author: 'Asha Verma', text: 'I booked the small conference room.', at: minutesAgo(39) },
    {
      author: ME,
      text: 'Yes! I’ll bring the updated numbers.',
      at: minutesAgo(25),
      status: 'read',
      replyTo: { author: 'Asha Verma', text: 'Are we still on for the review today?' },
    },
    { author: 'Asha Verma', text: 'Great. 4 pm works?', at: minutesAgo(20) },
    { author: ME, text: 'Sounds good, see you at 4!', at: minutesAgo(18), status: 'read' },
  ]),
  'design-team': thread('design-team', [
    { author: 'Vikram', text: 'Reminder: design review at 3 today.', at: minutesAgo(3 * HOUR) },
    { author: ME, text: 'I’ll present the new chat list.', at: minutesAgo(170), status: 'read' },
    { author: 'Riya', text: 'Dark mode looks so much calmer now.', at: minutesAgo(30) },
    { author: 'Riya', text: 'New onboarding screens are up for review 🎨', at: minutesAgo(4) },
  ]),
  rahul: thread('rahul', [
    {
      author: ME,
      text: 'Hi Rahul, the deck is almost ready.',
      at: minutesAgo(2 * HOUR),
      status: 'delivered',
    },
    { author: 'Rahul Mehta', text: 'Thanks!', at: minutesAgo(40) },
    {
      author: 'Rahul Mehta',
      text: 'Can you share the Q3 deck before the call?',
      at: minutesAgo(35),
    },
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
