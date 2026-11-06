import type { GroupInfo, MediaInfo, Message, ReplyQuote, SystemEvent } from '@zuvo/protocol';
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
  group?: GroupInfo | null;
  online?: boolean;
  lastSeenAt?: Date;
  pinned: boolean;
  muted: boolean;
  archived?: boolean;
  markedUnread?: boolean;
  /** "Riya reacted 👍 to 'hello'": shown instead of the last message, to its author. */
  reactionLine?: string | undefined;
  unread: number;
  about?: string | null;
  activityAt: Date;
  lastMessage:
    | (MessageAuthor & {
        text: string;
        at: Date;
        status?: DeliveryStatus;
        /** A system message, which shows differently and has no author. */
        isSystem?: boolean;
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
  system?: SystemEvent | null;
  authorAvatar?: string | undefined;
  /** The server's id for this message, once it has one. */
  serverId?: string | null;
  /** Voice notes. See `played` in the protocol. */
  played?: boolean;
  uploadedBytes?: number | undefined;
  heldInTab?: boolean | undefined;
  failReason?: UploadFailReason | undefined;
  /** Its position in the chat, once the server has given it one. */
  seq?: number | null;
  replyTo?: ReplyQuote | null | undefined;
  forwarded?: boolean;
  forwardCount?: number;
  reactions?: Message['reactions'];
  starred?: boolean;
  edited?: boolean;
  deleted?: boolean;
  deletedByAdmin?: boolean;
}
