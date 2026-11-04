export type DeliveryStatus = 'sent' | 'delivered' | 'read';
export type ChatKind = 'personal' | 'group';
export type ChatFolder = 'all' | 'unread' | 'groups' | 'personal';

/** The signed-in user's messages use this author id. */
export const ME = 'me';

export interface ChatSummary {
  id: string;
  name: string;
  kind: ChatKind;
  memberCount?: number;
  online?: boolean;
  lastSeenAt?: Date;
  pinned: boolean;
  muted: boolean;
  unread: number;
  about?: string;
  lastMessage: {
    author: string;
    text: string;
    at: Date;
    status?: DeliveryStatus;
  };
}

export interface ChatMessage {
  id: string;
  chatId: string;
  /** `ME` or the display name of the sender. */
  author: string;
  text: string;
  at: Date;
  status?: DeliveryStatus;
  replyTo?: { author: string; text: string };
}
