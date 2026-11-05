import type { MediaInfo } from '@zuvo/protocol';
import type { UploadFailReason } from '@/features/sync/local-db';

export type DeliveryStatus = 'pending' | 'failed' | 'sent' | 'delivered' | 'read';
export type ChatKind = 'personal' | 'group' | 'saved';
export type ChatFolder = 'all' | 'unread' | 'personal' | 'groups';

/** The signed-in user's messages use this author id. */
export const ME = 'me';

export interface MessageAuthor {
  /** Stable user id (`ME` for the signed-in user). Drives grouping and sender colors. */
  authorId: string;
  authorName: string;
}

export interface ChatSummary {
  id: string;
  name: string;
  kind: ChatKind;
  otherUserId?: string | undefined;
  username?: string | null;
  avatarSrc?: string | undefined;
  deactivated?: boolean;
  memberCount?: number;
  online?: boolean;
  lastSeenAt?: Date;
  pinned: boolean;
  muted: boolean;
  unread: number;
  about?: string | null;
  activityAt: Date;
  lastMessage:
    | (MessageAuthor & {
        text: string;
        at: Date;
        status?: DeliveryStatus;
      })
    | null;
}

export interface ChatMessage extends MessageAuthor {
  id: string;
  chatId: string;
  /** Present on my own messages: "Not sent — tap to retry" needs it. */
  clientMsgId?: string | null;
  text: string;
  at: Date;
  status?: DeliveryStatus;
  media?: MediaInfo | null;
  albumId?: string | null;
  /** The server's id for this message, once it has one. */
  serverId?: string | null;
  /** Voice notes. See `played` in the protocol. */
  played?: boolean;
  uploadedBytes?: number | undefined;
  heldInTab?: boolean | undefined;
  failReason?: UploadFailReason | undefined;
  replyTo?: MessageAuthor & { text: string };
}
