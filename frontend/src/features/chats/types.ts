import type {
  DisappearTimer,
  GroupInfo,
  LinkPreview,
  MediaInfo,
  Mention,
  Message,
  PinnedMessage,
  Poll,
  ReplyQuote,
  SystemEvent,
} from '@zuvo/protocol';
import type { UploadFailReason } from '@/features/sync/local-db';

export type DeliveryStatus = 'pending' | 'failed' | 'sent' | 'delivered' | 'read';
export type ChatKind = 'personal' | 'group' | 'saved';
/** A built-in chip, or one of my own folders by id. */
export type ChatFolder = 'all' | 'unread' | 'personal' | 'groups' | `folder:${string}`;

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
  /** My unsent text here (any of my devices): shown as "Draft: …" in place of the last message. */
  draft?: string | null;
  /** Unread messages that mention me: the "@" badge. */
  mentions?: number;
  /** Pinned messages, newest pin first (some may have run out: see `livePins`). */
  pins?: PinnedMessage[] | undefined;
  /** The disappearing-messages timer, the same for everyone in the chat. */
  disappearing?: DisappearTimer | undefined;
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
  /** Fetched by our server for the sender; nobody's app contacts the site. */
  linkPreview?: LinkPreview | null;
  /** Groups: who the text mentions. */
  mentions?: Mention[] | undefined;
  /** Type `poll`. */
  poll?: Poll | null | undefined;
  /** A disappearing message: when it goes. */
  expiresAt?: string | null | undefined;
  /** A photo or video that can be opened once; `viewOnceOpened` once it was (by me, or by all). */
  viewOnce?: boolean | undefined;
  viewOnceOpened?: boolean | undefined;
}
