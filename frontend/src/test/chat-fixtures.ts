import type { ChatSummary, Message, PublicProfile, SyncResponse } from '@zuvo/protocol';
import { uuidv7 } from '@/lib/uuid';

export const ME_ID = 'u-test';

export const personFixture = (overrides: Partial<PublicProfile> = {}): PublicProfile => ({
  id: 'u-asha',
  displayName: 'Asha Verma',
  username: 'asha',
  about: 'On it',
  avatar: null,
  deactivated: false,
  ...overrides,
});

export const chatFixture = (overrides: Partial<ChatSummary> = {}): ChatSummary => ({
  id: 'c1',
  type: 'direct',
  seq: 0,
  otherUser: personFixture(),
  lastMessage: null,
  lastReadSeq: 0,
  unreadCount: 0,
  peerDeliveredSeq: 0,
  peerReadSeq: 0,
  lastActivityAt: '2026-11-04T10:00:00.000Z',
  createdAt: '2026-11-01T10:00:00.000Z',
  ...overrides,
});

export const savedChatFixture = (overrides: Partial<ChatSummary> = {}): ChatSummary =>
  chatFixture({ id: 'c-saved', type: 'self', otherUser: null, ...overrides });

export const messageFixture = (seq: number, overrides: Partial<Message> = {}): Message => ({
  id: `m${seq}`,
  chatId: 'c1',
  seq,
  clientMsgId: uuidv7(),
  senderId: 'u-asha',
  type: 'text',
  text: `message ${seq}`,
  media: null,
  albumId: null,
  replyToId: null,
  editedAt: null,
  deletedForEveryoneAt: null,
  createdAt: new Date(Date.UTC(2026, 10, 4, 10, seq % 60)).toISOString(),
  ...overrides,
});

export const syncPage = (overrides: Partial<SyncResponse> = {}): SyncResponse => ({
  cursor: '1',
  reset: false,
  hasMore: false,
  chats: [],
  messages: [],
  ...overrides,
});
